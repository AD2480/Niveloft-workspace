package dev.projectflow.service;

import dev.projectflow.domain.Project;
import dev.projectflow.domain.ProjectMember;
import dev.projectflow.domain.Role;
import dev.projectflow.domain.User;
import dev.projectflow.email.AccountEmails;
import dev.projectflow.email.EmailService;
import dev.projectflow.live.LiveUpdateService;
import dev.projectflow.ops.AuditLog;
import dev.projectflow.ops.OpsSwitches;
import dev.projectflow.repository.ProjectMemberRepository;
import dev.projectflow.repository.UserRepository;
import dev.projectflow.security.CurrentUser;
import dev.projectflow.security.RateLimiter;
import dev.projectflow.security.SessionStore;
import dev.projectflow.web.dto.Dto;
import dev.projectflow.web.dto.Requests;
import dev.projectflow.web.error.ApiException;
import java.security.SecureRandom;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/**
 * A person's control over their own account: a copy of their data, and deleting the account. And
 * the operator's controls over accounts: suspending one, and signing everyone out after a leak.
 *
 * <p>Deleting an account removes what identifies the person (name, email, password, sign-up
 * details, sessions, notifications, links) and the projects they own alone. What they wrote in
 * projects they share with others (comments, submissions, reviews, activity) stays with those
 * projects, shown as by "Deleted user", so a team's review history stays whole. An account that
 * owns a project with other members can't be deleted until ownership is handed over.
 */
@Service
public class AccountService {

    static final String DELETED_NAME = "Deleted user";

    private final UserRepository users;
    private final ProjectMemberRepository members;
    private final ProjectService projects;
    private final FileStorageService storage;
    private final SessionStore sessions;
    private final LiveUpdateService live;
    private final PasswordEncoder encoder;
    private final JdbcTemplate jdbc;
    private final AuditLog audit;
    private final OpsSwitches switches;
    private final RateLimiter limits;
    private final EmailService email;
    private final AccountEmails emails;
    private final Clock clock;
    private final SecureRandom random = new SecureRandom();

    public AccountService(UserRepository users, ProjectMemberRepository members, ProjectService projects, FileStorageService storage, SessionStore sessions,
                          LiveUpdateService live, PasswordEncoder encoder, JdbcTemplate jdbc, AuditLog audit, OpsSwitches switches, RateLimiter limits,
                          EmailService email, AccountEmails emails, Clock clock) {
        this.users = users;
        this.members = members;
        this.projects = projects;
        this.storage = storage;
        this.sessions = sessions;
        this.live = live;
        this.encoder = encoder;
        this.jdbc = jdbc;
        this.audit = audit;
        this.switches = switches;
        this.limits = limits;
        this.email = email;
        this.emails = emails;
        this.clock = clock;
    }

    // ---------------------------------------------------------------- export

