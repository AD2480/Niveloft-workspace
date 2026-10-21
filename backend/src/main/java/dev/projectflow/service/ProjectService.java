package dev.projectflow.service;

import dev.projectflow.ops.Quotas;
import dev.projectflow.domain.*;
import dev.projectflow.repository.*;
import dev.projectflow.security.ProjectAccess;
import dev.projectflow.security.ProjectAccess.Access;
import dev.projectflow.web.PageResponse;
import dev.projectflow.web.dto.Dto;
import dev.projectflow.web.dto.Requests;
import dev.projectflow.web.error.ApiException;
import java.time.Clock;
import java.time.Instant;
import java.util.*;
import java.util.stream.Collectors;
import dev.projectflow.live.LiveEvents;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Projects, memberships and invitations. */
@Service
public class ProjectService {

    private static final List<ProjectStatus> STATUS_ORDER = List.of(ProjectStatus.ACTIVE, ProjectStatus.ON_HOLD, ProjectStatus.COMPLETED, ProjectStatus.ARCHIVED);

    private final ProjectRepository projects;
    private final ProjectMemberRepository members;
    private final InvitationRepository invitations;
    private final TaskRepository tasks;
    private final UserRepository users;
    private final StoredFileRepository files;
    private final NotificationRepository notificationRepo;
    private final ProjectAccess access;
    private final ActivityService activity;
    private final NotificationService notifications;
    private final FileStorageService storage;
    private final DtoMapper mapper;
    private final Clock clock;
    private final ApplicationEventPublisher events;
    private final Quotas quotas;
    private final dev.projectflow.ops.AuditLog audit;
    private final dev.projectflow.ops.OpsSwitches switches;
    private final dev.projectflow.email.EmailService email;
    private final dev.projectflow.ops.AfterTransaction after;

    public ProjectService(ProjectRepository projects, ProjectMemberRepository members, InvitationRepository invitations, TaskRepository tasks,
                          UserRepository users, StoredFileRepository files, NotificationRepository notificationRepo, ProjectAccess access,
                          ActivityService activity, NotificationService notifications, FileStorageService storage, DtoMapper mapper, Clock clock, ApplicationEventPublisher events,
                          Quotas quotas, dev.projectflow.ops.AuditLog audit, dev.projectflow.ops.OpsSwitches switches, dev.projectflow.email.EmailService email,
                          dev.projectflow.ops.AfterTransaction after) {
        this.after = after;
        this.quotas = quotas;
        this.audit = audit;
        this.switches = switches;
        this.email = email;
        this.projects = projects;
        this.members = members;
        this.invitations = invitations;
        this.tasks = tasks;
        this.users = users;
        this.files = files;
        this.notificationRepo = notificationRepo;
        this.access = access;
        this.activity = activity;
        this.notifications = notifications;
        this.storage = storage;
        this.mapper = mapper;
        this.clock = clock;
        this.events = events;
    }

    private Instant now() {
        return Instant.now(clock);
    }

    private User user(Long id) {
        return users.getReferenceById(id);
    }

    private static String label(Role r) {
        return switch (r) {
            case OWNER -> "owner";
            case MANAGER -> "manager";
            case MEMBER -> "member";
            case VIEWER -> "viewer";
        };
    }

    // ------------------------------------------------------------------ read

    @Transactional(readOnly = true)
    public PageResponse<Dto.ProjectSummary> list(Long userId, String search, ProjectStatus status, int page, int size) {
        List<ProjectMember> mine = members.findByUserId(userId);
        Map<Long, Role> roles = mine.stream().collect(Collectors.toMap(m -> m.getProject().getId(), ProjectMember::getRole));
        String q = search == null ? "" : search.trim().toLowerCase();
        List<Project> filtered = mine.stream().map(ProjectMember::getProject)
                .filter(p -> q.isEmpty() || (p.getName() + " " + p.getKey() + " " + Objects.toString(p.getDescription(), "")).toLowerCase().contains(q))
                .filter(p -> status == null || p.getStatus() == status)
                .sorted(Comparator.comparing((Project p) -> STATUS_ORDER.indexOf(p.getStatus())).thenComparing(Project::getUpdatedAt, Comparator.reverseOrder()))
                .toList();
        // Page first, then load tasks and member counts only for the projects on this page.
        int safeSize = Math.min(Math.max(size == 0 ? 12 : size, 1), 100);
        int totalPages = Math.max(1, (int) Math.ceil(filtered.size() / (double) safeSize));
        int safePage = Math.min(Math.max(page, 0), totalPages - 1);
        List<Project> slice = filtered.subList(safePage * safeSize, Math.min(filtered.size(), safePage * safeSize + safeSize));
        List<Long> ids = slice.stream().map(Project::getId).toList();
        Map<Long, List<Task>> byProject = ids.isEmpty() ? Map.of() : tasks.findByProjectIdIn(ids).stream().collect(Collectors.groupingBy(t -> t.getProject().getId()));
        Map<Long, Long> memberCounts = ids.isEmpty() ? Map.of()
                : members.findByProjectIdIn(ids).stream().collect(Collectors.groupingBy(m -> m.getProject().getId(), Collectors.counting()));
        return new PageResponse<>(slice.stream().map(p -> mapper.projectSummary(p, roles.get(p.getId()), byProject.getOrDefault(p.getId(), List.of()),
                memberCounts.getOrDefault(p.getId(), 0L))).toList(), safePage, safeSize, filtered.size(), totalPages);
    }

