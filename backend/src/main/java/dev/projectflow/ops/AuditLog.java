package dev.projectflow.ops;

import dev.projectflow.config.AppProperties;
import dev.projectflow.config.LaunchProperties;
import dev.projectflow.security.ClientInfo;
import jakarta.servlet.http.HttpServletRequest;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

/**
 * The audit log: sensitive operations with who did them, in which project, to what, whether they
 * were allowed, when, from which network (coarse) and in which request. Records are written by the
 * application only; there's no way to edit or delete one except the retention purge
 * (AUDIT_RETENTION_DAYS, at least 180). Writing a record never fails the operation it describes: a
 * write that fails is logged instead.
 *
 * <p>What goes in {@code detail} is chosen by the caller and never includes passwords, tokens,
 * links, prompts or written content.
 */
@Component
public class AuditLog {

    private static final Logger log = LoggerFactory.getLogger(AuditLog.class);

    public static final String OK = "ok";
    public static final String DENIED = "denied";
    public static final String FAILED = "failed";

    public record Event(long id, Instant at, Long actorId, String actorName, Long projectId, String action, String target, String outcome,
                       String detail, String network) {}

    private final JdbcTemplate jdbc;
    private final Clock clock;
    private final int retentionDays;
    private final int trustedProxies;
    private final AfterTransaction after;

    public AuditLog(JdbcTemplate jdbc, Clock clock, LaunchProperties launch, AppProperties props, AfterTransaction after) {
        this.jdbc = jdbc;
        this.clock = clock;
        this.after = after;
        this.retentionDays = (launch == null ? LaunchProperties.defaults() : launch).auditOrDefault().retention();
        this.trustedProxies = props == null || props.botProtection() == null ? 1 : props.botProtection().proxies();
    }

    /**
     * Records an operation. A success is written inside the caller's transaction, so it's kept only
     * if the change it describes is. A refusal or failure is usually followed by an error that rolls
     * the transaction back, so it's written after the transaction finishes, in its own: refused
     * attempts are always kept.
     */
    public void record(Long actorId, Long projectId, String action, String target, String outcome, String detail) {
        // The request's details are read now: they're gone once the transaction has finished.
        Timestamp at = Timestamp.from(Instant.now(clock));
        String network = network();
        String requestId = cut(MDC.get("requestId"), 64);
        Runnable write = () -> {
            try {
                jdbc.update("INSERT INTO audit_events (at, actor_id, project_id, action, target, outcome, detail, network, request_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                        at, actorId, projectId, cut(action, 48), cut(target, 80), cut(outcome, 16), cut(detail, 500), network, requestId);
            } catch (RuntimeException e) {
                log.warn("Couldn't write the audit record {} ({}): {}", action, outcome, e.getMessage());
            }
        };
        if (OK.equals(outcome) || after == null) write.run();
        else after.runAfterCompletion(write);
    }

    /** A project's records, newest first; {@code beforeId} pages back. */
    public List<Event> forProject(long projectId, int limit, Long beforeId) {
        return jdbc.query(SELECT + " WHERE a.project_id = ? AND a.id < ? ORDER BY a.id DESC LIMIT ?", (rs, i) -> row(rs),
                projectId, beforeId == null ? Long.MAX_VALUE : beforeId, Math.max(1, Math.min(limit, 200)));
    }

    /** What an account did (and what was done to it, for account events), newest first. */
    public List<Event> forActor(long userId, int limit) {
        return jdbc.query(SELECT + " WHERE a.actor_id = ? ORDER BY a.id DESC LIMIT ?", (rs, i) -> row(rs), userId, Math.max(1, Math.min(limit, 1000)));
    }

    /** The newest records across the server, for operators. */
    public List<Event> recent(int limit, String actionPrefix) {
        if (actionPrefix == null || actionPrefix.isBlank()) {
            return jdbc.query(SELECT + " ORDER BY a.id DESC LIMIT ?", (rs, i) -> row(rs), Math.max(1, Math.min(limit, 500)));
        }
        return jdbc.query(SELECT + " WHERE a.action LIKE ? ORDER BY a.id DESC LIMIT ?", (rs, i) -> row(rs),
                actionPrefix.replace("%", "").replace("_", "\\_") + "%", Math.max(1, Math.min(limit, 500)));
    }

    /** Records within the retention period are kept; older ones are removed nightly. */
    @Scheduled(cron = "0 41 3 * * *")
    public void purge() {
        int removed = jdbc.update("DELETE FROM audit_events WHERE at < ?", Timestamp.from(Instant.now(clock).minus(Duration.ofDays(retentionDays))));
        if (removed > 0) log.info("Audit log: removed {} records older than {} days.", removed, retentionDays);
    }

    private static final String SELECT = "SELECT a.*, u.name AS actor_name FROM audit_events a LEFT JOIN users u ON u.id = a.actor_id";

    private static Event row(ResultSet rs) throws SQLException {
        long actor = rs.getLong("actor_id");
        Long actorId = rs.wasNull() ? null : actor;
        long project = rs.getLong("project_id");
        Long projectId = rs.wasNull() ? null : project;
        Timestamp at = rs.getTimestamp("at");
        return new Event(rs.getLong("id"), at == null ? null : at.toInstant(), actorId, rs.getString("actor_name"), projectId, rs.getString("action"),
                rs.getString("target"), rs.getString("outcome"), rs.getString("detail"), rs.getString("network"));
    }

    /** The current request's network (IPv4 /24, IPv6 /48), or null outside a request. */
    private String network() {
        try {
            if (!(RequestContextHolder.getRequestAttributes() instanceof ServletRequestAttributes attrs)) return null;
            HttpServletRequest request = attrs.getRequest();
            return coarse(ClientInfo.of(request, trustedProxies).ip());
        } catch (RuntimeException e) {
            return null;
        }
    }

    static String coarse(String ip) {
        return dev.projectflow.security.SessionStore.network(ip);
    }

    static String cut(String s, int max) {
        if (s == null) return null;
        String one = s.replaceAll("[\\p{Cntrl}]+", " ").trim();
        return one.length() > max ? one.substring(0, max - 1) + "…" : one;
    }
}
