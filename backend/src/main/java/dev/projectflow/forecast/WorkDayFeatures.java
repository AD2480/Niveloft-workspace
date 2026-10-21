package dev.projectflow.forecast;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * What a forecast model may know about a task when it could start, built exactly as the
 * {@code ml/} kit builds it ({@code niveloft_ml/history.py} and {@code features.py}): from the task
 * itself, and from work approved before it could start. A test checks this against the kit's own
 * numbers on the same file, feature by feature.
 *
 * <p>The target is the same as Niveloft's forecast's: working days from when a task could proceed
 * (started, and everything it waited on approved) to its final submission for review.
 */
public final class WorkDayFeatures {

    private WorkDayFeatures() {}

    /** The model's inputs, in order (features.FEATURES). */
    public static final List<String> FEATURES = List.of(
            "estimate_days", "has_estimate", "log_base", "priority_rank", "waits_on", "holds_up", "criteria", "checklist",
            "log_description", "queue_days", "due_slack_days", "has_due", "start_weekday", "person_n", "person_pace",
            "log_person_median_work", "project_n", "project_pace", "log_pace_forecast");

    static final double SHRINK = 2.0;
    static final double RATIO_LO = 0.2;
    static final double RATIO_HI = 5.0;
    static final double DEFAULT_TYPICAL = 2.0;
    static final double DEFAULT_SIGMA = 0.35;
    static final double MIN_SIGMA = 0.2;
    /** Calendar days → working days, as the forecast counts them. */
    static final double WORKING = 5.0 / 7.0;
    static final double MIN_WORK_DAYS = 0.25;
    static final int LOG_PACE_FORECAST = FEATURES.indexOf("log_pace_forecast");

    /** A task, and when it could proceed. */
    public interface Starting {
        HistoryRow row();

        Instant readyAt();
    }

    /** An approved task with a start: what it took (the target). */
    public record Finished(HistoryRow row, Instant readyAt, double workDays) implements Starting {}

    /** Work in progress that can proceed (started; waiting on nothing, or only on approved work). */
    public record InProgress(HistoryRow row, Instant readyAt) implements Starting {}

    /** What the records showed when a task could start. */
    public record Known(int personN, double personPace, double paceSigma, double personMedianWork, int projectN, double projectPace, double typicalEstimate) {}

    static double days(Instant from, Instant to) {
        return Duration.between(from, to).toNanos() / 1e9 / 86400.0;
    }

    /** When the work could proceed: its start, or the approval of what it waited on if that came later. */
    static Instant readyAt(HistoryRow r) {
        Instant ready = r.startedAt();
        if (r.blockersApprovedAt() != null && ready != null && r.blockersApprovedAt().isAfter(ready)) ready = r.blockersApprovedAt();
        return ready;
    }

    /** Working days from ready to the final submission for review (or to approval when it never went to review). */
    static double workDays(HistoryRow r, Instant ready) {
        boolean reviewCounts = r.lastReviewAt() != null && !r.lastReviewAt().isBefore(ready) && !r.lastReviewAt().isAfter(r.approvedAt());
        Instant end = reviewCounts ? r.lastReviewAt() : r.approvedAt();
        return Math.max(MIN_WORK_DAYS, days(ready, end) * WORKING);
    }

    /** Approved tasks with a start, oldest approval first (then by key), with their targets. */
    public static List<Finished> finished(List<HistoryRow> rows) {
        List<Finished> out = new ArrayList<>();
        for (HistoryRow r : rows) {
            if (!"DONE".equals(r.status()) || r.startedAt() == null || r.approvedAt() == null) continue;
            Instant ready = readyAt(r);
            double w = workDays(r, ready);
            if (Double.isFinite(w)) out.add(new Finished(r, ready, w));
        }
        out.sort(Comparator.comparing((Finished f) -> f.row().approvedAt()).thenComparing(f -> f.row().task(), Comparator.nullsLast(Comparator.naturalOrder())));
        return out;
    }

    /** Work in progress that can proceed, with when it could. */
    public static List<InProgress> inProgress(List<HistoryRow> rows) {
        List<InProgress> out = new ArrayList<>();
        for (HistoryRow r : rows) {
            if (!"IN_PROGRESS".equals(r.status()) || r.startedAt() == null) continue;
            if (r.waitsOn() != 0 && r.blockersApprovedAt() == null) continue; // still waiting on unapproved work
            out.add(new InProgress(r, readyAt(r)));
        }
        return out;
    }

    private static final class Running {
        int n;
        double sum;
        double squares;

        void add(double v) {
            n++;
            sum += v;
            squares += v * v;
        }
    }

    private static double median(List<Double> sorted) {
        int n = sorted.size();
        if (n == 0) return Double.NaN;
        return n % 2 == 1 ? sorted.get(n / 2) : (sorted.get(n / 2 - 1) + sorted.get(n / 2)) / 2.0;
    }

    private static void insort(List<Double> sorted, double v) {
        int i = java.util.Collections.binarySearch(sorted, v);
        sorted.add(i < 0 ? -i - 1 : i + 1, v);
    }

