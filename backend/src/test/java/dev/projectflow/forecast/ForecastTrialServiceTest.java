package dev.projectflow.forecast;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.ObjectMapper;
import dev.projectflow.domain.Project;
import dev.projectflow.domain.Role;
import dev.projectflow.ops.OpsSwitches;
import dev.projectflow.security.ProjectAccess;
import dev.projectflow.service.TaskHistoryExport;
import dev.projectflow.web.dto.Dto;
import dev.projectflow.web.error.ApiException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.Statement;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.h2.jdbcx.JdbcConnectionPool;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * The forecast model trial on the real schema (H2 in MySQL mode), with the parity fixture's
 * history and model: forecasts recorded once and never rewritten, actuals once the work is
 * submitted, work new to the model scored after the fact and apart, the switch, and refusals.
 */
class ForecastTrialServiceTest {

    private final ObjectMapper json = new ObjectMapper();
    private JdbcConnectionPool pool;
    private JdbcTemplate jdbc;
    private final Switch sw = new Switch();
    private final History history = new History();
    private final ProjectAccess access;

    ForecastTrialServiceTest() {
        Project p = new Project();
        p.setId(6L);
        p.setKey("SYN");
        access = new ProjectAccess(null, null, null) {
            @Override
            public Access require(Long projectId) {
                if (!projectId.equals(6L)) throw ApiException.forbidden("You are not a member of this project.");
                return new Access(p, Role.VIEWER, 9L);
            }
        };
    }

    private static final class Switch extends OpsSwitches {
        boolean on = true;

        Switch() {
            super(null, null);
        }

        @Override
        public boolean on(String name) {
            return !name.equals("forecast-model") || on;
        }
    }

    private static final class History extends TaskHistoryExport {
        String csv;
        final Map<String, Long> ids = new HashMap<>();

        History() {
            super(null, null, null, null, null, null);
        }

        @Override
        public Snapshot snapshot(Long projectId, String key) {
            return new Snapshot(csv, ids);
        }
    }

