// Ported from the plain-Java checks that ran in the sandbox for this release (the same assertions,
// now run by ./mvnw verify).
package dev.projectflow.security;

import static org.assertj.core.api.Assertions.assertThat;

import dev.projectflow.config.AppProperties;
import dev.projectflow.web.error.ApiException;
import java.io.PrintWriter;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.SQLFeatureNotSupportedException;
import java.sql.Statement;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.List;
import java.util.Random;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.logging.Logger;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import javax.sql.DataSource;
import org.h2.jdbcx.JdbcConnectionPool;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.Resource;
import org.springframework.core.io.support.PathMatchingResourcePatternResolver;

/**
 * Rate limits shared by every API instance: the migrations on H2 in MySQL mode (the database the
 * other tests use), then DatabaseRateCounts with two "instances" on one database: the limit, the
 * sliding weighting, waits, concurrency, hashing, the sweep, and falling back to memory.
 */
class SharedRateLimitsTest {

    static final long W = 60_000;

    /** A clock the test moves by hand. */
    static final class Hand extends Clock {
        volatile long millis;

        Hand(long millis) {
            this.millis = millis;
        }

        @Override public ZoneId getZone() { return ZoneOffset.UTC; }
        @Override public Clock withZone(ZoneId zone) { return this; }
        @Override public Instant instant() { return Instant.ofEpochMilli(millis); }
        @Override public long millis() { return millis; }
    }

    /** A database that's down. */
    static final class Down implements DataSource {
        @Override public Connection getConnection() throws SQLException { throw new SQLException("Connection refused", "08001"); }
        @Override public Connection getConnection(String u, String p) throws SQLException { return getConnection(); }
        @Override public PrintWriter getLogWriter() { return null; }
        @Override public void setLogWriter(PrintWriter out) {}
        @Override public void setLoginTimeout(int seconds) {}
        @Override public int getLoginTimeout() { return 0; }
        @Override public Logger getParentLogger() throws SQLFeatureNotSupportedException { throw new SQLFeatureNotSupportedException(); }
        @Override public <T> T unwrap(Class<T> iface) throws SQLException { throw new SQLException("no"); }
        @Override public boolean isWrapperFor(Class<?> iface) { return false; }
    }

    private JdbcConnectionPool pool;
    private final long t0 = 1_790_000_040_000L - Math.floorMod(1_790_000_040_000L, W) + 1_000; // a second into a window
    private final Hand clock = new Hand(t0);

    /** Flyway-style: statements end with ; at the end of a line; -- comment lines dropped. */
    static List<String> statements(String sql) {
        List<String> out = new ArrayList<>();
        StringBuilder cur = new StringBuilder();
        for (String line : sql.split("\n")) {
            String t = line.strip();
            if (t.startsWith("--") || t.isEmpty()) continue;
            cur.append(line).append('\n');
            if (t.endsWith(";")) {
                String s = cur.toString().strip();
                out.add(s.substring(0, s.length() - 1));
                cur.setLength(0);
            }
        }
        if (!cur.toString().isBlank()) out.add(cur.toString());
        return out;
    }

    static int version(Resource r) {
        Matcher m = Pattern.compile("^V(\\d+)__").matcher(String.valueOf(r.getFilename()));
        return m.find() ? Integer.parseInt(m.group(1)) : Integer.MAX_VALUE;
    }

    @BeforeEach
    void database() throws Exception {
        pool = JdbcConnectionPool.create("jdbc:h2:mem:shared-limits-" + System.nanoTime()
                + ";MODE=MySQL;DATABASE_TO_LOWER=TRUE;DEFAULT_NULL_ORDERING=HIGH;DB_CLOSE_DELAY=-1", "sa", "");
        pool.setMaxConnections(12);
        Resource[] scripts = new PathMatchingResourcePatternResolver().getResources("classpath:db/migration/V*.sql");
        Arrays.sort(scripts, Comparator.comparingInt(SharedRateLimitsTest::version));
        try (Connection c = pool.getConnection(); Statement st = c.createStatement()) {
            for (Resource r : scripts) {
                for (String sql : statements(r.getContentAsString(StandardCharsets.UTF_8))) st.execute(sql);
            }
        }
        assertThat(version(scripts[scripts.length - 1])).isGreaterThanOrEqualTo(9);
    }

