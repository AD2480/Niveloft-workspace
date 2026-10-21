package dev.projectflow.ops;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.jayway.jsonpath.JsonPath;
import java.time.LocalDate;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

/** Rate limits and quotas, with small limits so they're reached quickly. */
@SpringBootTest(properties = {
        "projectflow.bot-protection.rate-limits=true",
        "projectflow.ops.limits.requests-per-minute=6",
        "projectflow.ops.limits.max-tasks-per-project=2",
})
@AutoConfigureMockMvc
class LimitsTest {

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;

    @Test
    @DisplayName("Quotas refuse the task over the limit; the rate limit answers 429 with Retry-After")
    void quotasAndRateLimit() throws Exception {
        String res = mvc.perform(post("/api/auth/register").contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(Map.of("name", "Lim Its", "email", "limits@test.dev", "password", "Harbor-Quill-42", "acceptTerms", true))))
                .andExpect(status().is2xxSuccessful()).andReturn().getResponse().getContentAsString();
        String token = "Bearer " + JsonPath.read(res, "$.data.token");
        String project = mvc.perform(post("/api/projects").header("Authorization", token).contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(Map.of("name", "Limits", "key", "LIM", "startDate", LocalDate.now().toString()))))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString();
        long id = ((Number) JsonPath.read(project, "$.data.id")).longValue();
        for (int i = 0; i < 2; i++) {
            mvc.perform(post("/api/projects/" + id + "/tasks").header("Authorization", token).contentType(MediaType.APPLICATION_JSON)
                    .content(json.writeValueAsString(Map.of("title", "Task " + i, "priority", "LOW")))).andExpect(status().isCreated());
        }
        mvc.perform(post("/api/projects/" + id + "/tasks").header("Authorization", token).contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(Map.of("title", "One too many", "priority", "LOW"))))
                .andExpect(status().isUnprocessableEntity()).andExpect(jsonPath("$.code").value("LIMIT_REACHED"));
        MvcResult limited = null;
        for (int i = 0; i < 10 && limited == null; i++) {
            MvcResult r = mvc.perform(get("/api/projects").header("Authorization", token)).andReturn();
            if (r.getResponse().getStatus() == 429) limited = r;
        }
        assertThat(limited).as("a 429 within 10 requests").isNotNull();
        assertThat(limited.getResponse().getHeader("Retry-After")).isNotBlank();
        assertThat(limited.getResponse().getContentAsString()).contains("RATE_LIMITED");
    }
}