    @Transactional(readOnly = true)
    public Dto.ProjectDetail get(Long projectId) {
        Access a = access.require(projectId);
        return detail(a.project(), a.role());
    }

    private Dto.ProjectDetail detail(Project p, Role role) {
        List<Task> projectTasks = tasks.findByProjectId(p.getId());
        return mapper.projectDetail(p, role, projectTasks, mapper.members(members.findByProjectId(p.getId()), projectTasks));
    }

    // ----------------------------------------------------------------- write

    private void validateProject(Requests.ProjectRequest req, Long existingId) {
        String key = req.key().toUpperCase();
        if (req.deadline() != null && req.deadline().isBefore(req.startDate())) {
            throw ApiException.validation("deadline", "Deadline must be on or after the start date.");
        }
        boolean taken = existingId == null ? projects.existsByKey(key) : projects.existsByKeyAndIdNot(key, existingId);
        if (taken) throw ApiException.conflict("That project key is already in use.", "key");
    }

    @Transactional
    public Dto.ProjectDetail create(Long userId, Requests.ProjectRequest req) {
        validateProject(req, null);
        quotas.checkProjectRoom(userId);
        Instant ts = now();
        Project p = new Project();
        p.setKey(req.key().toUpperCase());
        p.setName(req.name().trim());
        p.setDescription(blankToNull(req.description()));
        p.setColor(req.color() == null ? AuthService.PALETTE.get(0) : req.color());
        p.setStatus(req.status() == null ? ProjectStatus.ACTIVE : req.status());
        p.setStartDate(req.startDate());
        p.setDeadline(req.deadline());
        User me = users.findById(userId).orElseThrow();
        p.setOwner(me);
        p.setTaskSeq(0);
        p.setCreatedAt(ts);
        p.setUpdatedAt(ts);
        projects.save(p);
        ProjectMember m = new ProjectMember();
        m.setProject(p);
        m.setUser(me);
        m.setRole(Role.OWNER);
        m.setJoinedAt(ts);
        members.save(m);
        activity.log(p, null, me, ActivityType.PROJECT_CREATED, "created the project");
        return detail(p, Role.OWNER);
    }

    @Transactional
    public Dto.ProjectDetail update(Long projectId, Requests.ProjectRequest req) {
        Access a = access.require(projectId);
        if (!Permissions.editProject(a.role())) throw ApiException.forbidden("Only owners and managers can edit project details.");
        Project p = a.project();
        if (req.version() != null && req.version() != p.getVersion()) {
            throw ApiException.editConflict("This project was changed by someone else. Reload to see the latest details, then try again.");
        }
        validateProject(req, p.getId());
        ProjectStatus newStatus = req.status() == null ? p.getStatus() : req.status();
        boolean statusChanged = newStatus != p.getStatus();
        ProjectStatus oldStatus = p.getStatus();
        p.setKey(req.key().toUpperCase());
        p.setName(req.name().trim());
        p.setDescription(blankToNull(req.description()));
        if (req.color() != null) p.setColor(req.color());
        p.setStatus(newStatus);
        p.setStartDate(req.startDate());
        p.setDeadline(req.deadline());
        p.setUpdatedAt(now());
        User me = user(a.userId());
        if (statusChanged) {
            activity.log(p, null, me, ActivityType.PROJECT_UPDATED, "changed the project status",
                    new ActivityService.Change("status", oldStatus.name(), newStatus.name()));
        } else {
            activity.log(p, null, me, ActivityType.PROJECT_UPDATED, "updated the project details");
        }
        projects.flush();
        return detail(p, a.role());
    }

