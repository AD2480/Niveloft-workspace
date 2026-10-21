package dev.projectflow.ops;

import dev.projectflow.config.LaunchProperties;
import dev.projectflow.config.OpsProperties;
import dev.projectflow.web.error.ApiException;
import dev.projectflow.web.error.ErrorCode;
import java.time.Clock;
import java.time.Instant;
import java.util.concurrent.Semaphore;
import java.util.function.Supplier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Flurry's spending, reserved before a provider is called and settled after it answers. A request
 * first takes a place among the questions being answered at once on this server
 * (AI_MAX_CONCURRENT), then reserves, atomically in the database (so every server instance shares
 * them): one of the server's requests for today (AI_MAX_REQUESTS_PER_DAY), one of the project's
 * (AI_MAX_REQUESTS_PER_PROJECT_PER_DAY), and an estimate of its tokens against this month's
 * budget (AI_MAX_TOKENS_PER_MONTH). When the provider answers, the real tokens and rounds replace
 * the estimate; when it never answered, everything is given back. If the counters can't be read,
 * the request is refused: unknown spending is never allowed.
 *
 * <p>The counters are changed in transactions of their own, committed at once, so a reservation is
 * visible to every other request straight away (and works from inside a read-only transaction).
 *
 * <p>The operator's "ai" switch turns every AI feature off at once; ordinary task work is untouched.
 * Each settled request leaves an audit record with its feature, rounds, lookups and tokens, never
 * its prompt or answer.
 */
@Component
public class AiBudget {

    private static final Logger log = LoggerFactory.getLogger(AiBudget.class);

    /** What a request reserved; settle or cancel it exactly once. */
    public record Ticket(Long userId, Long projectId, String feature, String day, String month, long tokens, Instant at) {}

    private final UsageCounters spent;
    private final OpsProperties.Spending spending;
    private final LaunchProperties.Ai limits;
    private final OpsSwitches switches;
    private final AuditLog audit;
    private final Clock clock;
    private final Semaphore inFlight;
    private final TransactionTemplate own;

    public AiBudget(UsageCounters spent, OpsProperties ops, LaunchProperties launch, OpsSwitches switches, AuditLog audit, Clock clock,
                    PlatformTransactionManager transactions) {
        this.spent = spent;
        if (transactions == null) {
            this.own = null;
        } else {
            this.own = new TransactionTemplate(transactions);
            this.own.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        }
        this.spending = ops == null ? new OpsProperties(null, null).spendingOrDefault() : ops.spendingOrDefault();
        this.limits = (launch == null ? LaunchProperties.defaults() : launch).aiOrDefault();
        this.switches = switches;
        this.audit = audit;
        this.clock = clock;
        this.inFlight = new Semaphore(limits.concurrent());
    }

    /** Whether the operator switched AI off (shown as the reason AI is unavailable). */
    public boolean switchedOff() {
        return switches != null && !switches.on("ai");
    }

    public Ticket reserve(Long userId, Long projectId, String feature, long estimatedTokens) {
        if (switches != null) switches.require("ai");
        if (!inFlight.tryAcquire()) {
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, ErrorCode.BUSY,
                    "Flurry is answering as many questions as this server allows right now. Nothing was generated; try again in a few seconds.", null);
        }
        String today = spent.today();
        String month = spent.thisMonth();
        try {
            // One transaction for the three counters: refused at any cap, none of them changes.
            String refused = inOwnTransaction(() -> {
                if (!spent.tryAdd("ai.requests", today, 1, spending.aiPerDay())) {
                    return "Today’s AI budget for this server (" + spending.aiPerDay() + " requests) is used up. It resets at midnight.";
                }
                if (projectId != null && !spent.tryAdd(projectCounter(projectId), today, 1, limits.perProjectPerDay())) {
                    spent.add("ai.requests", today, -1);
                    return "Today’s AI budget for this project (" + limits.perProjectPerDay() + " requests) is used up. It resets at midnight.";
                }
                if (!spent.tryAdd("ai.tokens", month, estimatedTokens, spending.aiTokens())) {
                    spent.add("ai.requests", today, -1);
                    if (projectId != null) spent.add(projectCounter(projectId), today, -1);
                    return "This month’s AI budget for this server (" + spending.aiTokens() + " tokens) is used up. It resets on the 1st.";
                }
                return null;
            });
            if (refused != null) {
                inFlight.release();
                throw cap(refused);
            }
            return new Ticket(userId, projectId, feature, today, month, estimatedTokens, Instant.now(clock));
        } catch (ApiException e) {
            throw e;
        } catch (RuntimeException e) {
            inFlight.release();
            log.warn("AI budget couldn't be checked, so the request was refused: {}", e.getMessage());
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, ErrorCode.AI_UNAVAILABLE,
                    "Flurry is unavailable for a moment because its budget couldn’t be checked. Nothing was generated; try again shortly.", null);
        }
    }

    /** The provider answered: count what it really used. */
    public void settle(Ticket t, long tokens, int requests, String detail) {
        try {
            long total = inOwnTransaction(() -> {
                if (requests > 1) {
                    spent.add("ai.requests", t.day(), requests - 1);
                    if (t.projectId() != null) spent.add(projectCounter(t.projectId()), t.day(), requests - 1);
                }
                return spent.add("ai.tokens", t.month(), tokens - t.tokens());
            });
            long cap = spending.aiTokens();
            if (cap > 0 && total >= cap * 0.8 && total - tokens < cap * 0.8) log.warn("AI: 80% of this month's token budget ({}) is used.", cap);
        } catch (RuntimeException e) {
            log.warn("Couldn't settle AI usage: {}", e.getMessage());
        } finally {
            inFlight.release();
        }
        if (audit != null) {
            audit.record(t.userId(), t.projectId(), "ai." + t.feature(), null, AuditLog.OK,
                    (detail == null || detail.isBlank() ? "" : detail + "; ") + requests + " round(s), " + tokens + " tokens");
        }
    }

    /** The provider never answered (or nothing was sent): give everything back. */
    public void cancel(Ticket t, String why) {
        try {
            inOwnTransaction(() -> {
                spent.add("ai.requests", t.day(), -1);
                if (t.projectId() != null) spent.add(projectCounter(t.projectId()), t.day(), -1);
                return spent.add("ai.tokens", t.month(), -t.tokens());
            });
        } catch (RuntimeException e) {
            log.warn("Couldn't give back AI usage: {}", e.getMessage());
        } finally {
            inFlight.release();
        }
        if (audit != null && why != null) audit.record(t.userId(), t.projectId(), "ai." + t.feature(), null, AuditLog.FAILED, why);
    }

    /** Questions being answered right now on this server (for Site health). */
    public int inFlight() {
        return limits.concurrent() - inFlight.availablePermits();
    }

    private <T> T inOwnTransaction(Supplier<T> work) {
        return own == null ? work.get() : own.execute(status -> work.get());
    }

    static String projectCounter(Long projectId) {
        return "ai.project." + projectId;
    }

    private static ApiException cap(String message) {
        return new ApiException(HttpStatus.TOO_MANY_REQUESTS, ErrorCode.SPENDING_CAP, message + " Nothing was generated.", null);
    }
}
