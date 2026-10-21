package dev.projectflow.security;

import java.util.Locale;

/**
 * The counts behind rate limits: how often something happened for a key within a sliding window.
 * {@link MemoryRateCounts} keeps them in this server's memory, which is enough for one instance;
 * {@link DatabaseRateCounts} keeps them in the database, so every instance shares them
 * ({@code RATE_LIMIT_STORE}, see {@link RateCountsConfig}). A key is always used with the same
 * window length.
 */
public interface RateCounts {

    /**
     * Counts one hit, unless {@code limit} hits were already counted within the window: then nothing
     * is counted and the result is how long to wait, in milliseconds. 0 when the hit was counted.
     */
    long take(String key, int limit, long windowMs);

    /** How long to wait, in milliseconds, if {@code limit} hits are already counted within the window; 0 if not. Counts nothing. */
    long peek(String key, int limit, long windowMs);

    /** Counts one hit whatever the total (a failed password, say, checked later with {@link #peek}). */
    void add(String key, long windowMs);

    /** How many more hits fit right now (0 once the limit is reached). Counts nothing. */
    int remaining(String key, int limit, long windowMs);

    /**
     * Takes back one hit counted at {@code at} (epoch milliseconds, read just before the
     * {@link #take}) or later: for a request that failed before it cost anything.
     */
    void giveBack(String key, long at, long windowMs);

    /** Forgets every hit for a key (failed sign-ins, once the right password is given). */
    void clear(String key);

    /** Forgets windows nobody can count against any more (every few minutes). */
    void sweep();

    /** "memory" or "database". */
    String name();

    /**
     * What a {@code RATE_LIMIT_STORE} value means on this server: "database" (also db, shared) or
     * "memory" (also local); anything else, auto included, is the database in production and memory
     * elsewhere.
     */
    static String store(String setting, boolean production) {
        String s = setting == null ? "auto" : setting.trim().toLowerCase(Locale.ROOT);
        return switch (s) {
            case "database", "db", "shared" -> "database";
            case "memory", "local" -> "memory";
            default -> production ? "database" : "memory";
        };
    }
}