    @Transactional
    public void delete(Long projectId) {
        Access a = access.require(projectId);
        if (!Permissions.deleteProject(a.role())) throw ApiException.forbidden("Only the project owner can delete a project.");
        List<String> keys = files.findByProjectId(projectId).stream().map(StoredFile::getStorageKey).toList();
        // Invitation notifications reference the invitation, not the project row.
        invitations.findByProjectIdAndStatusOrderByCreatedAtDesc(projectId, InvitationStatus.PENDING)
                .forEach(i -> notificationRepo.deleteAll(notificationRepo.findByInvitationId(i.getId())));
        // Membership rows disappear with the project, so collect who must be told first.
        Set<Long> memberIds = members.findByProjectId(projectId).stream().map(m -> m.getUser().getId()).collect(Collectors.toSet());
        String name = a.project().getKey() + " (" + a.project().getName() + ")";
        projects.delete(a.project()); // the database cascades to tasks, submissions, files, activity…
        projects.flush();
        storage.deleteKeys(keys);
        audit.record(a.userId(), projectId, "project.deleted", name, dev.projectflow.ops.AuditLog.OK, keys.size() + " file(s) removed");
        events.publishEvent(new LiveEvents.ProjectChanged(projectId, null, a.userId(), "PROJECT_DELETED", memberIds));
    }

    /**
     * For account deletion: deletes a project the account owns alone (no other members), with its
     * files. Returns the storage keys to remove once the transaction commits.
     */
    List<String> deleteSoleOwned(Project p, Long ownerId) {
        List<String> keys = files.findByProjectId(p.getId()).stream().map(StoredFile::getStorageKey).toList();
        invitations.findByProjectIdAndStatusOrderByCreatedAtDesc(p.getId(), InvitationStatus.PENDING)
                .forEach(i -> notificationRepo.deleteAll(notificationRepo.findByInvitationId(i.getId())));
        Long id = p.getId();
        String name = p.getKey() + " (" + p.getName() + ")";
        projects.delete(p);
        projects.flush();
        audit.record(ownerId, id, "project.deleted", name, dev.projectflow.ops.AuditLog.OK, "with the owner's account");
        return keys;
    }

    /** For account deletion: leaves every project the account is a (non-owner) member of. */
    void leaveAllForDeletedAccount(User u) {
        for (ProjectMember m : members.findByUserId(u.getId())) {
            if (m.getRole() == Role.OWNER) continue;
            Project p = m.getProject();
            members.delete(m);
            unassignOpenTasks(p.getId(), u.getId());
            activity.log(p, null, u, ActivityType.MEMBER_REMOVED, "left the project (account deleted)");
            events.publishEvent(new LiveEvents.ProjectChanged(p.getId(), null, u.getId(), "MEMBER_REMOVED", Set.of(u.getId())));
        }
    }

    /**
     * Makes another member the owner. Only the owner can; the new owner must be a current member
     * with an active account. The previous owner stays on as a manager, so a project always has
     * exactly one owner.
     */
    @Transactional
    public Dto.Member transferOwnership(Long projectId, Long memberId) {
        Access a = access.require(projectId);
        if (a.role() != Role.OWNER) throw ApiException.forbidden("Only the project owner can hand the project to someone else.");
        ProjectMember target = membership(projectId, memberId);
        User next = target.getUser();
        if (next.getId().equals(a.userId())) throw ApiException.validation("memberId", "You already own this project.");
        if (next.getDeletedAt() != null || next.getSuspendedAt() != null) {
            throw ApiException.validation("memberId", next.getName() + "’s account can’t sign in, so it can’t own the project.");
        }
        ProjectMember mine = members.findByProjectIdAndUserId(projectId, a.userId()).orElseThrow();
        Role before = target.getRole();
        mine.setRole(Role.MANAGER);
        target.setRole(Role.OWNER);
        a.project().setOwner(next);
        User me = user(a.userId());
        activity.log(a.project(), null, me, ActivityType.MEMBER_ROLE_CHANGED, "made " + next.getName() + " the owner",
                new ActivityService.Change("role", capitalize(label(before)), "Owner"));
        notifications.notify(next.getId(), me, NotificationType.ROLE_CHANGED, "You own a project now",
                me.getName() + " made you the owner of “" + a.project().getName() + "”. They stay on as a manager.",
                "/projects/" + projectId + "/settings", projectId, null);
        audit.record(a.userId(), projectId, "project.ownership_transferred", "user " + next.getId(), dev.projectflow.ops.AuditLog.OK,
                "previous owner is now a manager");
        int open = tasks.findOpenAssigned(projectId, next.getId()).size();
        return mapper.member(target, open);
    }

