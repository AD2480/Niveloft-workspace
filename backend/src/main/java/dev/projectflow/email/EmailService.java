package dev.projectflow.email;

import org.springframework.beans.factory.annotation.Autowired;
import dev.projectflow.ops.UsageCounters;
import dev.projectflow.config.OpsProperties;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import dev.projectflow.config.AppProperties;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.DisposableBean;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/**
 * Sends account emails in the background, so a slow mail provider never slows down sign-in.
 *
 * <ul>
 *   <li>{@code none}: nothing is sent (the app says so where it matters, e.g. password reset);</li>
 *   <li>{@code log}: the email is written to the server log (local testing: copy the link);</li>
 *   <li>{@code resend}: sent through Resend's HTTPS API. Hosts such as Railway block SMTP, so
 *       an HTTPS API is the dependable choice.</li>
 * </ul>
 */
@Service
public class EmailService implements DisposableBean {

    private static final Logger log = LoggerFactory.getLogger(EmailService.class);

    private final String provider;
    private final String apiKey;
    private final String from;
    private final String replyTo;
    private final String apiUrl;
    private final ObjectMapper json;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();
    private final ThreadPoolExecutor executor = new ThreadPoolExecutor(1, 2, 60, TimeUnit.SECONDS, new ArrayBlockingQueue<>(500), r -> {
        Thread t = new Thread(r, "projectflow-email");
        t.setDaemon(true);
        return t;
    });

    /** Daily and monthly caps on delivered emails (null: no caps, e.g. in tests). */
    private final UsageCounters usage;
    private final OpsProperties.Spending spending;

    public EmailService(AppProperties props, ObjectMapper json) {
        this(props, json, null, null);
    }

    @Autowired
    public EmailService(AppProperties props, ObjectMapper json, UsageCounters usage, OpsProperties ops) {
        this.usage = usage;
        this.spending = ops == null ? null : ops.spendingOrDefault();
        AppProperties.Email e = props.email();
        this.provider = e == null ? "none" : e.providerOrNone();
        this.apiKey = e == null || e.apiKey() == null ? "" : e.apiKey().trim();
        this.from = e == null || e.from() == null || e.from().isBlank() ? "Niveloft <onboarding@resend.dev>" : e.from().trim();
        this.replyTo = e == null || e.replyTo() == null ? "" : e.replyTo().trim();
        this.apiUrl = e == null || e.apiUrl() == null || e.apiUrl().isBlank() ? "https://api.resend.com/emails" : e.apiUrl().trim();
        this.json = json;
        if ("resend".equals(provider) && apiKey.isEmpty()) {
            throw new IllegalStateException("EMAIL_PROVIDER=resend needs EMAIL_API_KEY (a Resend API key, starting with re_).");
        }
        if (!"none".equals(provider) && !"log".equals(provider) && !"resend".equals(provider)) {
            throw new IllegalStateException("EMAIL_PROVIDER must be none, log or resend (was: " + provider + ").");
        }
        log.info("Email: {}", switch (provider) {
            case "resend" -> "sent through Resend from " + from;
            case "log" -> "written to this log, not sent (EMAIL_PROVIDER=log)";
            default -> "off (EMAIL_PROVIDER=none)";
        });
    }

    /** True when emails actually reach people's inboxes. */
    public boolean delivers() {
        return "resend".equals(provider);
    }

    /** True when emails are produced at all (delivered, or written to the log for testing). */
    public boolean enabled() {
        return !"none".equals(provider);
    }

