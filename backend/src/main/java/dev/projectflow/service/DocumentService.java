package dev.projectflow.service;

import dev.projectflow.domain.ActivityType;
import dev.projectflow.domain.Role;
import dev.projectflow.domain.User;
import dev.projectflow.repository.UserRepository;
import dev.projectflow.security.ProjectAccess;
import dev.projectflow.web.dto.Dto;
import dev.projectflow.web.dto.Requests;
import dev.projectflow.web.error.ApiException;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Project documents: specifications, meeting notes and decisions a team writes or imports, which
 * Flurry may search once an owner or manager has approved them.
 *
 * <ul>
 *   <li>Every member sees approved documents. A draft is seen by its author and by owners and
 *       managers, so unapproved text never reaches anyone else, or Flurry.</li>
 *   <li>Members write drafts. Owners and managers edit any document and approve or withdraw
 *       approval; an author edits and deletes their own draft.</li>
 *   <li>Changing an approved document's text sends it back to draft: what Flurry reads is always
 *       what was approved.</li>
 * </ul>
 */
@Service
public class DocumentService {

    public static final String DRAFT = "DRAFT";
    public static final String APPROVED = "APPROVED";
    static final int MAX_BODY = 200_000;
    static final int MAX_DOCUMENTS = 200;

    private final JdbcTemplate jdbc;
    private final ProjectAccess access;
    private final UserRepository users;
    private final ActivityService activity;
    private final DtoMapper mapper;
    private final Clock clock;

    public DocumentService(JdbcTemplate jdbc, ProjectAccess access, UserRepository users, ActivityService activity, DtoMapper mapper, Clock clock) {
        this.jdbc = jdbc;
        this.access = access;
        this.users = users;
        this.activity = activity;
        this.mapper = mapper;
        this.clock = clock;
    }

    /** One stored document, as read from the table. */
    record Row(long id, long projectId, String title, String body, String status, Long createdBy, Instant createdAt, Long updatedBy, Instant updatedAt,
               Long approvedBy, Instant approvedAt, int version, int passages) {}

    private static Instant instant(ResultSet rs, String col) throws SQLException {
        Timestamp t = rs.getTimestamp(col);
        return t == null ? null : t.toInstant();
    }

    private static Long longOrNull(ResultSet rs, String col) throws SQLException {
        long v = rs.getLong(col);
        return rs.wasNull() ? null : v;
    }

    private static Row row(ResultSet rs, boolean withBody) throws SQLException {
        return new Row(rs.getLong("id"), rs.getLong("project_id"), rs.getString("title"), withBody ? rs.getString("body") : null, rs.getString("status"),
                longOrNull(rs, "created_by"), instant(rs, "created_at"), longOrNull(rs, "updated_by"), instant(rs, "updated_at"), longOrNull(rs, "approved_by"),
                instant(rs, "approved_at"), rs.getInt("version"), rs.getInt("passages"));
    }

    private static final String COLUMNS = "d.id, d.project_id, d.title, d.status, d.created_by, d.created_at, d.updated_by, d.updated_at, d.approved_by, d.approved_at, d.version, "
            + "(SELECT COUNT(*) FROM document_passages p WHERE p.document_id = d.id) AS passages";

    static boolean canSee(Role role, Long me, Row d) {
        return APPROVED.equals(d.status()) || Permissions.atLeast(role, Role.MANAGER) || Objects.equals(d.createdBy(), me);
    }

    static boolean canEdit(Role role, Long me, Row d) {
        return Permissions.atLeast(role, Role.MANAGER) || (role == Role.MEMBER && DRAFT.equals(d.status()) && Objects.equals(d.createdBy(), me));
    }

    static boolean canDelete(Role role, Long me, Row d) {
        return canEdit(role, me, d);
    }

    static boolean canApprove(Role role) {
        return Permissions.atLeast(role, Role.MANAGER);
    }

    private Map<Long, Dto.UserSummary> people(Collection<Row> rows) {
        Set<Long> ids = new HashSet<>();
        rows.forEach(r -> {
            if (r.createdBy() != null) ids.add(r.createdBy());
            if (r.updatedBy() != null) ids.add(r.updatedBy());
            if (r.approvedBy() != null) ids.add(r.approvedBy());
        });
        Map<Long, Dto.UserSummary> out = new HashMap<>();
        for (User u : users.findAllById(ids)) out.put(u.getId(), mapper.summary(u));
        return out;
    }

