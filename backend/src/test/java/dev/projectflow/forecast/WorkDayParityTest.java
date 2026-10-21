package dev.projectflow.forecast;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * The server's forecast features and models against the ml/ kit's own numbers on the same file
 * (resources/forecast, written by ml/scripts/forecast_parity_fixture.py): every finished task and
 * every task in progress, feature by feature, and each kind of model's prediction.
 */
class WorkDayParityTest {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final List<String> KINDS = List.of("linear", "gbm", "correction", "forest");

    static byte[] resource(String name) throws IOException {
        try (InputStream in = WorkDayParityTest.class.getResourceAsStream("/forecast/" + name)) {
            if (in == null) throw new IOException("missing test resource forecast/" + name);
            return in.readAllBytes();
        }
    }

    /** expected.csv, by "kind|task". */
    static Map<String, Map<String, String>> expected() throws IOException {
        List<List<String>> lines = HistoryRow.cells(new String(resource("expected.csv"), StandardCharsets.UTF_8));
        List<String> header = lines.get(0);
        Map<String, Map<String, String>> out = new HashMap<>();
        for (List<String> line : lines.subList(1, lines.size())) {
            if (line.size() < header.size()) continue;
            Map<String, String> row = new HashMap<>();
            for (int i = 0; i < header.size(); i++) row.put(header.get(i), line.get(i));
            out.put(row.get("kind") + "|" + row.get("task"), row);
        }
        return out;
    }

    static double num(String s) {
        return s == null || s.isEmpty() ? Double.NaN : Double.parseDouble(s);
    }

    static void close(double got, double want, String what) {
        if (Double.isNaN(want)) {
            assertThat(got).as(what).isNaN();
        } else {
            assertThat(Math.abs(got - want)).as(what + ": " + got + " vs " + want).isLessThanOrEqualTo(1e-9 * Math.max(1, Math.abs(want)));
        }
    }

    @Test
    void featuresAndPredictionsMatchTheKit() throws Exception {
        List<HistoryRow> rows = HistoryRow.parse(new String(resource("history.csv"), StandardCharsets.UTF_8));
        List<WorkDayFeatures.Finished> finished = WorkDayFeatures.finished(rows);
        List<WorkDayFeatures.InProgress> work = WorkDayFeatures.inProgress(rows);
        Map<String, Map<String, String>> want = expected();
        assertThat(finished.size() + work.size()).isEqualTo(want.size());
        Map<String, WorkDayModel> models = new HashMap<>();
        for (String k : KINDS) models.put(k, WorkDayModel.read(resource("model-" + k + ".json"), JSON));

        List<WorkDayFeatures.Starting> all = new ArrayList<>();
        Map<WorkDayFeatures.Finished, WorkDayFeatures.Known> knownDone = WorkDayFeatures.knownAtStart(rows, finished, finished);
        Map<WorkDayFeatures.InProgress, WorkDayFeatures.Known> knownWork = WorkDayFeatures.knownAtStart(rows, finished, work);
        all.addAll(finished);
        all.addAll(work);
        int nan = 0;
        for (WorkDayFeatures.Starting s : all) {
            boolean done = s instanceof WorkDayFeatures.Finished;
            Map<String, String> w = want.get((done ? "finished" : "in_progress") + "|" + s.row().task());
            assertThat(w).as(s.row().task()).isNotNull();
            assertThat(s.readyAt()).as("ready " + s.row().task()).isEqualTo(OffsetDateTime.parse(w.get("ready_at")).toInstant());
            if (done) close(((WorkDayFeatures.Finished) s).workDays(), num(w.get("work_days")), "work days " + s.row().task());
            WorkDayFeatures.Known k = done ? knownDone.get((WorkDayFeatures.Finished) s) : knownWork.get((WorkDayFeatures.InProgress) s);
            double[] x = WorkDayFeatures.build(s.row(), s.readyAt(), k);
            for (int i = 0; i < x.length; i++) {
                if (Double.isNaN(x[i])) nan++;
                close(x[i], num(w.get(WorkDayFeatures.FEATURES.get(i))), WorkDayFeatures.FEATURES.get(i) + " of " + s.row().task());
            }
            for (String kind : KINDS) close(models.get(kind).predictLog(x), num(w.get("predict_" + kind)), kind + " for " + s.row().task());
        }
        assertThat(nan).as("missing values are exercised").isPositive();
        assertThat(work).isNotEmpty();
    }

    @Test
    void refusesWhatItCannotRunFaithfully() throws Exception {
        String good = new String(resource("model-linear.json"), StandardCharsets.UTF_8);
        assertThatThrownBy(() -> WorkDayModel.read(good.replace("niveloft-work-days/1", "other/2").getBytes(StandardCharsets.UTF_8), JSON))
                .isInstanceOf(WorkDayModel.Invalid.class).hasMessageContaining("schema");
        assertThatThrownBy(() -> WorkDayModel.read(good.replace("niveloft-task-history-v1", "jira").getBytes(StandardCharsets.UTF_8), JSON))
                .isInstanceOf(WorkDayModel.Invalid.class).hasMessageContaining("Niveloft task history");
        assertThatThrownBy(() -> WorkDayModel.read(good.replace("\"queue_days\"", "\"queue_hours\"").getBytes(StandardCharsets.UTF_8), JSON))
                .isInstanceOf(WorkDayModel.Invalid.class).hasMessageContaining("features");
        assertThatThrownBy(() -> WorkDayModel.read(good.replace("\"kind\":\"linear\"", "\"kind\":\"xgboost\"").getBytes(StandardCharsets.UTF_8), JSON))
                .isInstanceOf(WorkDayModel.Invalid.class).hasMessageContaining("can’t run");
        assertThatThrownBy(() -> WorkDayModel.read("not json".getBytes(StandardCharsets.UTF_8), JSON)).isInstanceOf(WorkDayModel.Invalid.class);
        WorkDayModel m = WorkDayModel.read(resource("model-forest.json"), JSON);
        assertThat(m.synthetic()).isTrue();
        assertThat(m.trainedThrough()).isBefore(Instant.parse("2026-01-01T00:00:00Z"));
        assertThat(m.id()).hasSize(16);
    }
}