    /**
     * Queues an email. Inside a transaction it waits for the commit, so a link never arrives before
     * the record it points to exists. Failures are logged, never thrown: an email can't undo a sign-in.
     */
    public void send(EmailMessage m) {
        if (!enabled()) return;
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    enqueue(m);
                }
            });
        } else {
            enqueue(m);
        }
    }

    private void enqueue(EmailMessage m) {
        try {
            executor.execute(() -> deliver(m));
        } catch (RuntimeException full) {
            log.warn("Email queue is full; dropped \"{}\" to {}", m.subject(), mask(m.to()));
        }
    }

    void deliver(EmailMessage m) {
        if ("log".equals(provider)) {
            log.info("EMAIL (not sent, EMAIL_PROVIDER=log)\nTo: {}\nSubject: {}\n\n{}", m.to(), m.subject(), m.text());
            return;
        }
        if (overBudget(m)) return;
        try {
            ObjectNode body = json.createObjectNode();
            body.put("from", from);
            body.putArray("to").add(m.to());
            body.put("subject", m.subject());
            body.put("text", m.text());
            body.put("html", m.html());
            String reply = m.replyTo() != null && !m.replyTo().isBlank() ? m.replyTo().trim() : replyTo;
            if (!reply.isEmpty()) body.put("reply_to", reply);
            HttpResponse<String> res = http.send(
                    HttpRequest.newBuilder(URI.create(apiUrl))
                            .timeout(Duration.ofSeconds(20))
                            .header("Authorization", "Bearer " + apiKey)
                            .header("Content-Type", "application/json")
                            .POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body)))
                            .build(),
                    HttpResponse.BodyHandlers.ofString());
            if (res.statusCode() / 100 == 2) {
                log.info("Email \"{}\" sent to {}", m.subject(), mask(m.to()));
                count();
            } else {
                // The provider's message says what's wrong (unverified domain, bad key…); it holds no secrets.
                log.warn("Email \"{}\" to {} was refused ({}): {}", m.subject(), mask(m.to()), res.statusCode(), abbreviate(res.body()));
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        } catch (Exception e) {
            log.warn("Email \"{}\" to {} failed: {}", m.subject(), mask(m.to()), e.toString());
        }
    }

    /**
     * The spending caps on delivered email (Resend's free tier allows 100 a day and 3,000 a month).
     * Over a cap, the email isn't sent and the log says so; the app keeps working. Courtesy notices
     * (sign-in alerts, "you already have an account") stop sooner: the last fifth of the day's budget
     * and the last tenth of the month's are kept for confirmations, password resets and security
     * notices, so a busy day of sign-ins can't stop new people confirming their address.
     */
    boolean overBudget(EmailMessage m) {
        if (usage == null || spending == null) return false;
        try {
            int day = spending.emailPerDay();
            int month = spending.emailPerMonth();
            long today = usage.get("email.sent", usage.today());
            long thisMonth = usage.get("email.sent", usage.thisMonth());
            if ((day > 0 && today >= day) || (month > 0 && thisMonth >= month)) {
                log.warn("Email \"{}\" to {} not sent: the email spending cap ({} a day, {} a month) is reached.", m.subject(), mask(m.to()), day, month);
                return true;
            }
            if (m.courtesy() && ((day > 0 && today >= day - reserve(day, 5)) || (month > 0 && thisMonth >= month - reserve(month, 10)))) {
                log.info("Email \"{}\" to {} not sent: the rest of the email budget ({} of {} sent today, {} of {} this month) is kept for "
                        + "confirmations, password resets and security notices.", m.subject(), mask(m.to()), today, day, thisMonth, month);
                return true;
            }
        } catch (RuntimeException e) {
            log.warn("Couldn't check email usage: {}", e.getMessage());
        }
        return false;
    }

    /** The part of a cap kept for emails people can't do without: {@code 1/share} of it, at least one. */
    static int reserve(int cap, int share) {
        return Math.max(1, cap / share);
    }

    private void count() {
        if (usage == null) return;
        try {
            usage.add("email.sent", usage.today(), 1);
            usage.add("email.sent", usage.thisMonth(), 1);
        } catch (RuntimeException e) {
            log.warn("Couldn't record email usage: {}", e.getMessage());
        }
    }

    /** a***@example.com: enough to recognise in logs without writing out addresses. */
    static String mask(String email) {
        int at = email == null ? -1 : email.indexOf('@');
        if (at <= 0) return "(hidden)";
        return email.charAt(0) + "***" + email.substring(at);
    }

    private static String abbreviate(String s) {
        return s == null ? "" : s.length() > 300 ? s.substring(0, 300) + "…" : s;
    }

    /** Lets queued emails finish (up to 10 seconds) when the server stops. */
    @Override
    public void destroy() throws InterruptedException {
        executor.shutdown();
        executor.awaitTermination(10, TimeUnit.SECONDS);
    }
}