    /**
     * For each of {@code rows}, what the records showed when it could start: each person's and the
     * project's pace from the work approved before then (the person's pulled towards the project's
     * until they have a few finished tasks, as the app does), and the project's typical estimate
     * from the tasks created before then.
     */
    public static <T extends Starting> Map<T, Known> knownAtStart(List<HistoryRow> all, List<Finished> finished, List<T> rows) {
        List<Finished> approvals = new ArrayList<>(finished);
        approvals.sort(Comparator.comparing(f -> f.row().approvedAt())); // stable: keeps the key order
        List<HistoryRow> created = new ArrayList<>(all.stream().filter(r -> r.createdAt() != null).toList());
        created.sort(Comparator.comparing(HistoryRow::createdAt));
        List<T> order = new ArrayList<>(rows);
        order.sort(Comparator.comparing(Starting::readyAt));

        Map<String, Running> perPerson = new HashMap<>();
        Map<String, List<Double>> personWork = new HashMap<>();
        Map<String, Running> perProject = new HashMap<>();
        Map<String, List<Double>> projectEstimates = new HashMap<>();
        int a = 0;
        int c = 0;
        Map<T, Known> out = new java.util.IdentityHashMap<>();
        for (T row : order) {
            Instant t = row.readyAt();
            while (a < approvals.size() && approvals.get(a).row().approvedAt().isBefore(t)) {
                Finished f = approvals.get(a++);
                String person = f.row().person();
                if (person != null) insort(personWork.computeIfAbsent(person, k -> new ArrayList<>()), f.workDays());
                Double est = f.row().estimateDays();
                if (est != null && est > 0) {
                    double lr = Math.log(Math.min(RATIO_HI, Math.max(RATIO_LO, f.workDays() / est)));
                    perProject.computeIfAbsent(f.row().project(), k -> new Running()).add(lr);
                    if (person != null) perPerson.computeIfAbsent(person, k -> new Running()).add(lr);
                }
            }
            while (c < created.size() && created.get(c).createdAt().isBefore(t)) {
                HistoryRow r = created.get(c++);
                if (r.estimateDays() != null && r.estimateDays() > 0) insort(projectEstimates.computeIfAbsent(r.project(), k -> new ArrayList<>()), r.estimateDays());
            }
            Running p = perProject.getOrDefault(row.row().project(), new Running());
            double projectPace = p.n > 0 ? p.sum / p.n : 0.0;
            double projectVar = p.n > 1 ? (p.squares - p.n * projectPace * projectPace) / (p.n - 1) : DEFAULT_SIGMA * DEFAULT_SIGMA;
            String person = row.row().person();
            Running me = person == null ? new Running() : perPerson.getOrDefault(person, new Running());
            List<Double> work = person == null ? List.of() : personWork.getOrDefault(person, List.of());
            List<Double> estimates = projectEstimates.getOrDefault(row.row().project(), List.of());
            double mu;
            double spread;
            if (person != null && me.n > 0) {
                mu = (me.sum + SHRINK * projectPace) / (me.n + SHRINK);
                spread = Math.sqrt(Math.max(0.0, (me.squares - 2 * mu * me.sum + me.n * mu * mu) + SHRINK * projectVar) / (me.n + SHRINK));
            } else {
                mu = projectPace;
                spread = Math.sqrt(Math.max(projectVar, 0.0));
            }
            out.put(row, new Known(me.n, mu, Math.max(MIN_SIGMA, spread), median(work), p.n, projectPace, estimates.isEmpty() ? DEFAULT_TYPICAL : median(estimates)));
        }
        return out;
    }

    private static final Map<String, Integer> PRIORITY = Map.of("LOW", 1, "MEDIUM", 2, "HIGH", 3, "URGENT", 4);

    /** The features of one task that could start at {@code readyAt}, given what was known then. NaN is missing. */
    public static double[] build(HistoryRow r, Instant readyAt, Known k) {
        double[] f = new double[FEATURES.size()];
        Arrays.fill(f, Double.NaN);
        double est = r.estimateDays() != null && r.estimateDays() > 0 ? r.estimateDays() : Double.NaN;
        f[0] = est;
        f[1] = Double.isNaN(est) ? 0 : 1;
        double base = Double.isNaN(est) ? k.typicalEstimate() : est;
        f[2] = Math.log(base);
        f[3] = PRIORITY.getOrDefault(Objects.requireNonNullElse(r.priority(), ""), 2);
        f[4] = r.waitsOn();
        f[5] = r.holdsUp();
        f[6] = r.criteria();
        f[7] = r.checklist();
        f[8] = Math.log1p(r.descriptionChars());
        f[9] = r.createdAt() == null ? Double.NaN : Math.max(0.0, days(r.createdAt(), readyAt));
        LocalDate readyDay = LocalDate.ofInstant(readyAt, ZoneOffset.UTC);
        f[10] = r.dueDate() == null ? Double.NaN : ChronoUnit.DAYS.between(readyDay, r.dueDate());
        f[11] = r.dueDate() == null ? 0 : 1;
        f[12] = readyDay.getDayOfWeek().getValue() - 1; // Monday is 0
        f[13] = k.personN();
        f[14] = k.personPace();
        f[15] = Math.log(k.personMedianWork()); // NaN without history
        f[16] = k.projectN();
        f[17] = k.projectPace();
        f[18] = f[2] + f[14];
        return f;
    }
}
