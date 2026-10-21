package dev.projectflow.security;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Clock;
import java.time.Duration;
import java.util.HexFormat;
import java.util.Locale;
import javax.sql.DataSource;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Rate-limit counts in the database ({@code rate_limit_windows}), shared by every API instance, so
 * limits hold however many servers run. Each key has a counter per fixed window; a limit is checked
 * against the current window plus the previous one, weighted by how much of it still overlaps the
 * sliding window (the usual "sliding window counter"). No fixed window ever holds more than the
 * limit, so the long-run rate is the same as an exact count, and a burst at a window's edge can't
 * double the limit at once, as it could with plain fixed windows. Like every such counter it's an
 * estimate within one sliding window: when the previous window's hits came at its very end, up to
 * twice the limit can fall within one window's length (the memory store is exact).
 *
 * <p>Counting is atomic: a conditional UPDATE ({@code hits + 1 <= room}), so concurrent requests on
 * any instance can't both take the last place. Only the current window's row ever changes. It runs
 * on its own small connection pool, outside the caller's transaction: a counted attempt stays
 * counted when the request fails (a wrong password rolls its transaction back), and a burst of
 * sign-ins can't hold every connection of the main pool while waiting for one of its own. Keys are
 * stored as a hash, so the table holds no email or IP addresses. If the database can't be reached,
 * the counts fall back to this server's memory for the moment (limits per instance) rather than
 * refusing everyone or letting everything through.
 */
public final class DatabaseRateCounts implements RateCounts {

    private static final Logger log = LoggerFactory.getLogger(DatabaseRateCounts.class);

    /** Windows older than this are deleted; the longest limit uses one hour. */
    static final long KEEP_MS = Duration.ofHours(3).toMillis();

    private final DataSource dataSource;
    private final Clock clock;
    private final MemoryRateCounts fallback;
    private volatile long lastWarning;

    public DatabaseRateCounts(DataSource dataSource, Clock clock) {
        this.dataSource = dataSource;
        this.clock = clock;
        this.fallback = new MemoryRateCounts(clock);
    }

    /** The counts for a key's current and previous window. */
    record Windows(long start, int current, int previous) {}

    @Override
    public long take(String key, int limit, long windowMs) {
        long now = clock.millis();
        String k = hash(key);
        long start = windowStart(now, windowMs);
        try (Connection c = dataSource.getConnection()) {
            c.setAutoCommit(true);
            for (int attempt = 0; attempt < 4; attempt++) {
                Windows w = read(c, k, start, windowMs);
                int room = room(limit, w.previous(), now, start, windowMs);
                if (w.current() >= room) return waitMs(limit, w, now, windowMs);
                boolean counted = w.current() == 0
                        ? insert(c, k, start)
                        : update(c, "UPDATE rate_limit_windows SET hits = hits + 1 WHERE bucket_key = ? AND window_start = ? AND hits + 1 <= ?", k, start, room) == 1;
                if (counted) return 0;
                // Another request created the row or took the last place since the read: read again.
            }
            return 1_000; // still contended after several tries: ask for a moment's wait
        } catch (SQLException | RuntimeException e) {
            warn(e);
            return fallback.take(key, limit, windowMs);
        }
    }

    @Override
    public long peek(String key, int limit, long windowMs) {
        long now = clock.millis();
        long start = windowStart(now, windowMs);
        try (Connection c = dataSource.getConnection()) {
            c.setAutoCommit(true);
            Windows w = read(c, hash(key), start, windowMs);
            return w.current() >= room(limit, w.previous(), now, start, windowMs) ? waitMs(limit, w, now, windowMs) : 0;
        } catch (SQLException | RuntimeException e) {
            warn(e);
            return fallback.peek(key, limit, windowMs);
        }
    }

    @Override
    public void add(String key, long windowMs) {
        String k = hash(key);
        long start = windowStart(clock.millis(), windowMs);
        try (Connection c = dataSource.getConnection()) {
            c.setAutoCommit(true);
            for (int attempt = 0; attempt < 3; attempt++) {
                if (update(c, "UPDATE rate_limit_windows SET hits = hits + 1 WHERE bucket_key = ? AND window_start = ?", k, start, null) == 1) return;
                if (insert(c, k, start)) return;
            }
        } catch (SQLException | RuntimeException e) {
            warn(e);
            fallback.add(key, windowMs);
        }
    }

    @Override
    public int remaining(String key, int limit, long windowMs) {
        long now = clock.millis();
        long start = windowStart(now, windowMs);
        try (Connection c = dataSource.getConnection()) {
            c.setAutoCommit(true);
            Windows w = read(c, hash(key), start, windowMs);
            return Math.max(0, room(limit, w.previous(), now, start, windowMs) - w.current());
        } catch (SQLException | RuntimeException e) {
            warn(e);
            return fallback.remaining(key, limit, windowMs);
        }
    }