    @Transactional(readOnly = true)
    public List<Dto.DocumentSummary> list(Long projectId) {
        ProjectAccess.Access a = access.require(projectId);
        Map<Long, Integer> chars = new HashMap<>();
        List<Row> rows = jdbc.query("SELECT " + COLUMNS + ", LENGTH(d.body) AS chars FROM project_documents d WHERE d.project_id = ? ORDER BY d.title, d.id", (rs, i) -> {
            chars.put(rs.getLong("id"), rs.getInt("chars"));
            return row(rs, false);
        }, projectId);
        List<Row> visible = rows.stream().filter(r -> canSee(a.role(), a.userId(), r)).toList();
        Map<Long, Dto.UserSummary> who = people(visible);
        return visible.stream().map(r -> new Dto.DocumentSummary(r.id(), r.title(), r.status(), chars.getOrDefault(r.id(), 0), r.passages(), who.get(r.updatedBy()),
                r.updatedAt(), who.get(r.approvedBy()), r.approvedAt(), Objects.equals(r.createdBy(), a.userId()), r.version())).toList();
    }

    private Row find(Long projectId, Long id) {
        List<Row> rows = jdbc.query("SELECT " + COLUMNS + ", d.body FROM project_documents d WHERE d.id = ? AND d.project_id = ?", (rs, i) -> row(rs, true), id, projectId);
        if (rows.isEmpty()) throw ApiException.notFound("Document not found.");
        return rows.get(0);
    }

    @Transactional(readOnly = true)
    public Dto.Document get(Long projectId, Long id) {
        ProjectAccess.Access a = access.require(projectId);
        Row d = find(projectId, id);
        // A draft someone may not see is "not found", the same as a document that doesn't exist.
        if (!canSee(a.role(), a.userId(), d)) throw ApiException.notFound("Document not found.");
        return dto(a, d);
    }

    private Dto.Document dto(ProjectAccess.Access a, Row d) {
        List<Dto.DocumentPassage> passages = jdbc.query("SELECT id, ordinal, heading, content FROM document_passages WHERE document_id = ? ORDER BY ordinal",
                (rs, i) -> new Dto.DocumentPassage(rs.getLong("id"), rs.getInt("ordinal"), rs.getString("heading"), rs.getString("content")), d.id());
        Map<Long, Dto.UserSummary> who = people(List.of(d));
        return new Dto.Document(d.id(), d.projectId(), d.title(), d.body(), d.status(), who.get(d.createdBy()), d.createdAt(), who.get(d.updatedBy()), d.updatedAt(),
                who.get(d.approvedBy()), d.approvedAt(), d.version(), passages, canEdit(a.role(), a.userId(), d), canApprove(a.role()), canDelete(a.role(), a.userId(), d));
    }

    private static String clean(String s) {
        return s == null ? "" : s.replace("\u0000", "").strip();
    }

    private void writePassages(long documentId, long projectId, String body) {
        jdbc.update("DELETE FROM document_passages WHERE document_id = ?", documentId);
        List<DocumentText.Passage> passages = DocumentText.split(body);
        jdbc.batchUpdate("INSERT INTO document_passages (document_id, project_id, ordinal, heading, content) VALUES (?, ?, ?, ?, ?)",
                passages.stream().map(p -> new Object[] {documentId, projectId, p.ordinal(), p.heading(), p.content()}).toList());
    }

    @Transactional
    public Dto.Document create(Long projectId, Requests.DocumentRequest req) {
        ProjectAccess.Access a = access.require(projectId);
        if (!Permissions.atLeast(a.role(), Role.MEMBER)) throw ApiException.forbidden("Viewers can read documents but not add them.");
        if (a.project().getStatus() == dev.projectflow.domain.ProjectStatus.ARCHIVED) throw ApiException.conflict("Archived projects are read-only.");
        Integer count = jdbc.queryForObject("SELECT COUNT(*) FROM project_documents WHERE project_id = ?", Integer.class, projectId);
        if (count != null && count >= MAX_DOCUMENTS) throw ApiException.conflict("A project can hold " + MAX_DOCUMENTS + " documents. Delete one you no longer need first.");
        String title = clean(req.title());
        String body = clean(req.body());
        Timestamp now = Timestamp.from(Instant.now(clock));
        GeneratedKeyHolder keys = new GeneratedKeyHolder();
        jdbc.update(c -> {
            var st = c.prepareStatement("INSERT INTO project_documents (project_id, title, body, status, created_by, created_at, updated_by, updated_at, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)",
                    new String[] {"id"});
            st.setLong(1, projectId);
            st.setString(2, title);
            st.setString(3, body);
            st.setString(4, DRAFT);
            st.setLong(5, a.userId());
            st.setTimestamp(6, now);
            st.setLong(7, a.userId());
            st.setTimestamp(8, now);
            return st;
        }, keys);
        long id = Objects.requireNonNull(keys.getKey()).longValue();
        writePassages(id, projectId, body);
        activity.log(a.project(), null, users.getReferenceById(a.userId()), ActivityType.DOCUMENT_SAVED, "added the document “" + title + "” as a draft");
        return dto(a, find(projectId, id));
    }

