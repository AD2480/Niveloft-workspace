package dev.projectflow.service;

import dev.projectflow.domain.Role;
import dev.projectflow.security.ProjectAccess;
import dev.projectflow.web.dto.Dto;
import dev.projectflow.web.error.ApiException;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Set;
import java.util.TreeMap;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

/**
 * Counts how the blocker journey is used, so it can be measured: a blocker shown, its evidence
 * opened, its ways forward opened, a response previewed, a response confirmed, or the panel closed
 * without one. Only counts: no person, task or text. Any member's page records its own steps; only
 * owners and managers read the counts, for their project.
 */
@Service
public class JourneyService {

    private static final Logger log = LoggerFactory.getLogger(JourneyService.class);

    public static final Set<String> STEPS = Set.of("shown", "evidence", "impact", "previewed", "confirmed", "dismissed");
    public static final Set<String> BLOCKERS = Set.of("review", "late", "in-progress", "not-started", "last");
    public static final Set<String> RESPONSES = Set.of("review-now", "ask-review", "cut-scope", "reassign", "take-it", "ask-owner");
    static final int RETENTION_DAYS = 180;

    private final JdbcTemplate jdbc;
    private final ProjectAccess access;
    private final Clock clock;

    public JourneyService(JdbcTemplate jdbc, ProjectAccess access, Clock clock) {
        this.jdbc = jdbc;
        this.access = access;
        this.clock = clock;
    }

    /** Records one step. Unknown values are refused, so the counts stay a closed set of words. */
    public void record(Long projectId, String step, String blockerKind, String option) {
        access.require(projectId);
        if (!STEPS.contains(step)) throw ApiException.validation("step", "Unknown step.");
        if (blockerKind != null && !BLOCKERS.contains(blockerKind)) throw ApiException.validation("blockerKind", "Unknown kind of blocker.");
        if (option != null && !RESPONSES.contains(option)) throw ApiException.validation("option", "Unknown response.");
        jdbc.update("INSERT INTO journey_events (project_id, step, blocker_kind, option_kind, created_at) VALUES (?, ?, ?, ?, ?)",
                projectId, step, blockerKind, option, Timestamp.from(Instant.now(clock)));
    }

    /** The counts of the last {@code days} days (1 to 180), for the project's owners and managers. */
    public Dto.JourneySummary summary(Long projectId, int days) {
        ProjectAccess.Access a = access.require(projectId);
        if (!Permissions.atLeast(a.role(), Role.MANAGER)) throw ApiException.forbidden("Only the project’s owners and managers can see how the blocker journey is used.");
        int span = Math.max(1, Math.min(RETENTION_DAYS, days));
        Instant since = Instant.now(clock).minus(Duration.ofDays(span));
        TreeMap<String, Long> steps = new TreeMap<>();
        TreeMap<String, java.util.Map<String, Long>> responses = new TreeMap<>();
        jdbc.query("SELECT step, option_kind, COUNT(*) AS n FROM journey_events WHERE project_id = ? AND created_at > ? GROUP BY step, option_kind",
                rs -> {
                    String step = rs.getString("step");
                    String option = rs.getString("option_kind");
                    long n = rs.getLong("n");
                    steps.merge(step, n, Long::sum);
                    if (option != null) responses.computeIfAbsent(option, k -> new TreeMap<>()).merge(step, n, Long::sum);
                },
                projectId, Timestamp.from(since));
        return new Dto.JourneySummary(since, span, steps, responses);
    }

    @Scheduled(cron = "0 47 3 * * *")
    public void purge() {
        try {
            int n = jdbc.update("DELETE FROM journey_events WHERE created_at < ?", Timestamp.from(Instant.now(clock).minus(Duration.ofDays(RETENTION_DAYS))));
            if (n > 0) log.info("Removed {} blocker-journey counts older than {} days", n, RETENTION_DAYS);
        } catch (RuntimeException e) {
            log.warn("Couldn't remove old blocker-journey counts: {}", e.getMessage());
        }
    }
}
