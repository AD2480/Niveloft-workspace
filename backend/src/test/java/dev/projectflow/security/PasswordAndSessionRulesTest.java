// Ported from the plain-Java checks that ran in the sandbox for the launch release (the same
// assertions, now run by ./mvnw verify).
package dev.projectflow.security;

import com.sun.net.httpserver.HttpServer;
import dev.projectflow.config.LaunchProperties;
import java.net.InetSocketAddress;
import java.net.http.HttpClient;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.concurrent.atomic.AtomicReference;

/** Password rules (with a stand-in breach API) and session state rules. */
class PasswordAndSessionRulesTest {
    static final List<String> results = new ArrayList<>();

    static void check(String name, boolean ok) {
        results.add((ok ? "PASS  " : "FAIL  ") + name);
    }

    @org.junit.jupiter.api.Test
    void allRules() throws Exception {
        results.clear();
        Set<String> common = PasswordPolicy.load();
        check("the bundled list loads", common.size() > 200 && common.contains("password") && !common.contains("# passwords"));
        for (String weak : List.of("password123", "Password@123", "P@ssw0rd!", "qwerty123", "Welcome2025", "iloveyou1", "Letmein1!", "Admin12345",
                "Summer2025!", "Aaaaaaa1", "Niveloft2026", "Monkey_99", "1q2w3e4r", "Abcd1234")) {
            check("refused: " + weak, PasswordPolicy.problem(weak, "someone@example.com", "Some One", common) != null);
        }
        for (String fine : List.of("Harbor-Quill-42", "copper kettle 9 mountain lantern", "Tr0ub4dor&3x", "vT8#pL2qZm", "Newpass456", "Changed456",
                "password but very long passphrase 2026")) {
            check("accepted: " + fine, PasswordPolicy.problem(fine, "someone@example.com", "Some One", common) == null);
        }
        check("the email name is refused", PasswordPolicy.problem("ashar2024!", "ashar@example.com", "Asha Rao", common) != null);
        check("the person's name with digits is refused", PasswordPolicy.problem("Ramanujan1729", "x@example.com", "Srinivasa Ramanujan", common) != null);
        check("letter-for-number swaps are undone", PasswordPolicy.unleet("p@55w0rd").equals("password"));

        // Breach check against a stand-in for the range API.
        String sha = PasswordPolicy.sha1("correct horse battery staple");
        AtomicReference<String> asked = new AtomicReference<>();
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/range/", ex -> {
            asked.set(ex.getRequestURI().getPath() + " padding=" + ex.getRequestHeaders().getFirst("Add-Padding"));
            String body = "0018A45C4D1DEF81644B54AB7F969B88D65:1\r\n" + sha.substring(5) + ":3730471\r\nFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF:0\r\n";
            byte[] b = body.getBytes(StandardCharsets.US_ASCII);
            ex.sendResponseHeaders(200, b.length);
            ex.getResponseBody().write(b);
            ex.close();
        });
        server.start();
        String url = "http://127.0.0.1:" + server.getAddress().getPort() + "/range/";
        PasswordPolicy hibp = new PasswordPolicy(common, new LaunchProperties.Passwords("hibp", url), HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).build());
        check("a breached password is reported", hibp.breached("correct horse battery staple"));
        check("only the first 5 hex characters were sent, with padding asked for", asked.get().equals("/range/" + sha.substring(0, 5) + " padding=true"));
        check("an unlisted password isn't", !hibp.breached("a-password-nobody-has-used-7f3k"));
        server.stop(0);
        PasswordPolicy down = new PasswordPolicy(common, new LaunchProperties.Passwords("hibp", url), HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(1)).build());
        check("an unreachable breach service doesn't block (the check is skipped)", !down.breached("correct horse battery staple"));
        check("breach checking is off by default", !LaunchProperties.defaults().passwordsOrDefault().hibp());

        // Session rules.
        Instant now = Instant.parse("2026-10-14T12:00:00Z");
        Duration idle = Duration.ofHours(12);
        SessionStore.Session fresh = session(false, now.minusSeconds(3600), now.minusSeconds(60), now.plusSeconds(3600 * 20), null);
        check("a recent session is active", SessionStore.state(fresh, now, idle) == SessionStore.State.ACTIVE);
        check("a revoked one isn't", SessionStore.state(session(false, now.minusSeconds(3600), now, now.plusSeconds(99999), now), now, idle) == SessionStore.State.REVOKED);
        check("past its limit it has expired", SessionStore.state(session(true, now.minusSeconds(99999), now, now, null), now, idle) == SessionStore.State.EXPIRED);
        check("12 hours unused ends a normal session", SessionStore.state(session(false, now.minusSeconds(50000), now.minus(idle), now.plusSeconds(9999), null), now, idle)
                == SessionStore.State.IDLE);
        check("…but not a kept-signed-in one", SessionStore.state(session(true, now.minusSeconds(50000), now.minus(idle), now.plusSeconds(9999), null), now, idle)
                == SessionStore.State.ACTIVE);
        check("networks are coarse", "203.0.113.0/24".equals(SessionStore.network("203.0.113.77")) && "2001:db8:abcd::/48".equals(SessionStore.network("2001:db8:abcd:12::1"))
                && SessionStore.network("") == null);
        LaunchProperties.Sessions p = LaunchProperties.defaults().sessionsOrDefault();
        check("defaults: 12 h idle, 24 h at most, 14 days when kept", p.idle().toHours() == 12 && p.max().toHours() == 24 && p.remember().toDays() == 14 && p.rememberAllowed());
        LaunchProperties.Sessions off = new LaunchProperties.Sessions(2, 1, 0, null, null);
        check("SESSION_REMEMBER_DAYS=0 turns keeping off; the limit is never shorter than idle", !off.rememberAllowed() && off.max().toHours() == 2);
        org.assertj.core.api.Assertions.assertThat(results.stream().filter(r -> r.startsWith("FAIL")).toList()).as("failed checks").isEmpty();
    }

    static SessionStore.Session session(boolean remember, Instant created, Instant lastSeen, Instant expires, Instant revoked) {
        return new SessionStore.Session(1, "0".repeat(32), 7, remember, created, lastSeen, expires, revoked, null, "Firefox on Linux", null);
    }
}