    @AfterEach
    void close() throws SQLException {
        try (Connection c = pool.getConnection(); Statement st = c.createStatement()) {
            st.execute("SHUTDOWN");
        }
        pool.dispose();
    }

    int hits(String key, long windowMs) throws SQLException {
        try (Connection c = pool.getConnection(); PreparedStatement st = c.prepareStatement("SELECT hits FROM rate_limit_windows WHERE bucket_key = ? AND window_start = ?")) {
            st.setString(1, DatabaseRateCounts.hash(key));
            st.setLong(2, DatabaseRateCounts.windowStart(clock.millis, windowMs));
            try (ResultSet rs = st.executeQuery()) {
                return rs.next() ? rs.getInt(1) : 0;
            }
        }
    }

    int rows() throws SQLException {
        try (Connection c = pool.getConnection(); Statement st = c.createStatement(); ResultSet rs = st.executeQuery("SELECT COUNT(*) FROM rate_limit_windows")) {
            rs.next();
            return rs.getInt(1);
        }
    }

    @Test
    void theArithmetic() {
        assertThat(DatabaseRateCounts.windowStart(125_000, W)).isEqualTo(120_000);
        assertThat(DatabaseRateCounts.room(10, 0, 120_000, 120_000, W)).isEqualTo(10);
        assertThat(DatabaseRateCounts.room(10, 10, 150_000, 120_000, W)).as("half the previous window still counts halfway through").isEqualTo(5);
        assertThat(DatabaseRateCounts.room(10, 10, 179_999, 120_000, W)).isEqualTo(9);
        String h = DatabaseRateCounts.hash("login-fail:Asha@Example.org");
        assertThat(h).matches("[0-9a-f]{40}").isEqualTo(DatabaseRateCounts.hash("login-fail:asha@example.org"))
                .isNotEqualTo(DatabaseRateCounts.hash("login-fail:ben@example.org"));
        assertThat(RateCounts.store("auto", true)).isEqualTo("database");
        assertThat(RateCounts.store("auto", false)).isEqualTo("memory");
        assertThat(RateCounts.store(" Shared ", false)).isEqualTo("database");
        assertThat(RateCounts.store("local", true)).isEqualTo("memory");
    }

    @Test
    void theLimitHoldsAcrossInstances() throws SQLException {
        DatabaseRateCounts a = new DatabaseRateCounts(pool, clock);
        DatabaseRateCounts b = new DatabaseRateCounts(pool, clock);
        for (int i = 0; i < 5; i++) assertThat((i % 2 == 0 ? a : b).take("api:u:1", 5, W)).isZero();
        long refused = a.take("api:u:1", 5, W);
        assertThat(refused).isPositive();
        assertThat(b.take("api:u:1", 5, W)).isPositive();
        assertThat(hits("api:u:1", W)).as("a refusal counts nothing").isEqualTo(5);
        assertThat(a.take("api:u:2", 5, W)).as("another key").isZero();

        long at = clock.millis;
        clock.millis = at + refused - 1_000;
        assertThat(a.take("api:u:1", 5, W)).as("a second sooner than the wait given").isPositive();
        clock.millis = at + refused;
        assertThat(a.take("api:u:1", 5, W)).as("the wait given").isZero();
    }

    @Test
    void thePreviousWindowCountsByItsOverlap() {
        DatabaseRateCounts a = new DatabaseRateCounts(pool, clock);
        DatabaseRateCounts b = new DatabaseRateCounts(pool, clock);
        long start = DatabaseRateCounts.windowStart(t0, W);
        for (int i = 0; i < 10; i++) a.add("k", W);
        clock.millis = start + W + W / 2;
        int more = 0;
        while (b.take("k", 10, W) == 0 && more < 20) more++;
        assertThat(more).as("halfway into the next window").isEqualTo(5);
        clock.millis = start + 2 * W - 1;
        int later = 0;
        while (a.take("k", 10, W) == 0 && later < 20) later++;
        assertThat(later).as("near its end").isEqualTo(4);
        clock.millis = start + 3 * W + 1;
        assertThat(a.peek("k", 10, W)).isZero();
    }