    /**
     * Everything Niveloft holds about me, as JSON: my profile, my memberships, tasks assigned to me
     * or reported by me, what I wrote (comments, submissions, reviews, project documents), my ratings
     * of Flurry's answers, my notifications, my sessions and the audit records of what I did. Files I uploaded are listed by name; they stay
     * downloadable from their projects. At most 5 exports an hour. (Not read-only: the export itself
     * is recorded in the audit log.)
     */
    @Transactional
    public Map<String, Object> export() {
        switches.require("exports");
        Long me = CurrentUser.id();
        limits.check("account-export", String.valueOf(me), 5, Duration.ofHours(1));
        User u = users.findById(me).orElseThrow(() -> ApiException.unauthorized("Your session has expired. Please sign in again."));
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("format", "niveloft-account-export");
        out.put("version", 1);
        out.put("exportedAt", Instant.now(clock).toString());
        Map<String, Object> profile = new LinkedHashMap<>();
        profile.put("name", u.getName());
        profile.put("email", u.getEmail());
        profile.put("jobTitle", u.getJobTitle());
        profile.put("createdAt", text(u.getCreatedAt()));
        profile.put("emailConfirmedAt", text(u.getEmailVerifiedAt()));
        profile.put("termsAcceptedAt", text(u.getTermsAcceptedAt()));
        out.put("profile", profile);
        out.put("signUpSource", jdbc.queryForList("SELECT signup_source AS source, signup_medium AS medium, signup_campaign AS campaign, signup_referrer AS referrer, "
                + "signup_landing AS landing FROM users WHERE id = ?", me).stream().findFirst().orElse(Map.of()));
        out.put("projects", jdbc.queryForList("SELECT p.project_key AS project, p.name, m.role, m.joined_at AS joinedAt FROM project_members m "
                + "JOIN projects p ON p.id = m.project_id WHERE m.user_id = ? ORDER BY p.project_key", me));
        String task = "CONCAT(p.project_key, '-', t.task_number)";
        out.put("tasksAssignedToMe", jdbc.queryForList("SELECT " + task + " AS task, t.title, t.status, t.priority, t.due_date AS dueDate FROM tasks t "
                + "JOIN projects p ON p.id = t.project_id WHERE t.assignee_id = ? ORDER BY p.project_key, t.task_number", me));
        out.put("tasksIReported", jdbc.queryForList("SELECT " + task + " AS task, t.title, t.status, t.created_at AS createdAt FROM tasks t "
                + "JOIN projects p ON p.id = t.project_id WHERE t.reporter_id = ? ORDER BY p.project_key, t.task_number", me));
        out.put("comments", jdbc.queryForList("SELECT " + task + " AS task, c.created_at AS at, c.body AS text FROM comments c JOIN tasks t ON t.id = c.task_id "
                + "JOIN projects p ON p.id = t.project_id WHERE c.author_id = ? ORDER BY c.created_at", me));
        out.put("submissions", jdbc.queryForList("SELECT " + task + " AS task, s.version, s.status, s.created_at AS at, s.notes FROM submissions s "
                + "JOIN tasks t ON t.id = s.task_id JOIN projects p ON p.id = t.project_id WHERE s.submitted_by_id = ? ORDER BY s.created_at", me));
        out.put("reviews", jdbc.queryForList("SELECT " + task + " AS task, s.version AS submissionVersion, r.decision, r.feedback, r.created_at AS at FROM reviews r "
                + "JOIN submissions s ON s.id = r.submission_id JOIN tasks t ON t.id = s.task_id JOIN projects p ON p.id = t.project_id "
                + "WHERE r.reviewer_id = ? ORDER BY r.created_at", me));
        out.put("documentsIWrote", jdbc.queryForList("SELECT p.project_key AS project, d.title, d.status, d.created_at AS createdAt, d.updated_at AS updatedAt, "
                + "d.body AS text FROM project_documents d JOIN projects p ON p.id = d.project_id WHERE d.created_by = ? ORDER BY d.created_at", me));
        out.put("answersIRated", jdbc.queryForList("SELECT p.project_key AS project, f.created_at AS at, f.verdict, f.categories, f.correction, f.question "
                + "FROM ai_feedback f JOIN projects p ON p.id = f.project_id WHERE f.user_id = ? ORDER BY f.created_at", me));
        out.put("filesIUploaded", jdbc.queryForList("SELECT p.project_key AS project, f.original_name AS name, f.content_type AS type, f.size_bytes AS bytes, "
                + "f.created_at AS at FROM stored_files f JOIN projects p ON p.id = f.project_id WHERE f.uploaded_by_id = ? ORDER BY f.created_at", me));
        out.put("notifications", jdbc.queryForList("SELECT created_at AS at, title, message, is_read AS isRead FROM notifications WHERE user_id = ? "
                + "ORDER BY created_at DESC", me));
        out.put("sessions", sessions.active(me).stream().map(s -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("signedInAt", text(s.createdAt()));
            m.put("lastUsedAt", text(s.lastSeenAt()));
            m.put("device", s.device());
            m.put("network", s.network());
            return m;
        }).toList());
        out.put("auditRecords", audit.forActor(me, 1000).stream().map(e -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("at", text(e.at()));
            m.put("action", e.action());
            m.put("outcome", e.outcome());
            m.put("detail", e.detail());
            return m;
        }).toList());
        audit.record(me, null, "account.exported", null, AuditLog.OK, null);
        return out;
    }

    // ---------------------------------------------------------------- deletion

    private record Owned(Project project, long others) {}

    private List<Owned> owned(Long userId) {
        List<Owned> out = new ArrayList<>();
        for (ProjectMember m : members.findByUserId(userId)) {
            if (m.getRole() != Role.OWNER) continue;
            out.add(new Owned(m.getProject(), members.countByProjectId(m.getProject().getId()) - 1));
        }
        return out;
    }

    /** What deleting my account would do, before I confirm. */
    @Transactional(readOnly = true)
    public Dto.DeletionCheck deletionCheck() {
        List<Owned> owned = owned(CurrentUser.id());
        List<String> blocked = owned.stream().filter(o -> o.others() > 0).map(o -> o.project().getName()).toList();
        List<String> with = owned.stream().filter(o -> o.others() == 0).map(o -> o.project().getName()).toList();
        return new Dto.DeletionCheck(blocked, with, blocked.isEmpty());
    }

    @Transactional
    public void delete(Requests.DeleteAccount req) {
        Long me = CurrentUser.id();
        limits.check("account-delete", String.valueOf(me), 10, Duration.ofHours(1));
        User u = users.findById(me).orElseThrow(() -> ApiException.unauthorized("Your session has expired. Please sign in again."));
        if (!"DELETE".equals(req.confirm() == null ? "" : req.confirm().trim())) {
            throw ApiException.validation("confirm", "Type DELETE, in capitals, to confirm.");
        }
        if (!encoder.matches(req.password(), u.getPasswordHash())) {
            audit.record(me, null, "account.deleted", null, AuditLog.DENIED, "wrong password");
            throw ApiException.validation("password", "That password isn’t right.");
        }
        List<Owned> owned = owned(me);
        List<String> blocked = owned.stream().filter(o -> o.others() > 0).map(o -> o.project().getName()).toList();
        if (!blocked.isEmpty()) {
            throw ApiException.conflict("You own " + String.join(", ", blocked.stream().map(n -> "“" + n + "”").toList())
                    + " with other people. Make someone else the owner (Project settings → Transfer ownership) or delete "
                    + (blocked.size() == 1 ? "it" : "them") + " first.");
        }
        Instant now = Instant.now(clock);
        String address = u.getEmail();
        String name = u.getName();
        boolean tell = email.enabled() && u.isEmailVerified();

        List<String> keys = new ArrayList<>();
        for (Owned o : owned) keys.addAll(projects.deleteSoleOwned(o.project(), me));
        // Project deletion clears entities whose rows the database cascaded away.
        // Reload the account so the anonymisation below is persisted by dirty checking.
        u = users.findById(me).orElseThrow();
        projects.leaveAllForDeletedAccount(u);

        Timestamp ts = Timestamp.from(now);
        jdbc.update("UPDATE invitations SET status = 'REVOKED', responded_at = ? WHERE LOWER(email) = LOWER(?) AND status = 'PENDING'", ts, address);
        jdbc.update("DELETE FROM notifications WHERE user_id = ?", me);
        jdbc.update("DELETE FROM account_tokens WHERE user_id = ?", me);
        jdbc.update("DELETE FROM idempotency_keys WHERE user_id = ?", me);
        jdbc.update("DELETE FROM arena_votes WHERE user_id = ?", me);
        jdbc.update("UPDATE contact_messages SET user_id = NULL WHERE user_id = ?", me);
        // Ratings of Flurry's answers stay with the project (owners see them without names); only the link to the account goes.
        jdbc.update("UPDATE ai_feedback SET user_id = NULL WHERE user_id = ?", me);
        sessions.revokeAll(me, "account-deleted", null);
        jdbc.update("DELETE FROM user_sessions WHERE user_id = ?", me);

        byte[] bytes = new byte[12];
        random.nextBytes(bytes);
        String suffix = HexFormat.of().formatHex(bytes);
        u.setName(DELETED_NAME);
        u.setEmail("deleted-" + me + "-" + suffix + "@deleted.invalid");
        u.setPasswordHash(encoder.encode(suffix + HexFormat.of().formatHex(bytes)));
        u.setJobTitle(null);
        u.setAvatarColor("#94a3b8");
        u.setEmailVerifiedAt(null);
        u.setCaughtUpAt(null);
        u.setSuspendedAt(null);
        u.setDeletedAt(now);
        u.bumpSessionVersion();
        users.flush();
        jdbc.update("UPDATE users SET signup_source = NULL, signup_medium = NULL, signup_campaign = NULL, signup_term = NULL, signup_content = NULL, "
                + "signup_referrer = NULL, signup_landing = NULL WHERE id = ?", me);
        audit.record(me, null, "account.deleted", null, AuditLog.OK, owned.size() + " solo project(s) deleted with it");

        afterCommit(() -> {
            storage.deleteKeys(keys);
            live.endSessions(me);
            if (tell) email.send(emails.accountDeleted(address, name, now));
        });
    }

    // ---------------------------------------------------------------- operators

    /** Suspends an account: it's signed out everywhere and can't sign in until unsuspended. */
    @Transactional
    public void suspend(Requests.AccountAction req, boolean suspend) {
        Long operator = CurrentUser.id();
        User u = users.findByEmailIgnoreCase(req.email().trim()).filter(x -> x.getDeletedAt() == null)
                .orElseThrow(() -> ApiException.notFound("No account uses that email address."));
        if (suspend && u.getId().equals(operator)) throw ApiException.validation("email", "You can’t suspend your own account.");
        u.setSuspendedAt(suspend ? Instant.now(clock) : null);
        if (suspend) {
            sessions.revokeAll(u.getId(), "suspended", null);
            afterCommit(() -> live.endSessions(u.getId()));
        }
        audit.record(operator, null, suspend ? "ops.account_suspended" : "ops.account_unsuspended", "user " + u.getId(), AuditLog.OK,
                req.reason() == null ? null : req.reason().trim());
    }

    /** Where the retired demo data's accounts lived; their shared password was published. */
    static final String RETIRED_DEMO_DOMAIN = "@projectflow.dev";

    /**
     * Accounts left from the retired demo data (…@projectflow.dev, whose shared password was
     * published). With {@code suspend}, as on a production server, each is suspended and signed out
     * everywhere, so nobody can sign in as it (an operator could still unsuspend one deliberately).
     * Otherwise they're only reported. Returns their addresses.
     */
    @Transactional
    public List<String> retireDemoAccounts(boolean suspend) {
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT id, email FROM users WHERE LOWER(email) LIKE ? AND deleted_at IS NULL AND suspended_at IS NULL ORDER BY email",
                "%" + RETIRED_DEMO_DOMAIN);
        List<String> found = new ArrayList<>();
        for (Map<String, Object> row : rows) {
            long id = ((Number) row.get("id")).longValue();
            found.add(String.valueOf(row.get("email")));
            if (!suspend) continue;
            users.findById(id).ifPresent(u -> u.setSuspendedAt(Instant.now(clock)));
            sessions.revokeAll(id, "suspended", null);
            afterCommit(() -> live.endSessions(id));
            audit.record(null, null, "ops.account_suspended", "user " + id, AuditLog.OK, "retired demo account: its password was published");
        }
        return found;
    }

    /** Signs out every session on the server except the operator's own (after a suspected token or key leak). */
    @Transactional
    public int endAllSessions(Requests.EndAllSessions req) {
        Long operator = CurrentUser.id();
        int ended = sessions.revokeEveryone("ended-by-operator", operator);
        audit.record(operator, null, "ops.sessions_ended", "everyone", AuditLog.OK, ended + " session(s); " + req.reason().trim());
        return ended;
    }

    private static void afterCommit(Runnable r) {
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    r.run();
                }
            });
        } else {
            r.run();
        }
    }

    private static String text(Instant i) {
        return i == null ? null : i.toString();
    }
}