    @Transactional
    public void leave(Long projectId) {
        Access a = access.require(projectId);
        if (!Permissions.leaveProject(a.role())) {
            throw ApiException.forbidden("The owner cannot leave the project. Delete it or transfer ownership instead.");
        }
        ProjectMember m = members.findByProjectIdAndUserId(projectId, a.userId()).orElseThrow();
        members.delete(m);
        unassignOpenTasks(projectId, a.userId());
        revokePendingFor(projectId, m.getUser().getEmail());
        activity.log(a.project(), null, user(a.userId()), ActivityType.MEMBER_REMOVED, "left the project");
        audit.record(a.userId(), projectId, "project.member_left", "user " + a.userId(), dev.projectflow.ops.AuditLog.OK, null);
    }

    /** A person who left or was removed can't be brought back by an invitation that was already pending. */
    private void revokePendingFor(Long projectId, String address) {
        Instant ts = now();
        invitations.findByProjectIdAndStatusOrderByCreatedAtDesc(projectId, InvitationStatus.PENDING).stream()
                .filter(i -> i.getEmail().equalsIgnoreCase(address))
                .forEach(i -> {
                    i.setStatus(InvitationStatus.REVOKED);
                    i.setRespondedAt(ts);
                });
    }

    private void unassignOpenTasks(Long projectId, Long userId) {
        Instant ts = now();
        for (Task t : tasks.findOpenAssigned(projectId, userId)) {
            t.setAssignee(null);
            t.setUpdatedAt(ts);
        }
    }