    @Test
    void failedSignInsAcrossInstances() throws SQLException {
        AppProperties on = new AppProperties(null, null, null, null, null, null, null, null, new AppProperties.BotProtection(true, null, null, 1), null);
        RateLimiter one = new RateLimiter(on, new DatabaseRateCounts(pool, clock));
        RateLimiter two = new RateLimiter(on, new DatabaseRateCounts(pool, clock));
        int tries = 0;
        boolean blocked = false;
        for (int i = 0; i < 12 && !blocked; i++) {
            try {
                (i % 2 == 0 ? one : two).ensureUnder("login-fail", "ann@example.org", 10, Duration.ofMinutes(15));
                tries++;
                (i % 2 == 0 ? two : one).record("login-fail", "Ann@Example.org", Duration.ofMinutes(15));
            } catch (ApiException e) {
                blocked = true;
            }
        }
        assertThat(tries).isEqualTo(10);
        assertThat(blocked).isTrue();
        assertThat(hits("login-fail:ann@example.org", Duration.ofMinutes(15).toMillis())).isEqualTo(10);
        one.clear("login-fail", "ANN@example.org");
        two.ensureUnder("login-fail", "ann@example.org", 10, Duration.ofMinutes(15));
        int signups = 0;
        for (int i = 0; i < 25; i++) {
            try {
                (i % 2 == 0 ? one : two).check("register-ip", "203.0.113.9", 20, Duration.ofHours(1));
                signups++;
            } catch (ApiException e) {
                assertThat(e.getMessage()).contains("Please wait");
            }
        }
        assertThat(signups).isEqualTo(20);
    }

    @Test
    void hourlyLimitsGiveBackFailedRequests() throws SQLException {
        DatabaseRateCounts a = new DatabaseRateCounts(pool, clock);
        DatabaseRateCounts b = new DatabaseRateCounts(pool, clock);
        long hour = 3_600_000;
        assertThat(a.remaining("ai-hour:7", 30, hour)).isEqualTo(30);
        long at = clock.millis;
        for (int i = 0; i < 30; i++) assertThat((i % 2 == 0 ? a : b).take("ai-hour:7", 30, hour)).isZero();
        assertThat(b.remaining("ai-hour:7", 30, hour)).isZero();
        assertThat(a.take("ai-hour:7", 30, hour)).isPositive();
        a.giveBack("ai-hour:7", at, hour);
        assertThat(b.remaining("ai-hour:7", 30, hour)).as("a failed request's place comes back on every instance").isEqualTo(1);
        a.giveBack("voice-hour:8", clock.millis, hour);
        assertThat(hits("voice-hour:8", hour)).as("never below nothing").isZero();
        assertThat(a.remaining("voice-hour:8", 60, hour)).isEqualTo(60);
    }

    @Test
    void theWaitGivenIsAlwaysEnough() {
        DatabaseRateCounts a = new DatabaseRateCounts(pool, clock);
        DatabaseRateCounts b = new DatabaseRateCounts(pool, clock);
        Random random = new Random(7);
        int refusals = 0;
        List<String> wrong = new ArrayList<>();
        for (int s = 0; s < 300; s++) {
            int limit = 1 + random.nextInt(12);
            long window = random.nextBoolean() ? W : 15 * W;
            String k = "random:" + s;
            clock.millis = t0 + 10 * W + random.nextInt((int) (3 * window));
            long wait = 0;
            for (int i = 0; i < 60 && wait == 0; i++) {
                clock.millis += random.nextInt((int) (window / 4));
                if (random.nextInt(4) == 0) a.add(k, window);
                else wait = (random.nextBoolean() ? a : b).take(k, limit, window);
            }
            if (wait == 0) continue;
            refusals++;
            clock.millis += wait;
            if (wait > 2 * window || a.take(k, limit, window) != 0) wrong.add("limit " + limit + ", window " + window + ", wait " + wait);
        }
        assertThat(refusals).isGreaterThan(150);
        assertThat(wrong).isEmpty();
    }

