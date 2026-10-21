package dev.projectflow.live;

/**
 * In-process events published inside a transaction and pushed to browsers only after it commits.
 * They carry ids, never content: clients refetch through the normal, authorised endpoints.
 */
public final class LiveEvents {

    private LiveEvents() {}

    /**
     * Something in a project changed (the activity type names what). {@code alsoTo} lists users who
     * must hear about it even though they are no longer members (removed members, or everyone when
     * the project itself was deleted).
     */
    public record ProjectChanged(Long projectId, Long taskId, Long actorId, String kind, java.util.Set<Long> alsoTo) {
        public ProjectChanged(Long projectId, Long taskId, Long actorId, String kind) {
            this(projectId, taskId, actorId, kind, java.util.Set.of());
        }
    }

    /** A user has a new notification. */
    public record UserNotified(Long userId) {}
}
