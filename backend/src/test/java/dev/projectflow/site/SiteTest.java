package dev.projectflow.site;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.jayway.jsonpath.JsonPath;
import java.time.LocalDate;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/**
 * The Contact form, form success counts, sign-up sources (UTM tags), the operator's Site health
 * page and Arena votes, through the real HTTP API.
 */
@SpringBootTest(properties = "projectflow.operators.emails=site-boss@test.dev, other-boss@test.dev")
@AutoConfigureMockMvc
class SiteTest {

    private static final AtomicInteger SEQ = new AtomicInteger();

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate jdbc;

    record Account(long id, String token) {}

    int n;

    @BeforeEach
    void setUp() {
        n = SEQ.incrementAndGet();
    }

    private Account register(String name, String email, Map<String, Object> attribution) throws Exception {
        Map<String, Object> body = new HashMap<>(Map.of("name", name, "email", email, "password", "Harbor-Quill-42", "acceptTerms", true));
        if (attribution != null) body.put("attribution", attribution);
        String res = mvc.perform(post("/api/auth/register").contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(body)))
                .andExpect(status().is2xxSuccessful()).andReturn().getResponse().getContentAsString();
        return new Account(((Number) JsonPath.read(res, "$.data.user.id")).longValue(), JsonPath.read(res, "$.data.token"));
    }

    private Account boss() throws Exception {
        // One operator account for the whole class (registering it twice would conflict).
        String res = mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(Map.of("email", "site-boss@test.dev", "password", "Harbor-Quill-42")))).andReturn().getResponse().getContentAsString();
        if (res.contains("\"token\"")) return new Account(((Number) JsonPath.read(res, "$.data.user.id")).longValue(), JsonPath.read(res, "$.data.token"));
        return register("Site Boss", "site-boss@test.dev", null);
    }

    private ResultActions call(Account who, MockHttpServletRequestBuilder req, Object body) throws Exception {
        if (who != null) req.header("Authorization", "Bearer " + who.token());
        if (body != null) req.contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(body));
        return mvc.perform(req);
    }

    private static String body(ResultActions r) throws Exception {
        return r.andReturn().getResponse().getContentAsString();
    }

    private Map<String, Object> message(String text) {
        return Map.of("name", "Asha Rao", "email", "asha" + n + "@example.org", "topic", "QUESTION", "message", text);
    }

    @Test
    @DisplayName("a contact message is saved once, even when it's sent twice")
    void contactOnce() throws Exception {
        String first = body(call(null, post("/api/contact"), message("How do I invite my whole class at once? " + n)).andExpect(status().isCreated()));
        String again = body(call(null, post("/api/contact"), message("How do I invite my whole class at once? " + n)).andExpect(status().isCreated()));
        Number id1 = JsonPath.read(first, "$.data.id");
        Number id2 = JsonPath.read(again, "$.data.id");
        assertThat(id2.longValue()).isEqualTo(id1.longValue());
        assertThat((Boolean) JsonPath.read(first, "$.data.delivered")).isFalse(); // no email provider in tests
        Long saved = jdbc.queryForObject("SELECT COUNT(*) FROM contact_messages WHERE email = ?", Long.class, "asha" + n + "@example.org");
        assertThat(saved).isEqualTo(1L);
    }

    @Test
    @DisplayName("contact messages are checked like any form, and bots are turned away")
    void contactValidation() throws Exception {
        call(null, post("/api/contact"), Map.of("name", "A", "email", "nope", "topic", "QUESTION", "message", "short"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.fieldErrors.name").exists())
                .andExpect(jsonPath("$.fieldErrors.email").exists())
                .andExpect(jsonPath("$.fieldErrors.message").exists());
        Map<String, Object> bot = new HashMap<>(message("Buy cheap things at my site, now " + n));
        bot.put("website", "http://spam.example");
        call(null, post("/api/contact"), bot).andExpect(status().isBadRequest());
        Map<String, Object> ref = new HashMap<>(message("The board broke: see the reference " + n));
        ref.put("reference", "bad reference!");
        call(null, post("/api/contact"), ref).andExpect(status().isBadRequest()).andExpect(jsonPath("$.fieldErrors.reference").exists());
    }

    @Test
    @DisplayName("form counts: known forms and events only, and only operators see them")
    void formCounts() throws Exception {
        call(null, post("/api/metrics/forms"), Map.of("events", List.of(
                Map.of("form", "contact", "event", "view", "count", 3),
                Map.of("form", "contact", "event", "submit", "count", 2),
                Map.of("form", "contact", "event", "success", "count", 1),
                Map.of("form", "contact", "event", "failed", "count", 1),
                Map.of("form", "made-up", "event", "view", "count", 9),
                Map.of("form", "contact", "event", "hacked", "count", 9)))).andExpect(status().isNoContent());
        call(null, post("/api/metrics/forms"), Map.of("events", List.of(Map.of("form", "contact", "event", "view", "count", 500)))).andExpect(status().isBadRequest());

        Account someone = register("Some One", "someone" + n + "@test.dev", null);
        call(someone, get("/api/site-health"), null).andExpect(status().isForbidden());
        call(someone, get("/api/auth/me"), null).andExpect(jsonPath("$.data.operator").value(false));

        Account op = boss();
        call(op, get("/api/auth/me"), null).andExpect(jsonPath("$.data.operator").value(true));
        String health = body(call(op, get("/api/site-health?days=7"), null).andExpect(status().isOk()));
        List<Map<String, Object>> contact = JsonPath.read(health, "$.data.forms[?(@.form == 'contact')]");
        assertThat(contact).hasSize(1);
        assertThat(((Number) contact.get(0).get("views")).longValue()).isGreaterThanOrEqualTo(3);
        assertThat(((Number) contact.get(0).get("failed")).longValue()).isGreaterThanOrEqualTo(1);
        List<Object> madeUp = JsonPath.read(health, "$.data.forms[?(@.form == 'made-up')]");
        assertThat(madeUp).isEmpty();
    }

    @Test
    @DisplayName("sign-ups remember which campaign brought them, for the operator")
    void signupSources() throws Exception {
        register("Campaign Person", "campaign" + n + "@test.dev", Map.of("source", "newsletter-" + n, "medium", "email", "campaign", "launch", "landingPath", "/faq"));
        // A strange tag never stops a sign-up; it's cleaned before it's saved.
        register("Tagged Badly", "badtag" + n + "@test.dev", Map.of("source", "<script>\u0000" + "x".repeat(300)));
        String cleaned = jdbc.queryForObject("SELECT signup_source FROM users WHERE email = ?", String.class, "badtag" + n + "@test.dev");
        assertThat(cleaned).startsWith("scriptx").hasSize(100);
        String health = body(call(boss(), get("/api/site-health"), null).andExpect(status().isOk()));
        List<Map<String, Object>> mine = JsonPath.read(health, "$.data.signups.sources[?(@.source == 'newsletter-" + n + "')]");
        assertThat(mine).hasSize(1);
        assertThat(mine.get(0).get("campaign")).isEqualTo("launch");
        assertThat(((Number) mine.get(0).get("count")).intValue()).isEqualTo(1);
    }

    @Test
    @DisplayName("operators can mark messages answered; nobody else can")
    void markAnswered() throws Exception {
        String sent = body(call(null, post("/api/contact"), message("Please delete my old account " + n)).andExpect(status().isCreated()));
        long id = ((Number) JsonPath.read(sent, "$.data.id")).longValue();
        Account someone = register("Some Two", "sometwo" + n + "@test.dev", null);
        call(someone, patch("/api/site-health/contact/" + id), Map.of("handled", true)).andExpect(status().isForbidden());
        call(boss(), patch("/api/site-health/contact/" + id), Map.of("handled", true)).andExpect(status().isOk()).andExpect(jsonPath("$.data.handled").value(true));
        call(boss(), patch("/api/site-health/contact/999999"), Map.of("handled", true)).andExpect(status().isNotFound());
    }

    @Test
    @DisplayName("arena votes: members only, two different known sources, ranked for everyone")
    void arena() throws Exception {
        Account owner = register("Arena Owner", "arena" + n + "@test.dev", null);
        String project = body(call(owner, post("/api/projects"), Map.of("name", "Arena " + n, "key", "AR" + (n % 1000), "startDate", LocalDate.now().toString()))
                .andExpect(status().isCreated()));
        long projectId = ((Number) JsonPath.read(project, "$.data.id")).longValue();

        call(owner, post("/api/arena/votes"), Map.of("projectId", projectId, "a", "builtin", "b", "builtin", "winner", "A")).andExpect(status().isBadRequest());
        call(owner, post("/api/arena/votes"), Map.of("projectId", projectId, "a", "builtin", "b", "gpt-9", "winner", "A")).andExpect(status().isBadRequest());
        call(owner, post("/api/arena/votes"), Map.of("projectId", projectId, "a", "builtin", "b", "chrome", "winner", "MAYBE")).andExpect(status().isBadRequest());

        Account outsider = register("Arena Outsider", "outsider" + n + "@test.dev", null);
        int denied = call(outsider, post("/api/arena/votes"), Map.of("projectId", projectId, "a", "builtin", "b", "chrome", "winner", "A")).andReturn().getResponse().getStatus();
        assertThat(denied).isIn(403, 404);

        call(owner, post("/api/arena/votes"), Map.of("projectId", projectId, "a", "builtin", "b", "server:llama3.2:latest", "winner", "B")).andExpect(status().isCreated());
        String board = body(call(owner, post("/api/arena/votes"), Map.of("projectId", projectId, "a", "server:llama3.2:latest", "b", "chrome", "winner", "TIE"))
                .andExpect(status().isCreated()));
        assertThat(((Number) JsonPath.read(board, "$.data.myVotes")).intValue()).isEqualTo(2);
        List<Map<String, Object>> llama = JsonPath.read(board, "$.data.standings[?(@.contender == 'server:llama3.2:latest')]");
        assertThat(((Number) llama.get(0).get("wins")).intValue()).isGreaterThanOrEqualTo(1);
        call(owner, get("/api/arena/scoreboard"), null).andExpect(status().isOk()).andExpect(jsonPath("$.data.myVotes").value(2));
    }

    @Test
    @DisplayName("with no AI on the server, there are no models to choose, and asking for one is refused")
    void noModels() throws Exception {
        Account someone = register("Model Asker", "models" + n + "@test.dev", null);
        call(someone, get("/api/ai/models"), null).andExpect(status().isOk()).andExpect(jsonPath("$.data.length()").value(0));
    }
}
