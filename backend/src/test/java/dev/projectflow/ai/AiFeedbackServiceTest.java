package dev.projectflow.ai;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.ObjectMapper;
import dev.projectflow.domain.Project;
import dev.projectflow.domain.Role;
import dev.projectflow.security.ProjectAccess;
import dev.projectflow.web.dto.Dto;
import dev.projectflow.web.dto.Requests;
import dev.projectflow.web.error.ApiException;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.Statement;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Arrays;
import java.util.Comparator;
import java.util.List;
import org.h2.jdbcx.JdbcConnectionPool;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.Resource;
import org.springframework.core.io.support.PathMatchingResourcePatternResolver;
import org.springframework.jdbc.core.JdbcTemplate;

/** Corrections to Flurry on the real schema: a closed list of mistakes, totals and patterns for managers, eval-case drafts. */
class AiFeedbackServiceTest {

    private JdbcConnectionPool pool;
    private JdbcTemplate jdbc;
    private Role role = Role.MEMBER;
    private AiFeedbackService feedback;

    @BeforeEach
    void setUp() throws Exception {
        pool = JdbcConnectionPool.create("jdbc:h2:mem:fb-" + System.nanoTime() + ";MODE=MySQL;DATABASE_TO_LOWER=TRUE;DEFAULT_NULL_ORDERING=HIGH;DB_CLOSE_DELAY=-1", "sa", "");
        try (Connection c = pool.getConnection()) {
            dev.projectflow.TestMigrations.applyLoose(c); // no project or user rows needed
        }
        jdbc = new JdbcTemplate(pool);
        Project p = new Project();
        p.setId(6L);
        ProjectAccess access = new ProjectAccess(null, null, null) {
            @Override
            public Access require(Long projectId) {
                return new Access(p, role, 3L);
            }
        };
        feedback = new AiFeedbackService(jdbc, access, new ObjectMapper(), Clock.fixed(Instant.parse("2026-10-20T10:00:00Z"), ZoneOffset.UTC));
    }

    @AfterEach
    void tearDown() throws Exception {
        try (Connection c = pool.getConnection(); Statement st = c.createStatement()) {
            st.execute("SHUTDOWN");
        }
        pool.dispose();
    }

    private static Requests.AiFeedback wrong(List<String> kinds, String correction, List<String> lookups, String model) {
        return new Requests.AiFeedback("wrong", kinds, correction, "Is ONB-9 approved?", "Yes, ONB-9 was approved yesterday.", model, lookups);
    }

    @Test
    void countsVerdictsKindsModelsAndAnswersWrittenWithoutLookingAnythingUp() {
        feedback.record(6L, new Requests.AiFeedback("right", List.of(), null, "What's late?", "ONB-9 is 3 days late.", "qwen3:8b", List.of("find_tasks found")));
        feedback.record(6L, wrong(List.of("wrong-facts", "overstepped"), "It's still in review: Aarav hasn't decided.", List.of(), "qwen3:8b"));
        feedback.record(6L, wrong(List.of("wrong-facts"), null, List.of("get_task found"), "gpt-x"));
        assertThatThrownBy(() -> feedback.summary(6L, 90)).isInstanceOf(ApiException.class).hasMessageContaining("owners and managers");

        role = Role.MANAGER;
        Dto.AiFeedbackSummary s = feedback.summary(6L, 90);
        assertThat(s.rated()).isEqualTo(3);
        assertThat(s.right()).isEqualTo(1);
        assertThat(s.wrong()).isEqualTo(2);
        assertThat(s.byKind()).containsExactly(org.assertj.core.api.Assertions.entry("wrong-facts", 2L), org.assertj.core.api.Assertions.entry("overstepped", 1L));
        assertThat(s.byModel()).extracting(Dto.AiFeedbackModel::model, Dto.AiFeedbackModel::right, Dto.AiFeedbackModel::wrong)
                .containsExactly(org.assertj.core.groups.Tuple.tuple("gpt-x", 0L, 1L), org.assertj.core.groups.Tuple.tuple("qwen3:8b", 1L, 1L));
        assertThat(s.wrongWithoutLookups()).isEqualTo(1);
        assertThat(s.latest().get(0).correction()).isNull(); // newest first: the gpt-x one had no correction
        assertThat(s.kinds()).containsKey("unknown-as-no");

        String cases = feedback.exportCases(6L, 180);
        assertThat(cases.lines()).hasSize(2);
        assertThat(cases).contains("\"category\":\"from-feedback\"", "\"question\":\"Is ONB-9 approved?\"", "\"correction\":\"It's still in review: Aarav hasn't decided.\"", "\"answer_must\":[]");
    }

    @Test
    void refusesWhatCantBeCounted() {
        assertThatThrownBy(() -> feedback.record(6L, wrong(List.of("rude"), null, List.of(), null))).isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> feedback.record(6L, new Requests.AiFeedback("right", List.of("unclear"), null, "q", "a", null, null))).isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> feedback.record(6L, new Requests.AiFeedback("maybe", null, null, "q", "a", null, null))).isInstanceOf(ApiException.class);
        jdbc.update("INSERT INTO ai_feedback (project_id, verdict, question, answer, created_at) VALUES (6, 'wrong', 'q', 'a', ?)", java.sql.Timestamp.from(Instant.parse("2026-01-01T00:00:00Z")));
        feedback.purge();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM ai_feedback", Integer.class)).isZero();
    }
}