    @Test
    void concurrentAttemptsTakeExactlyTheLimit() throws Exception {
        DatabaseRateCounts a = new DatabaseRateCounts(pool, clock);
        DatabaseRateCounts b = new DatabaseRateCounts(pool, clock);
        ExecutorService threads = Executors.newFixedThreadPool(8);
        AtomicInteger taken = new AtomicInteger();
        CountDownLatch go = new CountDownLatch(1);
        for (int i = 0; i < 400; i++) {
            DatabaseRateCounts on = i % 2 == 0 ? a : b;
            threads.submit(() -> {
                go.await();
                if (on.take("api:w:42", 50, W) == 0) taken.incrementAndGet();
                return null;
            });
        }
        go.countDown();
        threads.shutdown();
        assertThat(threads.awaitTermination(60, TimeUnit.SECONDS)).isTrue();
        assertThat(taken.get()).isEqualTo(50);
        assertThat(hits("api:w:42", W)).isEqualTo(50);
    }

    @Test
    void theSweepAndTheFallback() throws SQLException {
        DatabaseRateCounts a = new DatabaseRateCounts(pool, clock);
        for (int i = 0; i < 5; i++) a.take("old:" + i, 5, W);
        clock.millis = t0 + DatabaseRateCounts.KEEP_MS + 2 * W;
        a.take("fresh", 5, W);
        a.sweep();
        assertThat(rows()).isEqualTo(1);

        DatabaseRateCounts offline = new DatabaseRateCounts(new Down(), clock);
        int ok = 0;
        for (int i = 0; i < 4; i++) ok += offline.take("contact:1.2.3.4", 3, W) == 0 ? 1 : 0;
        assertThat(ok).as("database down: still limited, in memory").isEqualTo(3);
    }

    @Test
    void theMemoryStoreIsExact() throws Exception {
        Hand mc = new Hand(1_000_000);
        MemoryRateCounts memory = new MemoryRateCounts(mc);
        for (int i = 0; i < 3; i++) assertThat(memory.take("k", 3, W)).isZero();
        mc.millis += 30_000;
        assertThat(memory.take("k", 3, W)).isEqualTo(30_000);
        mc.millis += 30_000;
        assertThat(memory.take("k", 3, W)).isZero();
        for (int i = 0; i < 12; i++) memory.add("f", 15 * W);
        mc.millis += W;
        assertThat(memory.peek("f", 10, 15 * W)).as("past the limit, until enough have slid out").isEqualTo(14 * W);
        memory.clear("f");
        assertThat(memory.peek("f", 10, 15 * W)).isZero();
        long before = mc.millis;
        for (int i = 0; i < 3; i++) memory.take("h", 3, 60 * W);
        memory.giveBack("h", before, 60 * W);
        assertThat(memory.remaining("h", 3, 60 * W)).isEqualTo(1);
        memory.giveBack("h", mc.millis + 1, 60 * W);
        assertThat(memory.remaining("h", 3, 60 * W)).as("only a hit from that moment on").isEqualTo(1);

        MemoryRateCounts shared = new MemoryRateCounts(new Hand(5_000_000));
        ExecutorService threads = Executors.newFixedThreadPool(8);
        AtomicInteger taken = new AtomicInteger();
        for (int i = 0; i < 2_000; i++) {
            threads.submit(() -> {
                if (shared.take("burst", 100, W) == 0) taken.incrementAndGet();
                shared.sweep();
            });
        }
        threads.shutdown();
        assertThat(threads.awaitTermination(30, TimeUnit.SECONDS)).isTrue();
        assertThat(taken.get()).isEqualTo(100);
    }
}
