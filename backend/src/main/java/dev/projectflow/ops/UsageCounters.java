package dev.projectflow.ops;

import java.time.Clock;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * Counters for spending caps (AI requests and tokens, emails), per day or per month. Kept in the
 * database, so a restart or a second server instance can't reset them.
 */
@Component
public class UsageCounters {

    private static final DateTimeFormatter MONTH = DateTimeFormatter.ofPattern("yyyy-MM");
    private final JdbcTemplate jdbc;
    private final Clock clock;

    public UsageCounters(JdbcTemplate jdbc, Clock clock) {
        this.jdbc = jdbc;
        this.clock = clock;
    }

    public String today() {
        return LocalDate.now(clock).toString();
    }

    public String thisMonth() {
        return LocalDate.now(clock).format(MONTH);
    }

    public long get(String counter, String period) {
        Long v = jdbc.query("SELECT amount FROM usage_counters WHERE counter_name = ? AND period_key = ?", rs -> rs.next() ? rs.getLong(1) : 0L, counter, period);
        return v == null ? 0 : v;
    }

    /**
     * Adds {@code delta} only if the total stays within {@code cap} (0 or less: no cap), atomically:
     * concurrent requests can't both take the last unit, on one server or several. True when added.
     */
    public boolean tryAdd(String counter, String period, long delta, long cap) {
        if (cap <= 0) {
            add(counter, period, delta);
            return true;
        }
        if (delta > cap) return false;
        for (int attempt = 0; attempt < 3; attempt++) {
            int updated = jdbc.update("UPDATE usage_counters SET amount = amount + ? WHERE counter_name = ? AND period_key = ? AND amount + ? <= ?",
                    delta, counter, period, delta, cap);
            if (updated == 1) return true;
            Long existing = jdbc.query("SELECT amount FROM usage_counters WHERE counter_name = ? AND period_key = ?", rs -> rs.next() ? rs.getLong(1) : null, counter, period);
            if (existing != null) return false; // the row exists, so the update failed on the cap
            try {
                jdbc.update("INSERT INTO usage_counters (counter_name, period_key, amount) VALUES (?, ?, ?)", counter, period, delta);
                return true;
            } catch (DuplicateKeyException raced) {
                // someone created it first: try the capped update again
            }
        }
        return false;
    }

    /** Adds to a counter (creating it if needed) and returns the new total. */
    public long add(String counter, String period, long delta) {
        for (int attempt = 0; attempt < 3; attempt++) {
            int updated = jdbc.update("UPDATE usage_counters SET amount = amount + ? WHERE counter_name = ? AND period_key = ?", delta, counter, period);
            if (updated == 0) {
                try {
                    jdbc.update("INSERT INTO usage_counters (counter_name, period_key, amount) VALUES (?, ?, ?)", counter, period, delta);
                } catch (DuplicateKeyException raced) {
                    continue; // someone else created it first: add to theirs
                }
            }
            return get(counter, period);
        }
        return get(counter, period);
    }
}
