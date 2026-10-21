package dev.projectflow.forecast;

import com.fasterxml.jackson.databind.ObjectMapper;
import dev.projectflow.ops.OpsSwitches;
import dev.projectflow.security.ProjectAccess;
import dev.projectflow.service.TaskHistoryExport;
import dev.projectflow.web.dto.Dto;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.util.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The forecast model trial: a model the {@code ml/} kit trained on the team's history and
 * recommended, run beside Niveloft's own forecast so the team can see, on its own new work,
 * whether it keeps winning. It never replaces the forecast the app uses; switching is a person's
 * decision, after the trial.
 *
 * <p>How it works. The server reads the model from {@code FORECAST_MODEL_FILE} at start-up
 * ({@link WorkDayModel} refuses anything it can't run faithfully). For each task in progress that
 * can proceed, the first time anyone opens the trial, it makes both forecasts of the task's work
 * from what was known when the task could start ({@link WorkDayFeatures}, the kit's features) and
 * records them. Once the work is submitted, it records what it really took. Work that could only
 * start after the model was trained but finished before anyone looked is scored too, marked as
 * checked after the fact. Rows are per model (by the file's hash), so a new model starts afresh.
 *
 * <p>Rollback. Switching off "forecast-model" in Site health (or removing the setting) stops the
 * trial: nothing more is recorded or shown, and nothing else changes.
 */
@Service
public class ForecastTrialService {

    private static final Logger log = LoggerFactory.getLogger(ForecastTrialService.class);
    /** Below this many finished tasks forecast in advance, the comparison means little (the kit's own test needs 30). */
    static final int ENOUGH = 30;
    /** A model must remove at least this much of the forecast's typical miss to be called ahead (as in the kit). */
    static final double MARGIN = 0.05;
    static final String NONE = "No trained forecast model is set up on this server, so there’s nothing to compare. Niveloft’s forecast is used, as always.";
    static final String SWITCHED_OFF = "The forecast model trial is switched off on this server. Niveloft’s forecast is used, as always.";

    private final ProjectAccess access;
    private final TaskHistoryExport history;
    private final JdbcTemplate jdbc;
    private final OpsSwitches switches;
    private final Clock clock;
    private final WorkDayModel model;
    private final String unavailable;

    @org.springframework.beans.factory.annotation.Autowired
    public ForecastTrialService(ProjectAccess access, TaskHistoryExport history, JdbcTemplate jdbc, OpsSwitches switches, Clock clock, ObjectMapper json,
                                @Value("${FORECAST_MODEL_FILE:}") String file, @Value("${FORECAST_MODEL_ALLOW_SYNTHETIC:false}") boolean allowSynthetic) {
        this.access = access;
        this.history = history;
        this.jdbc = jdbc;
        this.switches = switches;
        this.clock = clock;
        WorkDayModel m = null;
        String why = NONE;
        if (file != null && !file.isBlank()) {
            try {
                m = WorkDayModel.read(Files.readAllBytes(Path.of(file.strip())), json);
                if (m.synthetic() && !allowSynthetic) {
                    why = "The forecast model on this server was trained on the kit’s made-up data, so it isn’t run (set FORECAST_MODEL_ALLOW_SYNTHETIC=true only to try the trial on a test server).";
                    log.warn("Forecast model trial: {} was trained on synthetic data; not run.", file);
                    m = null;
                } else {
                    log.info("Forecast model trial: {} ({}), trained on {} tasks through {}.", m.name(), m.id(), m.trainedTasks(), m.trainedThrough());
                }
            } catch (IOException e) {
                why = "The forecast model file couldn’t be read, so there’s no trial. Niveloft’s forecast is used, as always.";
                log.warn("Forecast model trial: couldn't read {}: {}", file, e.toString());
            } catch (WorkDayModel.Invalid e) {
                why = "The forecast model file was refused (" + e.getMessage() + "), so there’s no trial. Niveloft’s forecast is used, as always.";
                log.warn("Forecast model trial: refused {}: {}", file, e.getMessage());
            }
        }
        this.model = m;
        this.unavailable = m == null ? why : null;
    }

    /** For tests: a model in hand (or none, with the reason). */
    ForecastTrialService(ProjectAccess access, TaskHistoryExport history, JdbcTemplate jdbc, OpsSwitches switches, Clock clock, WorkDayModel model, String unavailable) {
        this.access = access;
        this.history = history;
        this.jdbc = jdbc;
        this.switches = switches;
        this.clock = clock;
        this.model = model;
        this.unavailable = model == null ? unavailable : null;
    }

    /** Whether a model is on trial at all (for status lines). */
    public boolean configured() {
        return model != null;
    }

    private Dto.ForecastTrial off(String reason, Instant now) {
        return new Dto.ForecastTrial(false, reason, null, List.of(), null, null, List.of(), null, now);
    }

    private record Recorded(Long taskId, Instant readyAt, double modelDays, double niveloftDays, boolean beforeFinish, Instant predictedAt, Double actualDays, Instant finishedAt) {}

    private Map<Long, Recorded> recorded(Long projectId) {
        Map<Long, Recorded> out = new LinkedHashMap<>();
        jdbc.query("SELECT task_id, ready_at, model_days, niveloft_days, before_finish, predicted_at, actual_days, finished_at FROM forecast_trial WHERE project_id = ? AND model_id = ? ORDER BY id",
                rs -> {
                    double actual = rs.getDouble(7);
                    Double a = rs.wasNull() ? null : actual;
                    Timestamp fin = rs.getTimestamp(8);
                    out.put(rs.getLong(1), new Recorded(rs.getLong(1), rs.getTimestamp(2).toInstant(), rs.getDouble(3), rs.getDouble(4), rs.getBoolean(5),
                            rs.getTimestamp(6).toInstant(), a, fin == null ? null : fin.toInstant()));
                }, projectId, model.id());
        return out;
    }

    private boolean record(Long projectId, Long taskId, Instant ready, double modelDays, double niveloftDays, boolean beforeFinish, Instant now, Double actual, Instant finished) {
        try {
            jdbc.update("INSERT INTO forecast_trial (project_id, task_id, model_id, ready_at, model_days, niveloft_days, before_finish, predicted_at, actual_days, finished_at) "
                            + "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    projectId, taskId, model.id(), Timestamp.from(ready), modelDays, niveloftDays, beforeFinish, Timestamp.from(now), actual,
                    finished == null ? null : Timestamp.from(finished));
            return true;
        } catch (DuplicateKeyException alreadyThere) {
            return false; // someone else opened the trial at the same moment: theirs stands
        }
    }

    /**
     * The trial for one project, for any member. Records the forecasts not made yet, and what
     * finished work really took, then reports.
     */
    @Transactional
    public Dto.ForecastTrial trial(Long projectId) {
        ProjectAccess.Access a = access.require(projectId);
        Instant now = Instant.now(clock);
        if (model == null) return off(unavailable, now);
        if (!switches.on("forecast-model")) return off(SWITCHED_OFF, now);

        TaskHistoryExport.Snapshot snap = history.snapshot(projectId, a.project().getKey());
        List<HistoryRow> rows = HistoryRow.parse(snap.csv());
        List<WorkDayFeatures.Finished> finished = WorkDayFeatures.finished(rows);
        List<WorkDayFeatures.InProgress> work = WorkDayFeatures.inProgress(rows);
        Instant through = model.trainedThrough();
        List<WorkDayFeatures.Finished> newToModel = finished.stream().filter(f -> through != null && f.readyAt().isAfter(through)).toList();
        Map<WorkDayFeatures.InProgress, WorkDayFeatures.Known> knownWork = WorkDayFeatures.knownAtStart(rows, finished, work);
        Map<WorkDayFeatures.Finished, WorkDayFeatures.Known> knownDone = WorkDayFeatures.knownAtStart(rows, finished, newToModel);
        Map<Long, Recorded> seen = recorded(projectId);

        for (WorkDayFeatures.InProgress w : work) {
            Long taskId = snap.taskIds().get(w.row().task());
            if (taskId == null || seen.containsKey(taskId)) continue;
            double[] x = WorkDayFeatures.build(w.row(), w.readyAt(), knownWork.get(w));
            record(projectId, taskId, w.readyAt(), model.predictDays(x), Math.exp(x[WorkDayFeatures.LOG_PACE_FORECAST]), true, now, null, null);
        }
        Set<WorkDayFeatures.Finished> isNew = Collections.newSetFromMap(new IdentityHashMap<>());
        isNew.addAll(newToModel);
        for (WorkDayFeatures.Finished f : finished) {
            Long taskId = snap.taskIds().get(f.row().task());
            if (taskId == null) continue;
            Recorded r = seen.get(taskId);
            if (r != null) {
                if (r.actualDays() == null) {
                    jdbc.update("UPDATE forecast_trial SET actual_days = ?, finished_at = ? WHERE task_id = ? AND model_id = ? AND actual_days IS NULL",
                            f.workDays(), Timestamp.from(f.row().approvedAt()), taskId, model.id());
                }
            } else if (isNew.contains(f)) {
                double[] x = WorkDayFeatures.build(f.row(), f.readyAt(), knownDone.get(f));
                record(projectId, taskId, f.readyAt(), model.predictDays(x), Math.exp(x[WorkDayFeatures.LOG_PACE_FORECAST]), false, now, f.workDays(), f.row().approvedAt());
            }
        }

        Map<Long, Recorded> all = recorded(projectId);
        Map<Long, String> keyOf = new HashMap<>();
        snap.taskIds().forEach((k, id) -> keyOf.put(id, k));
        Set<Long> inProgress = new HashSet<>();
        for (WorkDayFeatures.InProgress w : work) {
            Long id = snap.taskIds().get(w.row().task());
            if (id != null) inProgress.add(id);
        }
        List<Dto.ForecastTrialOpen> open = all.values().stream()
                .filter(r -> r.actualDays() == null && inProgress.contains(r.taskId()))
                .sorted(Comparator.comparing(Recorded::readyAt))
                .map(r -> new Dto.ForecastTrialOpen(r.taskId(), keyOf.get(r.taskId()), r.readyAt(), WorkDayFeatures.days(r.readyAt(), now) * WorkDayFeatures.WORKING,
                        r.modelDays(), r.niveloftDays(), r.predictedAt()))
                .toList();
        List<Recorded> done = all.values().stream().filter(r -> r.actualDays() != null).toList();
        Dto.ForecastTrialScore before = score(done.stream().filter(Recorded::beforeFinish).toList());
        Dto.ForecastTrialScore after = score(done.stream().filter(r -> !r.beforeFinish()).toList());
        List<Dto.ForecastTrialResult> recent = done.stream()
                .sorted(Comparator.comparing(Recorded::finishedAt, Comparator.nullsLast(Comparator.reverseOrder())))
                .limit(12)
                .map(r -> new Dto.ForecastTrialResult(r.taskId(), keyOf.get(r.taskId()), r.modelDays(), r.niveloftDays(), r.actualDays(), r.beforeFinish(), r.finishedAt()))
                .toList();
        Dto.ForecastModelInfo info = new Dto.ForecastModelInfo(model.id(), model.name(), model.description(), model.kind(), model.trainedThrough(), model.trainedTasks(),
                model.trainedProjects(), model.synthetic());
        return new Dto.ForecastTrial(true, null, info, open, before, after, recent, verdict(before, after), now);
    }

    /** How each forecast did: the typical miss as a factor, and how often each was the closer one. */
    static Dto.ForecastTrialScore score(List<Recorded> rows) {
        if (rows.isEmpty()) return new Dto.ForecastTrialScore(0, null, null, 0, 0);
        double m = 0;
        double n = 0;
        int modelCloser = 0;
        int niveloftCloser = 0;
        for (Recorded r : rows) {
            double em = Math.abs(Math.log(r.modelDays() / r.actualDays()));
            double en = Math.abs(Math.log(r.niveloftDays() / r.actualDays()));
            m += em;
            n += en;
            if (em < en) modelCloser++;
            else if (en < em) niveloftCloser++;
        }
        return new Dto.ForecastTrialScore(rows.size(), Math.exp(m / rows.size()), Math.exp(n / rows.size()), modelCloser, niveloftCloser);
    }

    private static String miss(double factor) {
        return String.format(Locale.ROOT, "×%.2f", factor);
    }

    /** What the numbers say so far, without overselling them; switching is never automatic. */
    static String verdict(Dto.ForecastTrialScore before, Dto.ForecastTrialScore after) {
        if (before.tasks() == 0 && after.tasks() == 0) {
            return "No work forecast in this trial has been submitted yet, so there’s nothing to compare.";
        }
        if (before.tasks() < ENOUGH) {
            String so = before.tasks() == 0 ? "" : " So far, on " + before.tasks() + (before.tasks() == 1 ? " task" : " tasks") + " forecast in advance, the model missed by "
                    + miss(before.modelMiss()) + " on a typical task and Niveloft’s forecast by " + miss(before.niveloftMiss()) + ".";
            return "Too early to tell: the comparison means little before about " + ENOUGH + " tasks forecast in advance have been submitted." + so;
        }
        double modelErr = Math.log(before.modelMiss());
        double niveloftErr = Math.log(before.niveloftMiss());
        double gain = niveloftErr > 0 ? 1 - modelErr / niveloftErr : modelErr > 0 ? -1 : 0;
        String numbers = " The model missed by " + miss(before.modelMiss()) + " on a typical task and Niveloft’s forecast by " + miss(before.niveloftMiss())
                + ", over " + before.tasks() + " tasks forecast before they were submitted.";
        if (gain >= MARGIN) return "So far the model is ahead." + numbers + " Niveloft’s forecast is still the one the app uses; switching is your decision.";
        if (gain <= -MARGIN) return "So far Niveloft’s forecast is ahead." + numbers + " Keep Niveloft’s forecast.";
        return "So far they’re about even." + numbers + " That isn’t a reason to switch.";
    }

}
