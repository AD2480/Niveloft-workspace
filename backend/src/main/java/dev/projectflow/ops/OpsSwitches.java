package dev.projectflow.ops;

import dev.projectflow.web.error.ApiException;
import dev.projectflow.web.error.ErrorCode;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * Emergency switches an operator flips without a deploy (Site health, or {@code PUT /api/ops/switches/{name}}):
 * Flurry and every AI feature, the natural voice, uploads, exports, sign-ups and invitations.
 * Each one switches off one feature and leaves the rest of Niveloft working. Stored in the
 * database, so every server instance follows within a few seconds.
 */
@Component
public class OpsSwitches {

    private static final Logger log = LoggerFactory.getLogger(OpsSwitches.class);

    /** The switches, with what turning each off stops. */
    public static final Map<String, String> NAMES = Map.of(
            "ai", "Flurry and every AI feature",
            "voice", "the natural voice for reading answers aloud",
            "uploads", "uploading files",
            "exports", "downloading project and account exports",
            "signups", "creating new accounts",
            "invitations", "inviting people to projects",
            "forecast-model", "the forecast model trial (Niveloft’s own forecast is unaffected)");

    public record Switch(String name, String stops, boolean enabled, String reason, Instant changedAt, Long changedBy) {}

    private record Cached(boolean on, Instant at) {}

    static final Duration CACHE = Duration.ofSeconds(5);
    private final JdbcTemplate jdbc;
    private final Clock clock;
    private final Map<String, Cached> cache = new ConcurrentHashMap<>();

    public OpsSwitches(JdbcTemplate jdbc, Clock clock) {
        this.jdbc = jdbc;
        this.clock = clock;
    }

    /** Whether a feature is on. Unknown names and switches nobody has flipped are on; if the database can't be read, the last known value stands. */
    public boolean on(String name) {
        Instant now = Instant.now(clock);
        Cached c = cache.get(name);
        if (c != null && c.at().plus(CACHE).isAfter(now)) return c.on();
        try {
            List<Boolean> rows = jdbc.query("SELECT enabled FROM ops_switches WHERE name = ?", (rs, i) -> rs.getBoolean(1), name);
            boolean on = rows.isEmpty() || rows.get(0);
            cache.put(name, new Cached(on, now));
            return on;
        } catch (RuntimeException e) {
            log.warn("Couldn't read the {} switch: {}", name, e.getMessage());
            return c == null || c.on();
        }
    }

    /** Refuses the request when the feature is switched off, saying what's off and that nothing happened. */
    public void require(String name) {
        if (on(name)) return;
        String what = switch (name) {
            case "ai" -> "Flurry and the other AI features are";
            case "voice" -> "The natural voice is";
            case "uploads" -> "Uploads are";
            case "exports" -> "Exports are";
            case "signups" -> "New sign-ups are";
            case "invitations" -> "Invitations are";
            case "forecast-model" -> "The forecast model trial is";
            default -> "This feature is";
        };
        throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, ErrorCode.NOT_AVAILABLE,
                what + " switched off on this server for now by its operator. Nothing was changed; everything else works as usual.", null);
    }

    public List<Switch> list() {
        Map<String, Switch> stored = new ConcurrentHashMap<>();
        jdbc.query("SELECT * FROM ops_switches", rs -> {
            Timestamp at = rs.getTimestamp("changed_at");
            long by = rs.getLong("changed_by");
            Long changedBy = rs.wasNull() ? null : by;
            String n = rs.getString("name");
            stored.put(n, new Switch(n, NAMES.getOrDefault(n, n), rs.getBoolean("enabled"), rs.getString("reason"), at == null ? null : at.toInstant(), changedBy));
        });
        List<Switch> out = new ArrayList<>();
        NAMES.keySet().stream().sorted().forEach(n -> out.add(stored.getOrDefault(n, new Switch(n, NAMES.get(n), true, null, null, null))));
        return out;
    }

    public Switch set(String name, boolean enabled, String reason, Long actorId) {
        if (!NAMES.containsKey(name)) throw ApiException.notFound("There's no switch called " + name + ".");
        Instant now = Instant.now(clock);
        String why = reason == null || reason.isBlank() ? null : AuditLog.cut(reason, 200);
        int updated = jdbc.update("UPDATE ops_switches SET enabled = ?, reason = ?, changed_at = ?, changed_by = ? WHERE name = ?",
                enabled, why, Timestamp.from(now), actorId, name);
        if (updated == 0) {
            jdbc.update("INSERT INTO ops_switches (name, enabled, reason, changed_at, changed_by) VALUES (?, ?, ?, ?, ?)",
                    name, enabled, why, Timestamp.from(now), actorId);
        }
        cache.put(name, new Cached(enabled, now));
        log.warn("Switch '{}' turned {} by user {}{}", name, enabled ? "on" : "off", actorId, why == null ? "" : ": " + why);
        return new Switch(name, NAMES.get(name), enabled, why, now, actorId);
    }
}