    @BeforeEach
    void database() throws Exception {
        pool = JdbcConnectionPool.create("jdbc:h2:mem:trial-" + System.nanoTime() + ";MODE=MySQL;DATABASE_TO_LOWER=TRUE;DEFAULT_NULL_ORDERING=HIGH;DB_CLOSE_DELAY=-1", "sa", "");
        try (Connection c = pool.getConnection()) {
            dev.projectflow.TestMigrations.applyLoose(c); // no project or task rows are needed
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

    private static String edit(String csv, Map<String, Map<String, String>> changes) {
        List<List<String>> rows = HistoryRow.cells(csv);
        List<String> header = rows.get(0);
        StringBuilder out = new StringBuilder(String.join(",", header)).append('\n');
        for (List<String> r : rows.subList(1, rows.size())) {
            if (r.size() < header.size()) continue;
            List<String> copy = new ArrayList<>(r);
            Map<String, String> c = changes.get(r.get(1));
            if (c != null) c.forEach((k, v) -> copy.set(header.indexOf(k), v));
            out.append(String.join(",", copy)).append('\n');
        }
        return out.toString();
    }

    private int count() {
        return jdbc.queryForObject("SELECT COUNT(*) FROM forecast_trial", Integer.class);
    }

    @Test
    void recordsForecastsOnceThenScoresThem() throws Exception {
        String base = new String(WorkDayParityTest.resource("history.csv"), StandardCharsets.UTF_8);
        List<HistoryRow> rows = HistoryRow.parse(base);
        for (int i = 0; i < rows.size(); i++) history.ids.put(rows.get(i).task(), 1000L + i);
        history.csv = base;
        WorkDayModel model = WorkDayModel.read(WorkDayParityTest.resource("model-correction.json"), json);
        Instant through = model.trainedThrough();
        List<WorkDayFeatures.InProgress> work = WorkDayFeatures.inProgress(rows);
        ForecastTrialService trial = new ForecastTrialService(access, history, jdbc, sw, Clock.fixed(through.plus(Duration.ofDays(2)), ZoneOffset.UTC), model, null);

        Dto.ForecastTrial t1 = trial.trial(6L);
        assertThat(t1.available()).isTrue();
        assertThat(t1.open()).hasSize(work.size()).isNotEmpty().allMatch(o -> o.modelDays() > 0 && o.niveloftDays() > 0);
        assertThat(count()).isEqualTo(work.size());
        assertThat(t1.verdict()).startsWith("No work forecast in this trial has been submitted yet");
        trial.trial(6L);
        assertThat(count()).isEqualTo(work.size());

        // A later change to the estimate doesn't rewrite the forecast already made.
        String first = work.get(0).row().task();
        double made = t1.open().stream().filter(o -> o.taskKey().equals(first)).findFirst().orElseThrow().modelDays();
        history.csv = edit(base, Map.of(first, Map.of("estimate_days", "40")));
        assertThat(trial.trial(6L).open().stream().filter(o -> o.taskKey().equals(first)).findFirst().orElseThrow().modelDays()).isEqualTo(made);

        // The work is submitted; a task that started after the model was trained finished unseen.
        Map<String, Map<String, String>> changes = new HashMap<>();
        for (WorkDayFeatures.InProgress w : work) {
            Instant submitted = w.readyAt().plus(Duration.ofDays(5));
            changes.put(w.row().task(), Map.of("status", "DONE", "last_review_at", submitted.toString(), "approved_at", submitted.plus(Duration.ofHours(20)).toString()));
        }
        HistoryRow todo = rows.stream().filter(r -> "TODO".equals(r.status())).findFirst().orElseThrow();
        Instant started = through.plus(Duration.ofDays(1));
        changes.put(todo.task(), Map.of("status", "DONE", "started_at", started.toString(), "last_review_at", started.plus(Duration.ofDays(3)).toString(),
                "approved_at", started.plus(Duration.ofDays(4)).toString(), "waits_on", "0", "blockers_approved_at", ""));
        history.csv = edit(base, changes);
        ForecastTrialService later = new ForecastTrialService(access, history, jdbc, sw, Clock.fixed(through.plus(Duration.ofDays(9)), ZoneOffset.UTC), model, null);
        Dto.ForecastTrial t3 = later.trial(6L);
        assertThat(t3.open()).isEmpty();
        assertThat(t3.beforeFinish().tasks()).isEqualTo(work.size());
        assertThat(t3.recent()).filteredOn(Dto.ForecastTrialResult::beforeFinish).allMatch(r -> Math.abs(r.actualDays() - 5 * 5.0 / 7) < 1e-9);
        assertThat(t3.afterTheFact().tasks()).isEqualTo(1);
        assertThat(t3.verdict()).startsWith("Too early to tell");

        // Switched off: no trial, nothing recorded. Outsiders are refused.
        int n = count();
        sw.on = false;
        assertThat(later.trial(6L).available()).isFalse();
        assertThat(later.trial(6L).reason()).contains("switched off");
        assertThat(count()).isEqualTo(n);
        assertThatThrownBy(() -> later.trial(7L)).isInstanceOf(ApiException.class);
    }

    @Test
    void saysWhyThereIsNoTrial(@TempDir Path dir) throws Exception {
        Clock clock = Clock.systemUTC();
        assertThat(new ForecastTrialService(access, history, jdbc, sw, clock, null, ForecastTrialService.NONE).trial(6L).reason()).contains("No trained forecast model");
        Path syn = dir.resolve("model.json");
        Files.write(syn, WorkDayParityTest.resource("model-linear.json"));
        assertThat(new ForecastTrialService(access, history, jdbc, sw, clock, json, syn.toString(), false).trial(6L).reason()).contains("made-up data");
        assertThat(new ForecastTrialService(access, history, jdbc, sw, clock, json, syn.toString(), true).configured()).isTrue();
        assertThat(new ForecastTrialService(access, history, jdbc, sw, clock, json, dir.resolve("none.json").toString(), false).trial(6L).reason()).contains("couldn’t be read");
        Files.writeString(syn, "{\"schema\":\"something-else\"}");
        assertThat(new ForecastTrialService(access, history, jdbc, sw, clock, json, syn.toString(), true).trial(6L).reason()).contains("was refused").contains("schema");
    }

    @Test
    void theVerdictNeverOversells() {
        Dto.ForecastTrialScore none = new Dto.ForecastTrialScore(0, null, null, 0, 0);
        assertThat(ForecastTrialService.verdict(new Dto.ForecastTrialScore(40, 1.25, 1.40, 28, 12), none)).startsWith("So far the model is ahead.").contains("switching is your decision");
        assertThat(ForecastTrialService.verdict(new Dto.ForecastTrialScore(40, 1.40, 1.25, 12, 28), none)).startsWith("So far Niveloft’s forecast is ahead.");
        assertThat(ForecastTrialService.verdict(new Dto.ForecastTrialScore(40, 1.30, 1.31, 20, 20), none)).startsWith("So far they’re about even.");
        assertThat(ForecastTrialService.verdict(new Dto.ForecastTrialScore(12, 1.10, 1.50, 10, 2), none)).startsWith("Too early to tell");
    }
}
