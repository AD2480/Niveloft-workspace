package dev.projectflow.security;

import java.time.Clock;
import java.time.Duration;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Iterator;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Rate-limit counts in this server's memory: an exact sliding window (the time of every hit, for the
 * longest window used, an hour). Enough for one API instance; reset by a restart. Each key is
 * changed atomically (ConcurrentHashMap.compute), so concurrent requests can't both take the last
 * place, and a sweep can't drop a hit being counted.
 */
public final class MemoryRateCounts implements RateCounts {

    /** Hits older than this are forgotten; no limit uses a longer window. */
    static final long KEEP_MS = Duration.ofHours(2).toMillis();

    private final Clock clock;
    private final Map<String, Deque<Long>> hits = new ConcurrentHashMap<>();

    public MemoryRateCounts(Clock clock) {
        this.clock = clock;
    }

    @Override
    public long take(String key, int limit, long windowMs) {
        long now = clock.millis();
        long[] wait = {0};
        hits.compute(key, (k, times) -> {
            Deque<Long> t = times == null ? new ArrayDeque<>() : times;
            drop(t, now - windowMs);
            if (t.size() >= limit) wait[0] = waitFor(t, limit, windowMs, now);
            else t.addLast(now);
            return t.isEmpty() ? null : t;
        });
        return wait[0];
    }

    @Override
    public long peek(String key, int limit, long windowMs) {
        long now = clock.millis();
        long[] wait = {0};
        hits.computeIfPresent(key, (k, t) -> {
            drop(t, now - windowMs);
            if (t.size() >= limit) wait[0] = waitFor(t, limit, windowMs, now);
            return t.isEmpty() ? null : t;
        });
        return wait[0];
    }

    @Override
    public void add(String key, long windowMs) {
        long now = clock.millis();
        hits.compute(key, (k, times) -> {
            Deque<Long> t = times == null ? new ArrayDeque<>() : times;
            drop(t, now - windowMs);
            t.addLast(now);
            return t;
        });
    }

    @Override
    public int remaining(String key, int limit, long windowMs) {
        return Math.max(0, limit - count(key, windowMs));
    }

    @Override
    public void giveBack(String key, long at, long windowMs) {
        hits.computeIfPresent(key, (k, t) -> {
            Iterator<Long> newest = t.descendingIterator();
            if (newest.hasNext() && newest.next() >= at) newest.remove();
            return t.isEmpty() ? null : t;
        });
    }

    @Override
    public void clear(String key) {
        hits.remove(key);
    }

    @Override
    public String name() {
        return "memory";
    }

    /** Forgets keys whose last hit is older than every window, so memory stays small. */
    @Override
    public void sweep() {
        long cutoff = clock.millis() - KEEP_MS;
        for (String key : hits.keySet()) {
            hits.computeIfPresent(key, (k, t) -> t.isEmpty() || t.peekLast() < cutoff ? null : t);
        }
    }

    /** Hits within the last window. */
    int count(String key, long windowMs) {
        long now = clock.millis();
        int[] n = {0};
        hits.computeIfPresent(key, (k, t) -> {
            drop(t, now - windowMs);
            n[0] = t.size();
            return t.isEmpty() ? null : t;
        });
        return n[0];
    }

    private static void drop(Deque<Long> times, long before) {
        while (!times.isEmpty() && times.peekFirst() <= before) times.pollFirst();
    }

    /** How long until enough hits have slid out for one more to fit. */
    private static long waitFor(Deque<Long> times, int limit, long windowMs, long now) {
        if (limit <= 0 || times.isEmpty()) return windowMs;
        Iterator<Long> it = times.iterator();
        long t = it.next();
        for (int i = 0; i < times.size() - limit; i++) t = it.next();
        return Math.max(1, t + windowMs - now);
    }
}
