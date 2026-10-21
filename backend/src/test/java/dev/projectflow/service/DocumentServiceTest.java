package dev.projectflow.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.projectflow.domain.*;
import dev.projectflow.repository.UserRepository;
import dev.projectflow.security.ProjectAccess;
import dev.projectflow.web.dto.Dto;
import dev.projectflow.web.dto.Requests;
import dev.projectflow.web.error.ApiException;
import java.lang.reflect.Proxy;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.Statement;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.*;
import org.h2.jdbcx.JdbcConnectionPool;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.Resource;
import org.springframework.core.io.support.PathMatchingResourcePatternResolver;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * Project documents on the real schema (H2 in MySQL mode): who sees and changes what, approval
 * (and losing it when the text changes), passages, and search that only ever reads approved text.
 */
class DocumentServiceTest {

    private JdbcConnectionPool pool;
    private JdbcTemplate jdbc;
    private DocumentService docs;
    private DocumentSearch search;
    private Role role = Role.MEMBER;
    private long me = 3L;
    private final List<String> logged = new ArrayList<>();

    static final String SPEC = "# Sign-in\n\nPeople sign in with a passkey or a password.\n\n## Sessions\n\nA session ends after 30 minutes without activity.\n\n## Recovery\n\nA reset link is valid for one hour.";

    @BeforeEach
    void setUp() throws Exception {
        pool = JdbcConnectionPool.create("jdbc:h2:mem:docs-" + System.nanoTime() + ";MODE=MySQL;DATABASE_TO_LOWER=TRUE;DEFAULT_NULL_ORDERING=HIGH;DB_CLOSE_DELAY=-1", "sa", "");
        try (Connection c = pool.getConnection()) {
            dev.projectflow.TestMigrations.applyLoose(c); // no project or user rows needed
        }
        jdbc = new JdbcTemplate(pool);
        Project p = new Project();
        p.setId(6L);
        p.setStatus(ProjectStatus.ACTIVE);
        ProjectAccess access = new ProjectAccess(null, null, null) {
            @Override
            public Access require(Long projectId) {
                if (!projectId.equals(6L)) throw ApiException.forbidden("You are not a member of this project.");
                return new Access(p, role, me);
            }
        };
        Map<Long, User> people = new HashMap<>();
        for (long id = 1; id <= 4; id++) {
            User u = new User();
            u.setId(id);
            u.setName("Person " + id);
            people.put(id, u);
        }
        UserRepository users = (UserRepository) Proxy.newProxyInstance(UserRepository.class.getClassLoader(), new Class<?>[] {UserRepository.class}, (proxy, m, args) -> {
            if (m.getName().equals("findAllById")) {
                List<User> out = new ArrayList<>();
                for (Object id : (Iterable<?>) args[0]) if (people.containsKey(id)) out.add(people.get(id));
                return out;
            }
            if (m.getName().equals("getReferenceById")) return people.get(args[0]);
            throw new UnsupportedOperationException(m.getName());
        });
        ActivityService activity = new ActivityService(null, null, null, null, null) {
            @Override
            public void log(Project project, Long taskId, User actor, ActivityType type, String message) {
                logged.add(type + " " + message);
            }
        };
        Clock clock = Clock.fixed(Instant.parse("2026-10-20T10:00:00Z"), ZoneOffset.UTC);
        docs = new DocumentService(jdbc, access, users, activity, new DtoMapper(null, null, clock, null), clock);
        search = new DocumentSearch(jdbc);
    }

    @AfterEach
    void tearDown() throws Exception {
        try (Connection c = pool.getConnection(); Statement st = c.createStatement()) {
            st.execute("SHUTDOWN");
        }
        pool.dispose();
    }

