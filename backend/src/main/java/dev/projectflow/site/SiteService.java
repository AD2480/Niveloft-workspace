package dev.projectflow.site;

import dev.projectflow.config.OpsProperties;
import dev.projectflow.email.AccountEmails;
import dev.projectflow.email.EmailService;
import dev.projectflow.ops.Operators;
import dev.projectflow.ops.UsageCounters;
import dev.projectflow.security.AuthUser;
import dev.projectflow.security.ClientInfo;
import dev.projectflow.security.CurrentUser;
import dev.projectflow.security.HumanCheck;
import dev.projectflow.security.ProjectAccess;
import dev.projectflow.security.RateLimiter;
import dev.projectflow.web.dto.Dto;
import dev.projectflow.web.dto.Requests;
import dev.projectflow.web.error.ApiException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.HexFormat;
import java.util.Locale;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The Contact form, form success counts, the operator's Site health page and Arena votes.
 */
@Service
public class SiteService {

    private static final Logger log = LoggerFactory.getLogger(SiteService.class);

    /** The forms the app counts, and the moments it counts (see frontend lib/formMetrics.ts). */
    static final Set<String> FORMS = Set.of("sign-in", "sign-up", "forgot-password", "reset-password", "contact", "project", "task", "milestone", "invite",
            "submit-work", "review", "profile", "password", "comment");
    static final Set<String> EVENTS = Set.of("view", "submit", "success", "invalid", "rejected", "failed");

    private final SiteRecords records;
    private final UsageCounters usage;
    private final RateLimiter limits;
    private final HumanCheck human;
    private final EmailService email;
    private final AccountEmails emails;
    private final Operators operators;
    private final OpsProperties.Spending spending;
    private final ProjectAccess access;
    private final Clock clock;

    public SiteService(SiteRecords records, UsageCounters usage, RateLimiter limits, HumanCheck human, EmailService email, AccountEmails emails, Operators operators,
                       OpsProperties ops, ProjectAccess access, Clock clock) {
        this.records = records;
        this.usage = usage;
        this.limits = limits;
        this.human = human;
        this.email = email;
        this.emails = emails;
        this.operators = operators;
        this.spending = ops == null ? new OpsProperties(null, null).spendingOrDefault() : ops.spendingOrDefault();
        this.access = access;
        this.clock = clock;
    }

    // ------------------------------------------------------------------ contact

    /**
     * Saves a message for the operator and emails it to them when this server sends email. The same
     * message sent twice within ten minutes (a double click, a retry after a dropped connection) is
     * saved once: the second send gets the first one's receipt.
     */
    @Transactional
    public Dto.ContactReceipt contact(Requests.Contact c, ClientInfo client) {
        limits.check("contact", client.limitKey(), 5, Duration.ofHours(1));
        human.require(c.website(), c.captchaToken(), client.ip());
        Instant now = Instant.now(clock);
        String hash = sha256(c.email().trim().toLowerCase(Locale.ROOT) + "\n" + c.message().trim());
        String to = emails.contactAddress();
        boolean delivered = email.delivers() && !to.isEmpty();
        var duplicate = records.recentDuplicate(hash, now.minus(10, ChronoUnit.MINUTES));
        if (duplicate.isPresent()) return new Dto.ContactReceipt(duplicate.get(), delivered);
        long id = records.insertContact(signedInUserId(), c, hash, now);
        if (email.enabled() && !to.isEmpty()) {
            email.send(emails.contactReceived(to, c.name().trim(), c.email().trim(), c.topic().label(), c.message().trim(), c.reference(), c.page()));
        } else {
            log.info("Contact message {} saved (no CONTACT_EMAIL or email provider set, so it's only on the Site health page).", id);
        }
        return new Dto.ContactReceipt(id, delivered);
    }

    private static Long signedInUserId() {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        return auth != null && auth.getPrincipal() instanceof AuthUser u ? u.id() : null;
    }

    // ------------------------------------------------------------------ form counts

    /** Adds the browser's form counts to today's counters. Unknown forms and events are ignored. */
    public void recordFormMetrics(Requests.FormMetrics m, ClientInfo client) {
        limits.check("form-metrics", client.limitKey(), 30, Duration.ofMinutes(1));
        String today = usage.today();
        for (Requests.FormMetric e : m.events()) {
            if (!FORMS.contains(e.form()) || !EVENTS.contains(e.event())) continue;
            usage.add("form." + e.form() + "." + e.event(), today, Math.min(50, Math.max(1, e.count())));
        }
    }

    // ------------------------------------------------------------------ site health

    @Transactional(readOnly = true)
    public Dto.SiteHealth health(int days) {
        operators.require();
        int d = Math.min(365, Math.max(1, days));
        LocalDate to = LocalDate.now(clock);
        LocalDate from = to.minusDays(d - 1L);
        Instant since = from.atStartOfDay(clock.getZone()).toInstant();
        Dto.Spending money = new Dto.Spending(
                usage.get("ai.requests", usage.today()), spending.aiPerDay(), usage.get("ai.tokens", usage.thisMonth()), spending.aiTokens(),
                usage.get("email.sent", usage.today()), spending.emailPerDay(), usage.get("email.sent", usage.thisMonth()), spending.emailPerMonth());
        return new Dto.SiteHealth(d, from, to, records.formStats(from.toString()), records.signups(since),
                new Dto.ContactSummary(records.countContact(true), records.countContact(false), records.recentContact(50)), money, records.votesSince(since));
    }

    @Transactional
    public Dto.ContactMessage markHandled(long id, boolean handled) {
        operators.require();
        return records.setHandled(id, handled, Instant.now(clock)).orElseThrow(() -> ApiException.notFound("That message doesn’t exist."));
    }

    // ------------------------------------------------------------------ arena

    /** Records which answer the person preferred. Only members of the project can vote on its questions. */
    @Transactional
    public Dto.ArenaScoreboard vote(Requests.ArenaVote v) {
        Long me = CurrentUser.id();
        access.require(v.projectId());
        if (v.a().equals(v.b())) throw ApiException.validation("b", "The two answers must come from different sources.");
        limits.check("arena-vote", String.valueOf(me), 60, Duration.ofHours(1));
        records.insertVote(me, v.projectId(), v.a(), v.b(), v.winner(), Instant.now(clock));
        return records.scoreboard(me);
    }

    @Transactional(readOnly = true)
    public Dto.ArenaScoreboard scoreboard() {
        return records.scoreboard(CurrentUser.id());
    }

    static String sha256(String s) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
