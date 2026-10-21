package dev.projectflow.launch;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.jayway.jsonpath.JsonPath;
import dev.projectflow.ops.UsageCounters;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.io.Decoders;
import io.jsonwebtoken.security.Keys;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/**
 * The production launch controls, end to end against the real API: server-side sessions (sign out,
 * sign out everywhere, other devices, token claims), the password rules, ownership transfer and
 * account deletion, invitation expiry and rechecks, the audit log, the operator's switches and
 * suspension, upload checks, evidence removed with its task, and atomic spending counters.
 */
@SpringBootTest(properties = {
        "projectflow.operators.emails=boss@launch.test",
        "projectflow.accounts.require-email-verification=false",
})
@AutoConfigureMockMvc
class LaunchControlsTest {

    private static final String PASSWORD = "Harbor-Quill-42";
    private static final AtomicInteger SEQ = new AtomicInteger();

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate jdbc;
    @Autowired UsageCounters counters;

    record Account(long id, String email, String token) {}

    private Account register(String name, String email) throws Exception {
        String body = mvc.perform(post("/api/auth/register").contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(Map.of("name", name, "email", email, "password", PASSWORD, "acceptTerms", true))))
                .andExpect(status().is2xxSuccessful()).andReturn().getResponse().getContentAsString();
        return new Account(((Number) JsonPath.read(body, "$.data.user.id")).longValue(), email, JsonPath.read(body, "$.data.token"));
    }

    /** A sign-in that isn't kept, with a given password. */
    private String login2(String email, String password) throws Exception {
        String body = mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(Map.of("email", email, "password", password, "remember", false))))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        return JsonPath.read(body, "$.data.token");
    }

    private String login(String email, boolean remember) throws Exception {
        String body = mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(Map.of("email", email, "password", PASSWORD, "remember", remember))))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        return JsonPath.read(body, "$.data.token");
    }

    private ResultActions call(String token, MockHttpServletRequestBuilder req, Object body) throws Exception {
        if (token != null) req.header("Authorization", "Bearer " + token);
        if (body != null) req.contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(body));
        return mvc.perform(req);
    }

    private static String text(ResultActions r) throws Exception {
        return r.andReturn().getResponse().getContentAsString();
    }

    private String handle() {
        return "u" + SEQ.incrementAndGet() + "x" + System.nanoTime() % 100000;
    }

    private long project(Account owner) throws Exception {
        int n = SEQ.incrementAndGet();
        String res = text(call(owner.token(), post("/api/projects"), Map.of("name", "Launch test " + n, "key", "LT" + (n % 1000),
                "startDate", LocalDate.now().toString())).andExpect(status().isCreated()));
        return ((Number) JsonPath.read(res, "$.data.id")).longValue();
    }

    private long invite(Account by, long projectId, String email, String role) throws Exception {
        String res = text(call(by.token(), post("/api/projects/" + projectId + "/invitations"), Map.of("email", email, "role", role))
                .andExpect(status().isCreated()));
        return ((Number) JsonPath.read(res, "$.data.id")).longValue();
    }

    private void join(Account owner, Account who, long projectId, String role) throws Exception {
        long id = invite(owner, projectId, who.email(), role);
        call(who.token(), post("/api/invitations/" + id + "/accept"), null).andExpect(status().isOk());
    }

    private long memberId(Account who, long projectId, long userId) throws Exception {
        String res = text(call(who.token(), get("/api/projects/" + projectId + "/members"), null).andExpect(status().isOk()));
        List<Number> ids = JsonPath.read(res, "$.data[?(@.user.id == " + userId + ")].id");
        return ids.get(0).longValue();
    }

    // ------------------------------------------------------------------ sessions

    @Test
    @DisplayName("Sessions: listed with the current one marked; ending one, signing out and signing out everywhere stop those tokens at once")
    void sessions() throws Exception {
        String email = handle() + "@launch.test";
        Account a = register("Sana Sessions", email);
        String phone = login(email, true);
        String laptop = login(email, false);

        String list = text(call(laptop, get("/api/auth/sessions"), null).andExpect(status().isOk()));
        List<Object> all = JsonPath.read(list, "$.data[*]");
        assertThat(all).hasSize(3);
        List<Boolean> current = JsonPath.read(list, "$.data[?(@.current == true)].current");
        assertThat(current).hasSize(1);
        List<Boolean> remembered = JsonPath.read(list, "$.data[?(@.remember == true)].remember");
        assertThat(remembered).hasSize(1);

        // End the phone's session from the laptop: the phone's token stops working, with a reason.
        String phoneSession = text(call(phone, get("/api/auth/sessions"), null));
        long phoneId = ((Number) JsonPath.<List<Number>>read(phoneSession, "$.data[?(@.current == true)].id").get(0)).longValue();
        call(laptop, delete("/api/auth/sessions/" + phoneId), null).andExpect(status().isOk());
        call(phone, get("/api/auth/me"), null).andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("signed out")));
        call(laptop, delete("/api/auth/sessions/" + phoneId), null).andExpect(status().isNotFound());

        // Signing out ends this session on the server, not just in the browser.
        call(laptop, post("/api/auth/logout"), null).andExpect(status().isOk());
        call(laptop, get("/api/auth/me"), null).andExpect(status().isUnauthorized());

        // Everywhere: the first token (from registration) stops too.
        String another = login(email, false);
        call(a.token(), get("/api/auth/me"), null).andExpect(status().isOk());
        call(another, post("/api/auth/logout-everywhere"), null).andExpect(status().isOk());
        call(a.token(), get("/api/auth/me"), null).andExpect(status().isUnauthorized());
        call(another, get("/api/auth/me"), null).andExpect(status().isUnauthorized());
    }

    /** The value a Set-Cookie header gives the "keep me signed in" cookie ("" when it removes it). */
    private static String cookieValue(String setCookie) {
        assertThat(setCookie).isNotNull();
        return setCookie.substring(setCookie.indexOf('=') + 1, setCookie.indexOf(';'));
    }

    private ResultActions renew(String cookie, String origin) throws Exception {
        MockHttpServletRequestBuilder req = post("/api/auth/refresh");
        if (cookie != null) req.cookie(new jakarta.servlet.http.Cookie("niveloft-session", cookie));
        if (origin != null) req.header("Origin", origin);
        return mvc.perform(req);
    }

    private static final String APP = "http://localhost:5174";

    @Test
    @DisplayName("Keep me signed in: an HttpOnly cookie, never in a response body, renews only its own session, only for the app, until it ends")
    void keptSignIns() throws Exception {
        String email = handle() + "@launch.test";
        register("Kim Kept", email);
        var kept = mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(Map.of("email", email, "password", PASSWORD, "remember", true))))
                .andExpect(status().isOk()).andReturn().getResponse();
        String setCookie = kept.getHeader("Set-Cookie");
        assertThat(setCookie).startsWith("niveloft-session=").contains("; Path=/api/auth").contains("; HttpOnly").contains("; SameSite=Lax")
                .doesNotContain("Secure").doesNotContain("Partitioned");
        String cookie = cookieValue(setCookie);
        assertThat(cookie).matches("[0-9a-f]{32}\\.[A-Za-z0-9_-]{43}");
        assertThat(kept.getContentAsString()).doesNotContain(cookie.substring(33));
        String token = JsonPath.read(kept.getContentAsString(), "$.data.token");
        assertThat(((Number) JsonPath.read(kept.getContentAsString(), "$.data.expiresIn")).longValue()).isLessThanOrEqualTo(3600); // the token's own cap
        String stored = jdbc.queryForObject("SELECT cookie_hash FROM user_sessions WHERE public_id = ?", String.class, cookie.substring(0, 32));
        assertThat(stored).hasSize(64).doesNotContain(cookie.substring(33));

        // The app gets a new token for the same session (a tab opened later, or an expired token).
        String body = renew(cookie, APP).andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        String fresh = JsonPath.read(body, "$.data.token");
        assertThat(body).doesNotContain(cookie.substring(33));
        call(fresh, get("/api/auth/me"), null).andExpect(status().isOk());
        String current = JsonPath.read(text(call(fresh, get("/api/auth/sessions"), null)), "$.data[?(@.current == true)].id").toString();
        assertThat(current).isEqualTo(JsonPath.read(text(call(token, get("/api/auth/sessions"), null)), "$.data[?(@.current == true)].id").toString());

        // Another site's page can't ask; no cookie, or a wrong secret, gets nothing (and a bad cookie is removed).
        renew(cookie, "https://evil.example").andExpect(status().isForbidden());
        renew(cookie, null).andExpect(status().isForbidden());
        renew(null, APP).andExpect(status().isUnauthorized());
        String wrong = cookie.substring(0, 33) + "A".repeat(43);
        assertThat(renew(wrong, APP).andExpect(status().isUnauthorized()).andReturn().getResponse().getHeader("Set-Cookie")).contains("Max-Age=0");

        // A sign-in that isn't kept removes the cookie from that browser.
        var plain = mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(Map.of("email", email, "password", PASSWORD, "remember", false)))).andExpect(status().isOk()).andReturn().getResponse();
        assertThat(plain.getHeader("Set-Cookie")).contains("Max-Age=0");
        assertThat(cookieValue(plain.getHeader("Set-Cookie"))).isEmpty();

        // A password change ends the session, so its cookie; this device gets a cookie for its new session.
        var changed = call(fresh, put("/api/users/me/password"), Map.of("currentPassword", PASSWORD, "newPassword", "Lantern-Copper-77"))
                .andExpect(status().isOk()).andReturn().getResponse();
        String newCookie = cookieValue(changed.getHeader("Set-Cookie"));
        assertThat(newCookie).isNotEqualTo(cookie).matches("[0-9a-f]{32}\\.[A-Za-z0-9_-]{43}");
        renew(cookie, APP).andExpect(status().isUnauthorized());
        String afterChange = JsonPath.read(text(renew(newCookie, APP).andExpect(status().isOk())), "$.data.token");

        // Signing out ends the session and removes the cookie; the cookie then gets nothing.
        var out = call(afterChange, post("/api/auth/logout"), null).andExpect(status().isOk()).andReturn().getResponse();
        assertThat(out.getHeader("Set-Cookie")).contains("Max-Age=0");
        renew(newCookie, APP).andExpect(status().isUnauthorized());

        // Over HTTPS (behind the host's proxy): __Secure-, Secure, SameSite=None and Partitioned, for an API on another site.
        var secure = mvc.perform(post("/api/auth/login").header("X-Forwarded-Proto", "https").contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(Map.of("email", email, "password", "Lantern-Copper-77", "remember", true))))
                .andExpect(status().isOk()).andReturn().getResponse();
        assertThat(secure.getHeader("Set-Cookie")).startsWith("__Secure-niveloft-session=").contains("; Secure").contains("; HttpOnly")
                .contains("; SameSite=None").contains("; Partitioned").contains("; Path=/api/auth");
        String secureCookie = cookieValue(secure.getHeader("Set-Cookie"));
        mvc.perform(post("/api/auth/refresh").header("X-Forwarded-Proto", "https").header("Origin", APP)
                .cookie(new jakarta.servlet.http.Cookie("__Secure-niveloft-session", secureCookie))).andExpect(status().isOk());

        // Signing out in a tab that isn't the kept one signs the browser out: its kept sign-in ends too.
        var keptAgain = mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(Map.of("email", email, "password", "Lantern-Copper-77", "remember", true))))
                .andExpect(status().isOk()).andReturn().getResponse();
        String browserCookie = cookieValue(keptAgain.getHeader("Set-Cookie"));
        String otherTab = login2(email, "Lantern-Copper-77");
        mvc.perform(post("/api/auth/logout").header("Authorization", "Bearer " + otherTab)
                .cookie(new jakarta.servlet.http.Cookie("niveloft-session", browserCookie))).andExpect(status().isOk());
        renew(browserCookie, APP).andExpect(status().isUnauthorized());
        call(otherTab, get("/api/auth/me"), null).andExpect(status().isUnauthorized());

        // A tab whose token no longer works signs out with the cookie alone, but only from the app.
        var keptThird = mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(Map.of("email", email, "password", "Lantern-Copper-77", "remember", true))))
                .andExpect(status().isOk()).andReturn().getResponse();
        String onlyCookie = cookieValue(keptThird.getHeader("Set-Cookie"));
        mvc.perform(post("/api/auth/logout").header("Origin", "https://evil.example")
                .cookie(new jakarta.servlet.http.Cookie("niveloft-session", onlyCookie))).andExpect(status().isUnauthorized());
        renew(onlyCookie, APP).andExpect(status().isOk());
        mvc.perform(post("/api/auth/logout").header("Origin", APP)
                .cookie(new jakarta.servlet.http.Cookie("niveloft-session", onlyCookie))).andExpect(status().isOk());
        renew(onlyCookie, APP).andExpect(status().isUnauthorized());
        mvc.perform(post("/api/auth/logout")).andExpect(status().isUnauthorized());

        // Signing out everywhere ends kept sign-ins too.
        String last = JsonPath.read(text(renew(secureCookie, APP).andExpect(status().isOk())), "$.data.token");
        call(last, post("/api/auth/logout-everywhere"), null).andExpect(status().isOk());
        renew(secureCookie, APP).andExpect(status().isUnauthorized());
    }

    @Test
    @DisplayName("Tokens: one without a session, for another audience, or signed with an unknown key is refused")
    void tokenClaims() throws Exception {
        String email = handle() + "@launch.test";
        Account a = register("Tia Tokens", email);
        var key = Keys.hmacShaKeyFor(Decoders.BASE64.decode("dGVzdC1vbmx5LXByb2plY3RmbG93LXNlY3JldC1rZXktZm9yLXVuaXQtdGVzdHMtMTIzNDU2Nzg5MA=="));
        Date later = Date.from(Instant.now().plusSeconds(600));
        String noSession = Jwts.builder().issuer("niveloft").audience().add("niveloft-api").and().subject(String.valueOf(a.id()))
                .claim("email", email).expiration(later).signWith(key).compact();
        String wrongAudience = Jwts.builder().issuer("niveloft").audience().add("someone-else").and().subject(String.valueOf(a.id()))
                .claim("email", email).claim("sid", "0".repeat(32)).expiration(later).signWith(key).compact();
        var otherKey = Keys.hmacShaKeyFor(Base64.getDecoder().decode("b3RoZXIta2V5LW90aGVyLWtleS1vdGhlci1rZXktb3RoZXIta2V5LTEyMzQ1Ng=="));
        String sid = JsonPath.read(text(call(a.token(), get("/api/auth/sessions"), null)), "$.data[0].id").toString();
        String forged = Jwts.builder().issuer("niveloft").audience().add("niveloft-api").and().subject(String.valueOf(a.id()))
                .claim("email", email).claim("sid", sid).expiration(later).signWith(otherKey).compact();
        for (String t : List.of(noSession, wrongAudience, forged, "not-a-token")) {
            call(t, get("/api/auth/me"), null).andExpect(status().isUnauthorized());
        }
        call(a.token(), get("/api/auth/me"), null).andExpect(status().isOk());
    }

    // ------------------------------------------------------------------ passwords and sign-up

    @Test
    @DisplayName("Passwords: common ones, the email name and look-alikes are refused; a passphrase is fine")
    void passwordRules() throws Exception {
        for (String weak : List.of("Password123", "P@ssw0rd2024!", "qwerty123", "Welcome2025")) {
            call(null, post("/api/auth/register"), Map.of("name", "Weak Pass", "email", handle() + "@launch.test", "password", weak, "acceptTerms", true))
                    .andExpect(status().isBadRequest()).andExpect(jsonPath("$.fieldErrors.password").exists());
        }
        String h = handle();
        call(null, post("/api/auth/register"), Map.of("name", "Self Named", "email", h + "@launch.test", "password", h + "2024!", "acceptTerms", true))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.fieldErrors.password").exists());
        call(null, post("/api/auth/register"), Map.of("name", "Long Phrase", "email", handle() + "@launch.test", "password", "copper kettle 9 mountain lantern", "acceptTerms", true))
                .andExpect(status().isCreated());
    }

    // ------------------------------------------------------------------ ownership and deletion

    @Test
    @DisplayName("Account deletion: blocked while owning a shared project; after a transfer it removes the person but keeps the team's history")
    void deleteAccount() throws Exception {
        Account owner = register("Omar Owner", handle() + "@launch.test");
        Account mate = register("Mia Mate", handle() + "@launch.test");
        long projectId = project(owner);
        join(owner, mate, projectId, "MEMBER");
        String task = text(call(owner.token(), post("/api/projects/" + projectId + "/tasks"), Map.of("title", "Write the launch notes", "priority", "HIGH"))
                .andExpect(status().isCreated()));
        long taskId = ((Number) JsonPath.read(task, "$.data.id")).longValue();
        call(owner.token(), post("/api/tasks/" + taskId + "/comments"), Map.of("body", "Draft is in the shared folder.")).andExpect(status().isCreated());
        long solo = project(owner); // owned alone: goes with the account

        String check = text(call(owner.token(), get("/api/users/me/deletion-check"), null).andExpect(status().isOk()));
        assertThat((Boolean) JsonPath.read(check, "$.data.canDelete")).isFalse();
        call(owner.token(), post("/api/users/me/delete"), Map.of("password", PASSWORD, "confirm", "DELETE")).andExpect(status().isConflict());
        call(owner.token(), post("/api/users/me/delete"), Map.of("password", "wrong-password-1", "confirm", "DELETE")).andExpect(status().isBadRequest());

        // Only the owner can transfer, and only to a member.
        long mateMember = memberId(owner, projectId, mate.id());
        call(mate.token(), post("/api/projects/" + projectId + "/transfer-ownership"), Map.of("memberId", mateMember)).andExpect(status().isForbidden());
        call(owner.token(), post("/api/projects/" + projectId + "/transfer-ownership"), Map.of("memberId", mateMember))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.role").value("OWNER"));
        String members = text(call(mate.token(), get("/api/projects/" + projectId + "/members"), null));
        List<String> ownerRoles = JsonPath.read(members, "$.data[?(@.user.id == " + owner.id() + ")].role");
        assertThat(ownerRoles).containsExactly("MANAGER");

        // A document and a rating of Flurry's answer, which are mine too.
        call(owner.token(), post("/api/projects/" + projectId + "/documents"), Map.of("title", "Launch decisions", "body", "# Decisions\n\nNotes go out on Friday."))
                .andExpect(status().isOk());
        call(owner.token(), post("/api/projects/" + projectId + "/ai/feedback"),
                Map.of("verdict", "wrong", "categories", List.of("missed-record"), "question", "When do the notes go out?", "answer", "Nothing is recorded."))
                .andExpect(status().isNoContent());

        // A copy of my data first.
        String export = text(call(owner.token(), get("/api/users/me/export"), null).andExpect(status().isOk()));
        assertThat((String) JsonPath.read(export, "$.profile.email")).isEqualTo(owner.email());
        assertThat((List<?>) JsonPath.read(export, "$.comments")).hasSize(1);
        assertThat((List<String>) JsonPath.read(export, "$.documentsIWrote[*].title")).containsExactly("Launch decisions");
        assertThat((List<String>) JsonPath.read(export, "$.answersIRated[*].verdict")).containsExactly("wrong");

        call(owner.token(), post("/api/users/me/delete"), Map.of("password", PASSWORD, "confirm", "DELETE")).andExpect(status().isOk());
        call(owner.token(), get("/api/auth/me"), null).andExpect(status().isUnauthorized());
        call(null, post("/api/auth/login"), Map.of("email", owner.email(), "password", PASSWORD)).andExpect(status().isUnauthorized());
        // The solo project is gone; the shared one keeps the comment, by "Deleted user".
        call(mate.token(), get("/api/projects/" + solo), null).andExpect(status().isNotFound());
        String comments = text(call(mate.token(), get("/api/tasks/" + taskId + "/comments"), null).andExpect(status().isOk()));
        assertThat(comments).contains("Draft is in the shared folder.").contains("Deleted user").doesNotContain(owner.email());
        Integer left = jdbc.queryForObject("SELECT COUNT(*) FROM users WHERE email = ?", Integer.class, owner.email());
        assertThat(left).isZero();
        // The rating stays with the project, no longer linked to the account.
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM ai_feedback WHERE project_id = ?", Integer.class, projectId)).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM ai_feedback WHERE user_id = ?", Integer.class, owner.id())).isZero();
        // The same address can sign up again, as a new person.
        register("Omar Again", owner.email());
    }

    // ------------------------------------------------------------------ invitations

    @Test
    @DisplayName("Invitations expire, can't re-add a removed member, and are only as good as their sender's rights at acceptance")
    void invitations() throws Exception {
        Account owner = register("Ola Owner", handle() + "@launch.test");
        Account manager = register("Max Manager", handle() + "@launch.test");
        Account late = register("Lee Late", handle() + "@launch.test");
        Account removed = register("Rui Removed", handle() + "@launch.test");
        Account third = register("Tom Third", handle() + "@launch.test");
        long projectId = project(owner);
        join(owner, manager, projectId, "MANAGER");

        long expired = invite(owner, projectId, late.email(), "MEMBER");
        jdbc.update("UPDATE invitations SET expires_at = ? WHERE id = ?", Timestamp.from(Instant.now().minusSeconds(60)), expired);
        call(late.token(), post("/api/invitations/" + expired + "/accept"), null).andExpect(status().isConflict());
        assertThat(text(call(late.token(), get("/api/invitations/mine"), null))).doesNotContain("\"id\":" + expired + ",");
        invite(owner, projectId, late.email(), "MEMBER"); // an expired invitation doesn't block a new one

        // The link that added someone can't add them back after they're removed.
        long used = invite(owner, projectId, removed.email().toUpperCase(), "MEMBER");
        call(removed.token(), post("/api/invitations/" + used + "/accept"), null).andExpect(status().isOk());
        call(owner.token(), delete("/api/projects/" + projectId + "/members/" + memberId(owner, projectId, removed.id())), null).andExpect(status().is2xxSuccessful());
        call(removed.token(), post("/api/invitations/" + used + "/accept"), null).andExpect(status().isConflict());
        call(removed.token(), get("/api/projects/" + projectId), null).andExpect(status().isForbidden());

        long fromManager = invite(manager, projectId, third.email(), "MEMBER");
        call(owner.token(), put("/api/projects/" + projectId + "/members/" + memberId(owner, projectId, manager.id())), Map.of("role", "MEMBER"))
                .andExpect(status().isOk());
        call(third.token(), post("/api/invitations/" + fromManager + "/accept"), null).andExpect(status().isConflict());
        call(third.token(), get("/api/projects/" + projectId), null).andExpect(status().isForbidden());
        // Making someone owner goes through the transfer, not a role change.
        call(owner.token(), put("/api/projects/" + projectId + "/members/" + memberId(owner, projectId, manager.id())), Map.of("role", "OWNER"))
                .andExpect(status().isForbidden());

        // The audit log saw it, for owners and managers only.
        String audit = text(call(owner.token(), get("/api/projects/" + projectId + "/audit"), null).andExpect(status().isOk()));
        List<String> actions = JsonPath.read(audit, "$.data[*].action");
        assertThat(actions).contains("project.invitation_sent", "project.member_removed", "project.role_changed", "project.invitation_accepted");
        List<String> outcomes = JsonPath.read(audit, "$.data[?(@.action == 'project.invitation_accepted')].outcome");
        assertThat(outcomes).contains("denied");
        call(late.token(), get("/api/projects/" + projectId + "/audit"), null).andExpect(status().isForbidden());
    }

    // ------------------------------------------------------------------ operators

    @Test
    @DisplayName("Operators: switches turn one feature off and back on; suspension signs out and blocks sign-in; others get 403")
    void operatorControls() throws Exception {
        Account boss = register("Bo Boss", "boss@launch.test");
        Account user = register("Uma User", handle() + "@launch.test");
        call(user.token(), get("/api/ops/switches"), null).andExpect(status().isForbidden());
        call(user.token(), put("/api/ops/switches/uploads"), Map.of("enabled", false)).andExpect(status().isForbidden());

        call(boss.token(), put("/api/ops/switches/invitations"), Map.of("enabled", false, "reason", "invitation flood")).andExpect(status().isOk());
        long projectId = project(user);
        call(user.token(), post("/api/projects/" + projectId + "/invitations"), Map.of("email", handle() + "@launch.test", "role", "MEMBER"))
                .andExpect(status().isServiceUnavailable());
        call(user.token(), get("/api/projects/" + projectId), null).andExpect(status().isOk()); // the rest still works
        call(boss.token(), put("/api/ops/switches/invitations"), Map.of("enabled", true)).andExpect(status().isOk());
        call(user.token(), post("/api/projects/" + projectId + "/invitations"), Map.of("email", handle() + "@launch.test", "role", "MEMBER"))
                .andExpect(status().isCreated());
        call(boss.token(), put("/api/ops/switches/nonsense"), Map.of("enabled", false)).andExpect(status().isNotFound());

        call(boss.token(), post("/api/ops/accounts/suspend"), Map.of("email", user.email(), "reason", "abuse report 12")).andExpect(status().isOk());
        call(user.token(), get("/api/auth/me"), null).andExpect(status().isUnauthorized());
        call(null, post("/api/auth/login"), Map.of("email", user.email(), "password", PASSWORD))
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("ACCOUNT_SUSPENDED"));
        call(boss.token(), post("/api/ops/accounts/unsuspend"), Map.of("email", user.email())).andExpect(status().isOk());
        login(user.email(), false);

        String audit = text(call(boss.token(), get("/api/ops/audit?action=ops."), null).andExpect(status().isOk()));
        List<String> actions = JsonPath.read(audit, "$.data[*].action");
        assertThat(actions).contains("ops.switch", "ops.account_suspended", "ops.account_unsuspended");
    }

    // ------------------------------------------------------------------ uploads

    @Test
    @DisplayName("Uploads: only allowed types whose contents match; evidence files go with their task")
    void uploads() throws Exception {
        Account owner = register("Ula Upload", handle() + "@launch.test");
        long projectId = project(owner);
        String task = text(call(owner.token(), post("/api/projects/" + projectId + "/tasks"),
                Map.of("title", "Ship the page", "priority", "HIGH", "assigneeId", owner.id())).andExpect(status().isCreated()));
        long taskId = ((Number) JsonPath.read(task, "$.data.id")).longValue();

        byte[] png = Base64.getDecoder().decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==");
        byte[] html = "<html><script>alert(1)</script></html>".getBytes();
        assertThat(upload(owner, taskId, new MockMultipartFile("files", "page.html", "text/html", html)).andReturn().getResponse().getStatus()).isEqualTo(400);
        assertThat(upload(owner, taskId, new MockMultipartFile("files", "fake.png", "image/png", html)).andReturn().getResponse().getStatus()).isEqualTo(400);
        assertThat(upload(owner, taskId, new MockMultipartFile("files", "tool.exe", "application/octet-stream", new byte[] {'M', 'Z', 0, 0})).andReturn().getResponse().getStatus())
                .isEqualTo(400);
        // A real image declared as HTML is stored (and served) by what it is.
        String res = text(upload(owner, taskId, new MockMultipartFile("files", "shot.png", "text/html", png)).andExpect(status().isCreated()));
        long fileId = ((Number) JsonPath.read(res, "$.data.evidence[0].file.id")).longValue();
        call(owner.token(), get("/api/files/" + fileId), null).andExpect(status().isOk())
                .andExpect(r -> assertThat(r.getResponse().getContentType()).startsWith("image/png"));

        Integer before = jdbc.queryForObject("SELECT COUNT(*) FROM stored_files WHERE id = ?", Integer.class, fileId);
        assertThat(before).isOne();
        call(owner.token(), delete("/api/tasks/" + taskId), null).andExpect(status().is2xxSuccessful());
        Integer after = jdbc.queryForObject("SELECT COUNT(*) FROM stored_files WHERE id = ?", Integer.class, fileId);
        assertThat(after).isZero();
    }

    private ResultActions upload(Account who, long taskId, MockMultipartFile file) throws Exception {
        MockMultipartFile data = new MockMultipartFile("data", "", MediaType.APPLICATION_JSON_VALUE,
                json.writeValueAsBytes(Map.of("notes", "Evidence attached.", "evidence", List.of())));
        return mvc.perform(multipart("/api/tasks/" + taskId + "/submissions").file(data).file(file).header("Authorization", "Bearer " + who.token()));
    }

    // ------------------------------------------------------------------ spending

    @Test
    @DisplayName("Spending counters: 40 concurrent reservations against a cap of 25 take exactly 25")
    void atomicReservations() throws Exception {
        String counter = "test." + SEQ.incrementAndGet();
        ExecutorService pool = Executors.newFixedThreadPool(8);
        try {
            List<Callable<Boolean>> jobs = new ArrayList<>();
            for (int i = 0; i < 40; i++) jobs.add(() -> counters.tryAdd(counter, "2026-10-14", 1, 25));
            int granted = 0;
            for (Future<Boolean> f : pool.invokeAll(jobs)) if (f.get()) granted++;
            assertThat(granted).isEqualTo(25);
            assertThat(counters.get(counter, "2026-10-14")).isEqualTo(25);
            assertThat(counters.tryAdd(counter, "2026-10-14", 1, 25)).isFalse();
            assertThat(counters.tryAdd(counter, "2026-10-14", 1, 0)).isTrue(); // 0: no cap
        } finally {
            pool.shutdownNow();
        }
    }
}
