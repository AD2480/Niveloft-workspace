package dev.projectflow.service;

import dev.projectflow.domain.Task;
import java.util.Comparator;
import java.util.List;
import java.util.Objects;

/**
 * Fractional ordering inside a board column (Java twin of {@code src/lib/ordering.ts}).
 * A move writes only the moved task's position — the midpoint of its new
 * neighbours — and the column is re-spaced only when neighbours get too close.
 */
public final class BoardOrdering {

    public static final double GAP = 1024;
    public static final double MIN_GAP = 1e-6;

    private BoardOrdering() {}

    /**
     * Place {@code task} directly between the given neighbours in {@code column}
     * (the destination column; it may or may not contain {@code task}).
     */
    public static void placeBetween(List<Task> column, Task task, Long previousId, Long nextId) {
        List<Task> others = column.stream()
                .filter(t -> !Objects.equals(t.getId(), task.getId()))
                .sorted(Comparator.comparingDouble(Task::getPosition).thenComparing(Task::getId, Comparator.nullsLast(Comparator.naturalOrder())))
                .toList();
        Task prev = others.stream().filter(t -> Objects.equals(t.getId(), previousId)).findFirst().orElse(null);
        Task next = others.stream().filter(t -> Objects.equals(t.getId(), nextId)).findFirst().orElse(null);
        if (prev == null && next == null && !others.isEmpty()) prev = others.get(others.size() - 1);
        if (prev != null && next == null) {
            int i = others.indexOf(prev);
            next = i + 1 < others.size() ? others.get(i + 1) : null;
        }
        if (next != null && prev == null) {
            int i = others.indexOf(next);
            prev = i > 0 ? others.get(i - 1) : null;
        }
        Double position = between(prev, next);
        if (position == null) {
            for (int i = 0; i < others.size(); i++) others.get(i).setPosition((i + 1) * GAP);
            position = between(prev, next);
        }
        task.setPosition(position);
    }

    private static Double between(Task prev, Task next) {
        if (prev == null && next == null) return GAP;
        if (prev == null) return next.getPosition() - GAP;
        if (next == null) return prev.getPosition() + GAP;
        if (next.getPosition() - prev.getPosition() < MIN_GAP) return null;
        return (prev.getPosition() + next.getPosition()) / 2;
    }
}