    @Test
    void aDraftIsSeenByItsAuthorAndManagersAndNeverSearched() {
        Dto.Document d = docs.create(6L, new Requests.DocumentRequest("Sign-in spec", SPEC, null));
        assertThat(d.status()).isEqualTo("DRAFT");
        assertThat(d.passages()).extracting(Dto.DocumentPassage::heading).containsExactly("Sign-in", "Sign-in › Sessions", "Sign-in › Recovery");
        assertThat(d.canEdit()).isTrue();
        assertThat(d.canApprove()).isFalse();
        assertThat(logged).first().asString().startsWith("DOCUMENT_SAVED added the document “Sign-in spec” as a draft");
        assertThat(search.search(6L, "session minutes", 5)).isEmpty();

        role = Role.VIEWER;
        me = 4L;
        assertThat(docs.list(6L)).isEmpty();
        assertThatThrownBy(() -> docs.get(6L, d.id())).isInstanceOf(ApiException.class).hasMessageContaining("not found");
        assertThatThrownBy(() -> docs.create(6L, new Requests.DocumentRequest("x", "y", null))).hasMessageContaining("Viewers");

        role = Role.MEMBER;
        me = 2L;
        assertThat(docs.list(6L)).isEmpty();
        assertThatThrownBy(() -> docs.approve(6L, d.id(), true)).hasMessageContaining("owners and managers");
    }

    @Test
    void approvalMakesItSearchableAndChangingTheTextTakesThatAway() {
        Dto.Document d = docs.create(6L, new Requests.DocumentRequest("Sign-in spec", SPEC, null));
        role = Role.MANAGER;
        me = 1L;
        Dto.Document ok = docs.approve(6L, d.id(), true);
        assertThat(ok.status()).isEqualTo("APPROVED");
        assertThat(ok.approvedBy().id()).isEqualTo(1L);
        List<DocumentSearch.Hit> hits = search.search(6L, "session minutes", 5);
        assertThat(hits).isNotEmpty();
        assertThat(hits.get(0).heading()).isEqualTo("Sign-in › Sessions");
        assertThat(search.search(7L, "session", 5)).isEmpty();
        assertThat(search.search(6L, "50%_\\", 5)).isEmpty();

        role = Role.VIEWER;
        me = 4L;
        assertThat(docs.list(6L)).hasSize(1);

        role = Role.MEMBER;
        me = 3L;
        assertThatThrownBy(() -> docs.update(6L, d.id(), new Requests.DocumentRequest("Sign-in spec", SPEC + "\n\nMore.", ok.version())))
                .hasMessageContaining("Only owners and managers can change an approved document");

        role = Role.MANAGER;
        me = 1L;
        assertThatThrownBy(() -> docs.update(6L, d.id(), new Requests.DocumentRequest("Sign-in spec", SPEC, 0))).hasMessageContaining("changed this document");
        Dto.Document edited = docs.update(6L, d.id(), new Requests.DocumentRequest("Sign-in spec", SPEC + "\n\n## Lockout\n\nNo account is ever locked.", ok.version()));
        assertThat(edited.status()).isEqualTo("DRAFT");
        assertThat(edited.approvedBy()).isNull();
        assertThat(edited.passages()).hasSize(4);
        assertThat(search.search(6L, "session", 5)).isEmpty();

        Dto.Document again = docs.approve(6L, d.id(), true);
        Dto.Document renamed = docs.update(6L, d.id(), new Requests.DocumentRequest("Sign-in spec v2", again.body(), again.version()));
        assertThat(renamed.status()).isEqualTo("APPROVED"); // a new title alone keeps the approval
    }

    @Test
    void deletingTakesItsPassagesToo() {
        Dto.Document d = docs.create(6L, new Requests.DocumentRequest("Notes", "One.\n\nTwo.", null));
        role = Role.MEMBER;
        me = 2L;
        assertThatThrownBy(() -> docs.delete(6L, d.id())).hasMessageContaining("not found");
        me = 3L;
        docs.delete(6L, d.id());
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM document_passages", Integer.class)).isZero();
        assertThat(logged).last().asString().startsWith("DOCUMENT_DELETED deleted the document “Notes”");
    }
}
