package dev.projectflow.security;

import dev.projectflow.config.AppProperties;
import dev.projectflow.web.error.ApiException;
import dev.projectflow.web.error.ErrorCode;
import java.time.Clock;
import java.time.Duration;
import java.util.Locale;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Sliding-window limits on sign-up, sign-in, emailed links and a few other actions, per IP address
 * and per account, to slow down bots and password guessing. The counts are {@link RateCounts}: in
 * the database, shared by every API instance (the default in production), or in this server's
 * memory.
 */
@Component
public class RateLimiter {

    private final boolean enabled;
    private final RateCounts counts;

    @Autowired
    public RateLimiter(AppProperties props, RateCounts counts) {
        this.enabled = props.botProtection() == null || props.botProtection().limitsOn();
        this.counts = counts;
    }

    /** For tests and tools: limits counted in this server's memory. */
    public RateLimiter(AppProperties props, Clock clock) {
        this(props, new MemoryRateCounts(clock));
    }

    /** Records an attempt, or throws 429 if {@code limit} attempts were already made within {@code window}. */
    public void check(String action, String key, int limit, Duration window) {
        if (!enabled || key == null) return;
        long wait = counts.take(bucket(action, key), limit, window.toMillis());
        if (wait > 0) throw tooMany(wait);
    }

    /** Throws 429 if {@code limit} attempts were already recorded within {@code window}; records nothing. */
    public void ensureUnder(String action, String key, int limit, Duration window) {
        if (!enabled || key == null) return;
        long wait = counts.peek(bucket(action, key), limit, window.toMillis());
        if (wait > 0) throw tooMany(wait);
    }

    /** Counts one attempt (e.g. a failed password) towards {@link #ensureUnder}, within {@code window}. */
    public void record(String action, String key, Duration window) {
        if (!enabled || key == null) return;
        counts.add(bucket(action, key), window.toMillis());
    }

    /** Forgets the attempts for a key (e.g. failed sign-ins once the right password is given). */
    public void clear(String action, String key) {
        if (!enabled || key == null) return;
        counts.clear(bucket(action, key));
    }

    private static ApiException tooMany(long waitMs) {
        long minutes = Math.max(1, (waitMs + 59_999) / 60_000);
        return new ApiException(HttpStatus.TOO_MANY_REQUESTS, ErrorCode.RATE_LIMITED,
                "Too many attempts. Please wait " + minutes + (minutes == 1 ? " minute" : " minutes") + " and try again.", null);
    }

    private static String bucket(String action, String key) {
        return action + ":" + key.toLowerCase(Locale.ROOT);
    }

    /** Forgets windows that have fully passed, so memory and the table stay small. */
    @Scheduled(fixedDelay = 5 * 60 * 1000, initialDelay = 60 * 1000)
    public void sweep() {
        counts.sweep();
    }
}