    @Transactional
    public Dto.Document update(Long projectId, Long id, Requests.DocumentRequest req) {
        ProjectAccess.Access a = access.require(projectId);
        Row d = find(projectId, id);
        if (!canSee(a.role(), a.userId(), d)) throw ApiException.notFound("Document not found.");
        if (!canEdit(a.role(), a.userId(), d)) {
            throw ApiException.forbidden(APPROVED.equals(d.status()) ? "Only owners and managers can change an approved document." : "Only the author, owners and managers can change this draft.");
        }
        if (req.version() != null && req.version() != d.version()) throw ApiException.editConflict("Someone changed this document since you opened it. Reload to see their version.");
        String title = clean(req.title());
        String body = clean(req.body());
        boolean textChanged = !body.equals(d.body());
        boolean backToDraft = textChanged && APPROVED.equals(d.status());
        int n = jdbc.update("UPDATE project_documents SET title = ?, body = ?, status = ?, updated_by = ?, updated_at = ?, approved_by = ?, approved_at = ?, version = version + 1 WHERE id = ? AND version = ?",
                title, body, backToDraft ? DRAFT : d.status(), a.userId(), Timestamp.from(Instant.now(clock)), backToDraft ? null : d.approvedBy(),
                backToDraft || d.approvedAt() == null ? null : Timestamp.from(d.approvedAt()), id, d.version());
        if (n == 0) throw ApiException.editConflict("Someone changed this document since you opened it. Reload to see their version.");
        if (textChanged) writePassages(id, projectId, body);
        activity.log(a.project(), null, users.getReferenceById(a.userId()), ActivityType.DOCUMENT_SAVED,
                "edited the document “" + title + "”" + (backToDraft ? ", which needs approving again" : ""));
        return dto(a, find(projectId, id));
    }

    @Transactional
    public Dto.Document approve(Long projectId, Long id, boolean approve) {
        ProjectAccess.Access a = access.require(projectId);
        if (!canApprove(a.role())) throw ApiException.forbidden("Only owners and managers approve documents for Flurry.");
        Row d = find(projectId, id);
        String next = approve ? APPROVED : DRAFT;
        if (!next.equals(d.status())) {
            Timestamp now = Timestamp.from(Instant.now(clock));
            jdbc.update("UPDATE project_documents SET status = ?, approved_by = ?, approved_at = ?, version = version + 1 WHERE id = ?",
                    next, approve ? a.userId() : null, approve ? now : null, id);
            activity.log(a.project(), null, users.getReferenceById(a.userId()), ActivityType.DOCUMENT_APPROVED,
                    (approve ? "approved the document “" : "withdrew approval of the document “") + d.title() + "”");
        }
        return dto(a, find(projectId, id));
    }

    @Transactional
    public void delete(Long projectId, Long id) {
        ProjectAccess.Access a = access.require(projectId);
        Row d = find(projectId, id);
        if (!canSee(a.role(), a.userId(), d)) throw ApiException.notFound("Document not found.");
        if (!canDelete(a.role(), a.userId(), d)) throw ApiException.forbidden("Only owners and managers can delete an approved document, or the author their draft.");
        jdbc.update("DELETE FROM document_passages WHERE document_id = ?", id); // the foreign key cascades too; this doesn't rely on it
        jdbc.update("DELETE FROM project_documents WHERE id = ?", id);
        activity.log(a.project(), null, users.getReferenceById(a.userId()), ActivityType.DOCUMENT_DELETED, "deleted the document “" + d.title() + "”");
    }

    /** The approved documents' count, for the tools ("no approved documents" is said, not searched). */
    public int approvedCount(Long projectId) {
        Integer n = jdbc.queryForObject("SELECT COUNT(*) FROM project_documents WHERE project_id = ? AND status = 'APPROVED'", Integer.class, projectId);
        return n == null ? 0 : n;
    }
}