    @Override
    public void giveBack(String key, long at, long windowMs) {
        try (Connection c = dataSource.getConnection();
             PreparedStatement st = c.prepareStatement("UPDATE rate_limit_windows SET hits = hits - 1 WHERE bucket_key = ? AND window_start = ? AND hits > 0")) {
            c.setAutoCommit(true);
            st.setString(1, hash(key));
            st.setLong(2, windowStart(at, windowMs));
            st.executeUpdate();
        } catch (SQLException | RuntimeException e) {
            warn(e);
            fallback.giveBack(key, at, windowMs);
        }
    }

    @Override
    public void clear(String key) {
        fallback.clear(key);
        try (Connection c = dataSource.getConnection(); PreparedStatement st = c.prepareStatement("DELETE FROM rate_limit_windows WHERE bucket_key = ?")) {
            c.setAutoCommit(true);
            st.setString(1, hash(key));
            st.executeUpdate();
        } catch (SQLException | RuntimeException e) {
            warn(e);
        }
    }

    @Override
    public String name() {
        return "database";
    }

    /** Deletes windows nobody can count against any more. */
    @Override
    public void sweep() {
        fallback.sweep();
        try (Connection c = dataSource.getConnection(); PreparedStatement st = c.prepareStatement("DELETE FROM rate_limit_windows WHERE window_start < ?")) {
            c.setAutoCommit(true);
            st.setLong(1, clock.millis() - KEEP_MS);
            st.executeUpdate();
        } catch (SQLException | RuntimeException e) {
            warn(e);
        }
    }

    /** Closes the counters' own connection pool when the server stops. */
    public void close() throws Exception {
        if (dataSource instanceof AutoCloseable closeable) closeable.close();
    }

    // ------------------------------------------------------------------ the arithmetic

    static long windowStart(long now, long windowMs) {
        return now - Math.floorMod(now, windowMs);
    }

    /**
     * How many hits the current window may hold right now: the limit, less the previous window's
     * hits still inside the sliding window (by the share of it that still overlaps).
     */
    static int room(int limit, int previous, long now, long start, long windowMs) {
        double overlap = 1 - (now - start) / (double) windowMs;
        return (int) Math.floor(limit - previous * overlap + 1e-9);
    }

    /** How long until one more hit fits: when enough of the previous window has slid out, or the next window starts. */
    static long waitMs(int limit, Windows w, long now, long windowMs) {
        long end = w.start() + windowMs;
        double wait;
        if (w.current() + 1 > limit) {
            // The current window alone is full: wait for the next one, and then for enough of this one to slide out.
            double share = w.current() == 0 ? 0 : Math.max(0, 1 - (limit - 1) / (double) w.current());
            wait = (end - now) + share * windowMs;
        } else {
            // There's room in this window once enough of the previous one has slid out.
            double share = w.previous() == 0 ? 0 : Math.max(0, 1 - (limit - 1 - w.current()) / (double) w.previous());
            wait = w.start() + share * windowMs - now;
        }
        return Math.max(1, (long) Math.ceil(wait));
    }

    /** A short, fixed-length key: the table never holds an email or IP address. */
    static String hash(String key) {
        try {
            byte[] d = MessageDigest.getInstance("SHA-256").digest(key.toLowerCase(Locale.ROOT).getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(d, 0, 20);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    // ------------------------------------------------------------------ SQL

    private static Windows read(Connection c, String key, long start, long windowMs) throws SQLException {
        int current = 0;
        int previous = 0;
        try (PreparedStatement st = c.prepareStatement("SELECT window_start, hits FROM rate_limit_windows WHERE bucket_key = ? AND window_start IN (?, ?)")) {
            st.setString(1, key);
            st.setLong(2, start);
            st.setLong(3, start - windowMs);
            try (ResultSet rs = st.executeQuery()) {
                while (rs.next()) {
                    if (rs.getLong(1) == start) current = rs.getInt(2);
                    else previous = rs.getInt(2);
                }
            }
        }
        return new Windows(start, current, previous);
    }

    private static int update(Connection c, String sql, String key, long start, Integer cap) throws SQLException {
        try (PreparedStatement st = c.prepareStatement(sql)) {
            st.setString(1, key);
            st.setLong(2, start);
            if (cap != null) st.setInt(3, cap);
            return st.executeUpdate();
        }
    }

    /** Creates the window with one hit; false when another request created it first. */
    private static boolean insert(Connection c, String key, long start) throws SQLException {
        try (PreparedStatement st = c.prepareStatement("INSERT INTO rate_limit_windows (bucket_key, window_start, hits) VALUES (?, ?, 1)")) {
            st.setString(1, key);
            st.setLong(2, start);
            return st.executeUpdate() == 1;
        } catch (SQLException e) {
            if (e.getSQLState() != null && e.getSQLState().startsWith("23")) return false; // duplicate key: it exists now
            throw e;
        }
    }

    private void warn(Exception e) {
        long now = clock.millis();
        if (now - lastWarning < 60_000) return;
        lastWarning = now;
        log.warn("Rate limits couldn't use the database, so this server counts in its own memory for now: {}", e.getMessage());
    }
}
