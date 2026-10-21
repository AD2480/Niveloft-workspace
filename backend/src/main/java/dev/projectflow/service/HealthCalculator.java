package dev.projectflow.service;

import dev.projectflow.domain.ProjectStatus;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;

/**
 * Project health from stored records only (Java twin of {@code src/lib/health.ts}).
 * Rules are evaluated top to bottom; the first matching level wins.
 */
public final class HealthCalculator {

    public static final int AT_RISK_GAP = 10;
    public static final int OFF_TRACK_GAP = 25;
    public static final double OFF_TRACK_OVERDUE_SHARE = 0.25;
    public static final int DEADLINE_WINDOW_DAYS = 7;
    public static final int DEADLINE_WINDOW_PROGRESS = 80;

    private HealthCalculator() {}

    public record Result(String health, int progress, Integer expectedProgress, List<String> reasons) {}

    public static int progress(int done, int total) {
        return total == 0 ? 0 : (int) Math.round(done * 100.0 / total);
    }

    public static Integer expectedProgress(LocalDate start, LocalDate deadline, LocalDate today) {
        if (deadline == null) return null;
        long totalDays = ChronoUnit.DAYS.between(start, deadline);
        if (totalDays <= 0) return 100;
        long elapsed = ChronoUnit.DAYS.between(start, today);
        return (int) Math.max(0, Math.min(100, Math.round(elapsed * 100.0 / totalDays)));
    }

    private static String plural(long n, String one, String many) {
        return n == 1 ? one : many;
    }

    public static Result calculate(ProjectStatus status, LocalDate start, LocalDate deadline, int total, int done, int overdue, LocalDate today) {
        int open = total - done;
        int progress = progress(done, total);
        Integer expected = expectedProgress(start, deadline, today);

        if (status == ProjectStatus.COMPLETED || (total > 0 && open == 0)) {
            return new Result("COMPLETED", progress, expected, List.of("All work is complete."));
        }
        if (total == 0) {
            return new Result("NOT_STARTED", progress, expected, List.of("No tasks have been created yet."));
        }
        Long daysLeft = deadline == null ? null : ChronoUnit.DAYS.between(today, deadline);
        int gap = expected == null ? 0 : expected - progress;

        List<String> off = new ArrayList<>();
        if (daysLeft != null && daysLeft < 0) {
            off.add("The deadline passed " + (-daysLeft) + plural(-daysLeft, " day", " days") + " ago with " + open + plural(open, " open task.", " open tasks."));
        }
        if (open > 0 && (double) overdue / open >= OFF_TRACK_OVERDUE_SHARE) {
            off.add(overdue + " of " + open + " open tasks (" + Math.round(overdue * 100.0 / open) + "%) are overdue.");
        }
        if (gap > OFF_TRACK_GAP) {
            off.add("Progress is " + progress + "% but " + expected + "% was expected by today (" + gap + " points behind).");
        }
        if (!off.isEmpty()) return new Result("OFF_TRACK", progress, expected, off);

        List<String> risk = new ArrayList<>();
        if (overdue > 0) risk.add(overdue + (overdue == 1 ? " task is overdue." : " tasks are overdue."));
        if (gap > AT_RISK_GAP) {
            risk.add("Progress is " + progress + "% but " + expected + "% was expected by today (" + gap + " points behind).");
        }
        if (daysLeft != null && daysLeft <= DEADLINE_WINDOW_DAYS && progress < DEADLINE_WINDOW_PROGRESS) {
            risk.add("The deadline is in " + daysLeft + plural(daysLeft, " day", " days") + " and progress is " + progress + "%.");
        }
        if (!risk.isEmpty()) return new Result("AT_RISK", progress, expected, risk);

        List<String> ok = new ArrayList<>();
        ok.add("No overdue tasks.");
        if (expected != null) ok.add("Progress " + progress + "% vs " + expected + "% expected.");
        return new Result("ON_TRACK", progress, expected, ok);
    }
}
