package dev.projectflow.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.projectflow.domain.Project;
import dev.projectflow.domain.Role;
import dev.projectflow.security.ProjectAccess;
import dev.projectflow.web.dto.Dto;
import dev.projectflow.web.error.ApiException;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.Statement;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Arrays;
import java.util.Comparator;
import org.h2.jdbcx.JdbcConnectionPool;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.Resource;
import org.springframework.core.io.support.PathMatchingResourcePatternResolver;
import org.springframework.jdbc.core.JdbcTemplate;

/** The blocker journey's counts on the real schema (H2 in MySQL mode): words from a closed set, counts only, read by managers. */
class JourneyServiceTest {

    private JdbcConnectionPool pool;
    private JdbcTemplate jdbc;
    private Role role = Role.MEMBER;
    private final Clock clock = Clock.fixed(Instant.parse("2026-10-20T10:00:00Z"), ZoneOffset.UTC);

    private JourneyService service() {
        Project p = new Project();
        p.setId(6L);
        ProjectAccess access = new ProjectAccess(null, null, null) {
            @Override
            public Access require(Long projectId) {
                return new Access(p, role, 7L);
            }
        };
        return new JourneyService(jdbc, access, clock);
    }

    @BeforeEach
    void database() throws Exception {
        pool = JdbcConnectionPool.create("jdbc:h2:mem:journey-" + System.nanoTime() + ";MODE=MySQL;DATABASE_TO_LOWER=TRUE;DEFAULT_NULL_ORDERING=HIGH;DB_CLOSE_DELAY=-1", "sa", "");
        try (Connection c = pool.getConnection()) {
            dev.projectflow.TestMigrations.applyLoose(c); // no project row is needed for counting
        }
        jdbc = new JdbcTemplate(pool);
    }

    @AfterEach
    void close() throws Exception {
        try (Connection c = pool.getConnection(); Statement st = c.createStatement()) {
            st.execute("SHUTDOWN");
        }
        pool.dispose();
    }

    @Test
    void countsStepsAndResponsesForManagersOnly() {
        JourneyService s = service();
        s.record(6L, "shown", "review", null);
        s.record(6L, "shown", "late", null);
        s.record(6L, "evidence", "review", null);
        s.record(6L, "previewed", "review", "ask-review");
        s.record(6L, "confirmed", "review", "ask-review");
        s.record(6L, "previewed", "late", "cut-scope");
        assertThatThrownBy(() -> s.summary(6L, 30)).isInstanceOf(ApiException.class).hasMessageContaining("owners and managers");

        role = Role.MANAGER;
        Dto.JourneySummary sum = service().summary(6L, 30);
        assertThat(sum.steps()).containsEntry("shown", 2L).containsEntry("evidence", 1L).containsEntry("previewed", 2L).containsEntry("confirmed", 1L);
        assertThat(sum.responses().get("ask-review")).containsEntry("previewed", 1L).containsEntry("confirmed", 1L);
        assertThat(sum.responses().get("cut-scope")).containsEntry("previewed", 1L);
        assertThat(sum.days()).isEqualTo(30);
        // Only words: no person, task or text column exists to fill.
        assertThat(jdbc.queryForList("SELECT * FROM journey_events").get(0).keySet()).containsExactlyInAnyOrder("id", "project_id", "step", "blocker_kind", "option_kind", "created_at");
    }

    @Test
    void refusesWordsOutsideTheSetAndForgetsAfterRetention() {
        JourneyService s = service();
        assertThatThrownBy(() -> s.record(6L, "clicked", null, null)).isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> s.record(6L, "shown", "someone@example.com", null)).isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> s.record(6L, "previewed", "late", "delete-everything")).isInstanceOf(ApiException.class);
        jdbc.update("INSERT INTO journey_events (project_id, step, created_at) VALUES (6, 'shown', ?)", java.sql.Timestamp.from(Instant.parse("2026-01-01T00:00:00Z")));
        s.record(6L, "shown", "last", null);
        s.purge();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM journey_events", Integer.class)).isEqualTo(1);
    }
}