    private static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }

    // ---------------------------------------------------------------- members

    @Transactional(readOnly = true)
    public List<Dto.Member> members(Long projectId) {
        access.require(projectId);
        return mapper.members(members.findByProjectId(projectId), tasks.findByProjectId(projectId));
    }

    private ProjectMember membership(Long projectId, Long memberId) {
        return members.findById(memberId)
                .filter(m -> m.getProject().getId().equals(projectId))
                .orElseThrow(() -> ApiException.notFound("Member not found."));
    }

    @Transactional
    public Dto.Member changeRole(Long projectId, Long memberId, Role newRole) {
        Access a = access.require(projectId);
        ProjectMember m = membership(projectId, memberId);
        if (!Permissions.manageMember(a.role(), m.getRole(), m.getUser().getId().equals(a.userId()))) {
            throw ApiException.forbidden("You cannot change this member’s role.");
        }
        if (newRole == Role.OWNER) {
            throw ApiException.forbidden("To make someone the owner, use “Transfer ownership” in the project’s settings.");
        }
        if (!Permissions.assignableRoles(a.role()).contains(newRole)) {
            throw ApiException.forbidden("You cannot grant the " + label(newRole) + " role.");
        }
        if (m.getRole() != newRole) {
            Role previous = m.getRole();
            m.setRole(newRole);
            if (newRole == Role.VIEWER) unassignOpenTasks(projectId, m.getUser().getId());
            User me = user(a.userId());
            activity.log(a.project(), null, me, ActivityType.MEMBER_ROLE_CHANGED, "changed " + m.getUser().getName() + "’s role",
                    new ActivityService.Change("role", capitalize(label(previous)), capitalize(label(newRole))));
            notifications.notify(m.getUser().getId(), me, NotificationType.ROLE_CHANGED, "Your role changed",
                    me.getName() + " changed your role in “" + a.project().getName() + "” to " + capitalize(label(newRole)) + ".",
                    "/projects/" + projectId, projectId, null);
            audit.record(a.userId(), projectId, "project.role_changed", "user " + m.getUser().getId(), dev.projectflow.ops.AuditLog.OK,
                    label(previous) + " → " + label(newRole));
        }
        int open = tasks.findOpenAssigned(projectId, m.getUser().getId()).size();
        return mapper.member(m, open);
    }

    private static String capitalize(String s) {
        return Character.toUpperCase(s.charAt(0)) + s.substring(1);
    }

    @Transactional
    public void removeMember(Long projectId, Long memberId) {
        Access a = access.require(projectId);
        ProjectMember m = membership(projectId, memberId);
        if (!Permissions.manageMember(a.role(), m.getRole(), m.getUser().getId().equals(a.userId()))) {
            throw ApiException.forbidden("You cannot remove this member.");
        }
        members.delete(m);
        unassignOpenTasks(projectId, m.getUser().getId());
        revokePendingFor(projectId, m.getUser().getEmail());
        activity.log(a.project(), null, user(a.userId()), ActivityType.MEMBER_REMOVED, "removed " + m.getUser().getName() + " from the project");
        audit.record(a.userId(), projectId, "project.member_removed", "user " + m.getUser().getId(), dev.projectflow.ops.AuditLog.OK, null);
        // The removed person is no longer a member, so the activity event above won't reach them.
        events.publishEvent(new LiveEvents.ProjectChanged(projectId, null, a.userId(), "MEMBER_REMOVED", Set.of(m.getUser().getId())));
    }

    // ------------------------------------------------------------ invitations

    @Transactional(readOnly = true)
    public List<Dto.Invitation> projectInvitations(Long projectId) {
        Access a = access.require(projectId);
        if (!Permissions.manageMembers(a.role())) throw ApiException.forbidden("Only owners and managers can view invitations.");
        Instant ts = now();
        return invitations.findByProjectIdAndStatusOrderByCreatedAtDesc(projectId, InvitationStatus.PENDING).stream()
                .filter(i -> !i.expiredAt(ts)).map(mapper::invitation).toList();
    }

    @Transactional
    public Dto.Invitation invite(Long projectId, Requests.Invite req) {
        Access a = access.require(projectId);
        if (!Permissions.manageMembers(a.role())) throw ApiException.forbidden("Only owners and managers can invite people.");
        switches.require("invitations");
        if (!Permissions.assignableRoles(a.role()).contains(req.role())) {
            throw ApiException.validation("role", "Choose a role you are allowed to grant.");
        }
        quotas.checkMemberRoom(projectId);
        String email = req.email().trim().toLowerCase();
        Optional<User> existing = users.findByEmailIgnoreCase(email);
        if (existing.isPresent() && members.existsByProjectIdAndUserId(projectId, existing.get().getId())) {
            throw ApiException.conflict(existing.get().getName() + " is already a member of this project.", "email");
        }
        Instant sentAt = now();
        // An expired invitation doesn't block a new one.
        invitations.findByProjectIdAndStatusOrderByCreatedAtDesc(projectId, InvitationStatus.PENDING).stream()
                .filter(i -> i.getEmail().equalsIgnoreCase(email) && i.expiredAt(sentAt))
                .forEach(i -> {
                    i.setStatus(InvitationStatus.REVOKED);
                    i.setRespondedAt(sentAt);
                });
        invitations.flush();
        if (invitations.existsByProjectIdAndEmailIgnoreCaseAndStatus(projectId, email, InvitationStatus.PENDING)) {
            throw ApiException.conflict("An invitation is already pending for this email.", "email");
        }
        User me = user(a.userId());
        Invitation inv = new Invitation();
        inv.setProject(a.project());
        inv.setEmail(email);
        inv.setRole(req.role());
        inv.setStatus(InvitationStatus.PENDING);
        inv.setInvitedBy(me);
        inv.setCreatedAt(sentAt);
        inv.setExpiresAt(sentAt.plus(Invitation.TTL));
        invitations.save(inv);
        activity.log(a.project(), null, me, ActivityType.INVITATION_SENT, "invited " + email + " as " + label(req.role()));
        audit.record(a.userId(), projectId, "project.invitation_sent", "invitation " + inv.getId(), dev.projectflow.ops.AuditLog.OK,
                "as " + label(req.role()) + (existing.isPresent() ? ", existing account" : ", no account yet"));
        existing.ifPresent(u -> notifications.notify(u.getId(), me, NotificationType.INVITATION, "Project invitation",
                me.getName() + " invited you to join “" + a.project().getName() + "” as " + label(req.role()) + ".",
                "/inbox", null, inv.getId()));
        return mapper.invitation(inv);
    }

    @Transactional
    public void revoke(Long projectId, Long invitationId) {
        Access a = access.require(projectId);
        if (!Permissions.manageMembers(a.role())) throw ApiException.forbidden("Only owners and managers can revoke invitations.");
        Invitation inv = invitations.findById(invitationId).filter(i -> i.getProject().getId().equals(projectId))
                .orElseThrow(() -> ApiException.notFound("Invitation not found."));
        if (inv.getStatus() != InvitationStatus.PENDING) throw ApiException.conflict("Only pending invitations can be revoked.");
        inv.setStatus(InvitationStatus.REVOKED);
        inv.setRespondedAt(now());
        audit.record(a.userId(), projectId, "project.invitation_revoked", "invitation " + invitationId, dev.projectflow.ops.AuditLog.OK, null);
    }

    @Transactional(readOnly = true)
    public List<Dto.Invitation> myInvitations(Long userId) {
        User me = users.findById(userId).orElseThrow();
        Instant ts = now();
        return invitations.findByEmailIgnoreCaseAndStatusOrderByCreatedAtDesc(me.getEmail(), InvitationStatus.PENDING).stream()
                .filter(i -> !i.expiredAt(ts)).map(mapper::invitation).toList();
    }

    @Transactional
    public Dto.ProjectRef respond(Long userId, Long invitationId, boolean accept) {
        User me = users.findById(userId).orElseThrow();
        Invitation inv = invitations.findById(invitationId)
                .filter(i -> i.getEmail().equalsIgnoreCase(me.getEmail()))
                .orElseThrow(() -> ApiException.notFound("Invitation not found."));
        if (inv.getStatus() != InvitationStatus.PENDING) {
            throw ApiException.conflict("This invitation was already " + inv.getStatus().name().toLowerCase() + ".");
        }
        Project target = inv.getProject();
        if (accept) {
            if (inv.expiredAt(now())) {
                throw ApiException.conflict("This invitation expired. Ask " + inv.getInvitedBy().getName() + " or another manager of “" + target.getName() + "” to invite you again.");
            }
            // Invitations go to an address; when this server can send email, accepting one needs the address confirmed.
            if (email.enabled() && !me.isEmailVerified()) {
                throw new ApiException(org.springframework.http.HttpStatus.FORBIDDEN, dev.projectflow.web.error.ErrorCode.EMAIL_NOT_VERIFIED,
                        "Confirm your email address first: the invitation was sent to " + inv.getEmail() + ", and confirming shows it’s yours. Use the link we emailed you, or send a new one from the sign-in page.", null);
            }
            // The invitation is only as good as its sender's rights now, not when it was sent.
            Role inviterRole = members.findByProjectIdAndUserId(target.getId(), inv.getInvitedBy().getId()).map(ProjectMember::getRole).orElse(null);
            if (inviterRole == null || !Permissions.manageMembers(inviterRole) || !Permissions.assignableRoles(inviterRole).contains(inv.getRole())) {
                // Retired for good, even though refusing rolls this transaction back.
                Long staleId = inv.getId();
                Instant ts = now();
                after.runAfterCompletion(() -> invitations.findById(staleId).filter(i -> i.getStatus() == InvitationStatus.PENDING).ifPresent(i -> {
                    i.setStatus(InvitationStatus.REVOKED);
                    i.setRespondedAt(ts);
                }));
                audit.record(userId, target.getId(), "project.invitation_accepted", "invitation " + inv.getId(), dev.projectflow.ops.AuditLog.DENIED,
                        "the sender can no longer grant this role");
                throw ApiException.conflict("This invitation is no longer valid: the person who sent it can no longer invite people as "
                        + label(inv.getRole()) + ". Ask a current owner or manager of “" + target.getName() + "” to invite you again.");
            }
            if (!members.existsByProjectIdAndUserId(target.getId(), userId)) quotas.checkMemberRoom(target.getId());
        }
        inv.setStatus(accept ? InvitationStatus.ACCEPTED : InvitationStatus.DECLINED);
        inv.setRespondedAt(now());
        notificationRepo.findByInvitationId(inv.getId()).stream().filter(n -> n.getUserId().equals(userId)).forEach(n -> n.setRead(true));
        Project p = inv.getProject();
        if (accept && !members.existsByProjectIdAndUserId(p.getId(), userId)) {
            ProjectMember m = new ProjectMember();
            m.setProject(p);
            m.setUser(me);
            m.setRole(inv.getRole());
            m.setJoinedAt(now());
            members.save(m);
            activity.log(p, null, me, ActivityType.MEMBER_JOINED, "joined the project as " + label(inv.getRole()));
        }
        audit.record(userId, p.getId(), accept ? "project.invitation_accepted" : "project.invitation_declined", "invitation " + inv.getId(),
                dev.projectflow.ops.AuditLog.OK, accept ? "as " + label(inv.getRole()) : null);
        return new Dto.ProjectRef(p.getId());
    }
}
