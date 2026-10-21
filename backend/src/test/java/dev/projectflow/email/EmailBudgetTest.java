// Ported from the plain-Java checks that ran in the sandbox for this release (the same assertions,
// now run by ./mvnw verify).
package dev.projectflow.email;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import dev.projectflow.config.AppProperties;
import dev.projectflow.config.OpsProperties;
import dev.projectflow.ops.UsageCounters;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.Statement;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.h2.jdbcx.JdbcConnectionPool;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.Resource;
import org.springframework.core.io.support.PathMatchingResourcePatternResolver;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * The email budget keeps its last part for the emails people can't do without: sign-in alerts and
 * "already registered" notices stop at four fifths of the day's budget (nine tenths of the month's),
 * so confirmations, resets and security notices still go out on a busy day. Real EmailService,
 * AccountEmails and UsageCounters, with the counters on H2 and a local stand-in for Resend's API.
 */
class EmailBudgetTest {

    private final Clock clock = Clock.fixed(Instant.parse("2026-10-19T09:00:00Z"), ZoneOffset.UTC);
    private final List<String> delivered = new CopyOnWriteArrayList<>();
    private HttpServer resend;
    private JdbcConnectionPool pool;
    private AppProperties props;
    private AccountEmails emails;

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
    void setUp() throws Exception {
        pool = JdbcConnectionPool.create("jdbc:h2:mem:email-budget-" + System.nanoTime()
                + ";MODE=MySQL;DATABASE_TO_LOWER=TRUE;DEFAULT_NULL_ORDERING=HIGH;DB_CLOSE_DELAY=-1", "sa", "");
        Resource[] scripts = new PathMatchingResourcePatternResolver().getResources("classpath:db/migration/V*.sql");
        Arrays.sort(scripts, Comparator.comparingInt(EmailBudgetTest::version));
        try (Connection c = pool.getConnection(); Statement st = c.createStatement()) {
            for (Resource r : scripts) {
                for (String sql : statements(r.getContentAsString(StandardCharsets.UTF_8))) st.execute(sql);
            }
        }
        resend = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        resend.createContext("/emails", ex -> {
            String body = new String(ex.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
            Matcher m = Pattern.compile("\"subject\":\"([^\"]*)\"").matcher(body);
            delivered.add(m.find() ? m.group(1) : "?");
            byte[] ok = "{\"id\":\"x\"}".getBytes(StandardCharsets.UTF_8);
            ex.sendResponseHeaders(200, ok.length);
            ex.getResponseBody().write(ok);
            ex.close();
        });
        resend.start();
        String api = "http://127.0.0.1:" + resend.getAddress().getPort() + "/emails";
        props = new AppProperties("UTC", null, null, null, null, new AppProperties.Site("https://app.example.com", "Niveloft", null),
                new AppProperties.Email("resend", "re_test_key", "Niveloft <no-reply@example.com>", null, api, true), null, null, null);
        emails = new AccountEmails(props);
    }

    @AfterEach
    void tearDown() throws Exception {
        resend.stop(0);
        try (Connection c = pool.getConnection(); Statement st = c.createStatement()) {
            st.execute("SHUTDOWN");
        }
        pool.dispose();
    }

    private EmailService service(UsageCounters usage, int perDay, int perMonth) {
        return new EmailService(props, new ObjectMapper(), usage, new OpsProperties(null, new OpsProperties.Spending(null, null, perDay, perMonth)));
    }

    @Test
    void whichEmailsAreCourtesyNotices() {
        Instant now = Instant.now(clock);
        assertThat(emails.signIn("a@x.dev", "Asha", now, "Chrome on macOS", "203.0.113.9").courtesy()).isTrue();
        assertThat(emails.alreadyRegistered("a@x.dev", "Asha").courtesy()).isTrue();
        assertThat(emails.confirm("a@x.dev", "t", true).courtesy()).isFalse();
        assertThat(emails.reset("a@x.dev", "t").courtesy()).isFalse();
        assertThat(emails.passwordChanged("a@x.dev", "Asha", now).courtesy()).isFalse();
        assertThat(emails.accountDeleted("a@x.dev", "Asha", now).courtesy()).isFalse();
        assertThat(emails.contactReceived("ops@x.dev", "Bo", "bo@x.dev", "Question", "Hi", null, null).courtesy()).isFalse();
        assertThat(EmailService.reserve(100, 5)).isEqualTo(20);
        assertThat(EmailService.reserve(3000, 10)).isEqualTo(300);
        assertThat(EmailService.reserve(4, 5)).isEqualTo(1);
    }

    @Test
    void aBusyDayOfSignInsLeavesRoomForConfirmationsAndResets() {
        UsageCounters usage = new UsageCounters(new JdbcTemplate(pool), clock);
        EmailService day = service(usage, 10, 1000);
        for (int i = 0; i < 9; i++) day.deliver(emails.signIn("p" + i + "@x.dev", "P" + i, Instant.now(clock), "Firefox on Linux", "198.51.100." + i));
        assertThat(delivered).hasSize(8);
        assertThat(delivered.stream().allMatch(s -> s.startsWith("New sign-in"))).as("only alerts so far").isTrue();
        day.deliver(emails.alreadyRegistered("q@x.dev", "Q"));
        assertThat(delivered).hasSize(8);
        day.deliver(emails.confirm("new@x.dev", "token-1", true));
        day.deliver(emails.reset("old@x.dev", "token-2"));
        assertThat(delivered).hasSize(10);
        assertThat(delivered.get(8)).startsWith("Confirm your email");
        assertThat(delivered.get(9)).startsWith("Reset your");
        day.deliver(emails.confirm("later@x.dev", "token-3", true));
        assertThat(delivered).as("the cap itself still holds").hasSize(10);
        assertThat(usage.get("email.sent", usage.today())).isEqualTo(10);
    }

    @Test
    void theMonthKeepsItsLastTenth() {
        UsageCounters usage = new UsageCounters(new JdbcTemplate(pool), clock);
        usage.add("email.sent", usage.thisMonth(), 17);
        EmailService month = service(usage, 100, 20);
        month.deliver(emails.signIn("m@x.dev", "M", Instant.now(clock), "Edge on Windows", "192.0.2.1"));
        month.deliver(emails.signIn("n@x.dev", "N", Instant.now(clock), "Edge on Windows", "192.0.2.2"));
        month.deliver(emails.passwordChanged("n@x.dev", "N", Instant.now(clock)));
        assertThat(delivered).hasSize(2);
        assertThat(delivered.get(0)).startsWith("New sign-in");
        assertThat(delivered.get(1)).startsWith("Your Niveloft password was changed");
    }

    @Test
    void withoutCapsNothingIsHeldBack() {
        UsageCounters usage = new UsageCounters(new JdbcTemplate(pool), clock);
        EmailService open = service(usage, 0, 0);
        for (int i = 0; i < 3; i++) open.deliver(emails.signIn("o" + i + "@x.dev", "O", Instant.now(clock), "Safari on iOS", "192.0.2.9"));
        assertThat(delivered).hasSize(3);
    }
}
