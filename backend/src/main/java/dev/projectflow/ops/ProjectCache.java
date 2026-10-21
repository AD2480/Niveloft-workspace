package dev.projectflow.ops;

import dev.projectflow.live.LiveEvents;
import java.time.Clock;
import java.time.Duration;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.Supplier;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * A short-lived cache for results that are the same for every member of a project and costly to
 * compute (analytics, the status history). Any change to the project empties its entries as soon
 * as it commits, so nobody sees stale numbers after a change; otherwise entries last a minute.
 * Access is always checked before the cache is asked.
 */
@Component
public class ProjectCache {

    private static final Duration TTL = Duration.ofSeconds(60);

    private record Entry(Object value, long generation, long expiresAt) {}

    private final Map<String, Entry> entries = new ConcurrentHashMap<>();
    private final Map<Long, AtomicLong> generations = new ConcurrentHashMap<>();
    private final Clock clock;

    public ProjectCache(Clock clock) {
        this.clock = clock;
    }

    @SuppressWarnings("unchecked")
    public <T> T get(String name, Long projectId, Supplier<T> compute) {
        String key = name + ":" + projectId;
        long now = clock.millis();
        long gen = generation(projectId).get();
        Entry e = entries.get(key);
        if (e != null && e.generation() == gen && e.expiresAt() > now) return (T) e.value();
        T value = compute.get();
        // Only keep it if nothing changed while it was being computed.
        if (generation(projectId).get() == gen) entries.put(key, new Entry(value, gen, now + TTL.toMillis()));
        return value;
    }

    private AtomicLong generation(Long projectId) {
        return generations.computeIfAbsent(projectId, id -> new AtomicLong());
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT, fallbackExecution = true)
    public void onProjectChanged(LiveEvents.ProjectChanged event) {
        if (event.projectId() == null) return;
        generation(event.projectId()).incrementAndGet();
        entries.keySet().removeIf(k -> k.endsWith(":" + event.projectId()));
    }

    @Scheduled(fixedDelay = 5 * 60 * 1000)
    public void sweep() {
        long now = clock.millis();
        entries.values().removeIf(e -> e.expiresAt() <= now);
    }
}
