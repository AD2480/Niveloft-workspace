package dev.projectflow.ops;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.jayway.jsonpath.JsonPath;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/**
 * Operations under real conditions: several people at once, retries, oversized requests and
 * request ids. Each test builds its own users and project.
 */
@SpringBootTest
@AutoConfigureMockMvc
class OperationsTest {

    private static final AtomicInteger SEQ = new AtomicInteger();

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired UsageCounters usage;

    record Account(long id, String token) {}

    Account owner;
    long projectId;
    int n;

    @BeforeEach
    void setUp() throws Exception {
        n = SEQ.incrementAndGet();
        owner = register("Olga Ops", "ops" + n);
        String project = body(call(owner, post("/api/projects"), Map.of("name", "Ops " + n, "key", "OP" + (n % 1000), "startDate", LocalDate.now().toString()))
                .andExpect(status().isCreated()));
        projectId = ((Number) JsonPath.read(project, "$.data.id")).longValue();
    }

    private Account register(String name, String handle) throws Exception {
        String res = mvc.perform(post("/api/auth/register").contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(Map.of("name", name, "email", handle + "@test.dev", "password", "Harbor-Quill-42", "acceptTerms", true))))
                .andExpect(status().is2xxSuccessful()).andReturn().getResponse().getContentAsString();
        return new Account(((Number) JsonPath.read(res, "$.data.user.id")).longValue(), JsonPath.read(res, "$.data.token"));
    }

    private ResultActions call(Account who, MockHttpServletRequestBuilder req, Object body) throws Exception {
        if (who != null) req.header("Authorization", "Bearer " + who.token());
        if (body != null) req.contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(body));
        return mvc.perform(req);
    }

    private static String body(ResultActions r) throws Exception {
        return r.andReturn().getResponse().getContentAsString();
    }

    private long task(Map<String, Object> fields) throws Exception {
        String res = body(call(owner, post("/api/projects/" + projectId + "/tasks"), fields).andExpect(status().isCreated()));
        return ((Number) JsonPath.read(res, "$.data.id")).longValue();
    }

    @Test
    @DisplayName("A retried create with the same Idempotency-Key is done once and gets the same answer")
    void idempotentCreate() throws Exception {
        String key = "test-create-" + n;
        Map<String, Object> req = Map.of("title", "Only once", "priority", "MEDIUM");
        String first = body(call(owner, post("/api/projects/" + projectId + "/tasks").header("Idempotency-Key", key), req).andExpect(status().isCreated()));
        String again = body(call(owner, post("/api/projects/" + projectId + "/tasks").header("Idempotency-Key", key), req)
                .andExpect(status().isCreated()).andExpect(header().string("Idempotent-Replayed", "true")));
        assertThat(again).isEqualTo(first);
        String list = body(call(owner, get("/api/projects/" + projectId + "/tasks?search=Only%20once"), null).andExpect(status().isOk()));
        assertThat((Integer) JsonPath.read(list, "$.data.totalElements")).isEqualTo(1);
        // The same key for a different request is refused.
        call(owner, post("/api/projects/" + projectId + "/tasks").header("Idempotency-Key", key), Map.of("title", "Something else", "priority", "LOW"))
                .andExpect(status().isUnprocessableEntity()).andExpect(jsonPath("$.code").value("IDEMPOTENCY_MISMATCH"));
        // A malformed key is refused before anything is done.
        call(owner, post("/api/projects/" + projectId + "/tasks").header("Idempotency-Key", "x y"), req).andExpect(status().isBadRequest());
    }

    @Test
    @DisplayName("Ten simultaneous submits of the same task create exactly one submission")
    void simultaneousSubmits() throws Exception {
        long taskId = task(Map.of("title", "Race me", "priority", "HIGH", "assigneeId", owner.id(), "acceptanceCriteria", List.of("It works")));
        int threads = 10;
        ExecutorService pool = Executors.newFixedThreadPool(threads);
        CountDownLatch go = new CountDownLatch(1);
        List<Future<Integer>> results = new ArrayList<>();
        for (int i = 0; i < threads; i++) {
            Callable<Integer> submit = () -> {
                go.await();
                MockMultipartFile data = new MockMultipartFile("data", "", MediaType.APPLICATION_JSON_VALUE,
                        json.writeValueAsBytes(Map.of("notes", "Done.", "evidence", List.of(Map.of("kind", "LINK", "url", "https://example.com/pr/1")))));
                return mvc.perform(multipart("/api/tasks/" + taskId + "/submissions").file(data).header("Authorization", "Bearer " + owner.token()))
                        .andReturn().getResponse().getStatus();
            };
            results.add(pool.submit(submit));
        }
        go.countDown();
        List<Integer> statuses = new ArrayList<>();
        for (Future<Integer> f : results) statuses.add(f.get());
        pool.shutdown();
        assertThat(statuses.stream().filter(s -> s == 201 || s == 200).count()).as("successes in %s", statuses).isEqualTo(1);
        assertThat(statuses).as("no server errors").allMatch(s -> s < 500 || s == 503);
        String subs = body(call(owner, get("/api/tasks/" + taskId + "/submissions"), null).andExpect(status().isOk()));
        assertThat((List<?>) JsonPath.read(subs, "$.data")).hasSize(1);
    }

    @Test
    @DisplayName("Every response has a request id, and error bodies repeat it")
    void requestIds() throws Exception {
        call(owner, get("/api/projects/999999"), null)
                .andExpect(header().exists("X-Request-Id")).andExpect(jsonPath("$.requestId").isNotEmpty());
        call(owner, get("/api/projects").header("X-Request-Id", "trace-abc-12345"), null).andExpect(header().string("X-Request-Id", "trace-abc-12345"));
        // Unsafe ids are replaced.
        call(owner, get("/api/projects").header("X-Request-Id", "bad id\nforged"), null)
                .andExpect(result -> assertThat(result.getResponse().getHeader("X-Request-Id")).doesNotContain("\n").isNotEqualTo("bad id\nforged"));
    }

    @Test
    @DisplayName("Oversized JSON is refused with 413")
    void oversizedJson() throws Exception {
        String huge = "x".repeat(600 * 1024);
        call(owner, post("/api/projects/" + projectId + "/tasks"), Map.of("title", "Big", "description", huge))
                .andExpect(status().isPayloadTooLarge()).andExpect(jsonPath("$.code").value("LIMIT_REACHED"));
    }

    @Test
    @DisplayName("Browser errors can be reported, even without a sign-in")
    void clientErrors() throws Exception {
        mvc.perform(post("/api/client-errors").contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(Map.of("message", "TypeError: x is undefined\nforged line", "url", "/projects/1", "kind", "error"))))
                .andExpect(status().isNoContent());
    }

    @Test
    @DisplayName("Usage counters add up per day, and don't mix periods")
    void usageCounters() {
        String c = "test.counter." + n;
        assertThat(usage.get(c, "2026-01-01")).isZero();
        usage.add(c, "2026-01-01", 3);
        assertThat(usage.add(c, "2026-01-01", 2)).isEqualTo(5);
        assertThat(usage.get(c, "2026-01")).isZero();
    }
}
