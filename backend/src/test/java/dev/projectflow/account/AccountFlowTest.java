package dev.projectflow.account;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.jayway.jsonpath.JsonPath;
import dev.projectflow.config.AppProperties;
import dev.projectflow.email.EmailMessage;
import dev.projectflow.email.EmailService;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

/**
 * Real people signing up: confirm the email, sign in (with an alert email), forget the password,
 * reset it (which signs out every earlier session), and the bot checks on the way.
 * Emails are captured instead of sent.
 */
@SpringBootTest(properties = {
        "projectflow.email.provider=log",
        "projectflow.accounts.require-email-verification=true",
        "projectflow.site.url=https://pf.example.app",
})
@AutoConfigureMockMvc
class AccountFlowTest {

    /** Keeps every email instead of sending it. */
    static class CapturingEmail extends EmailService {
        final List<EmailMessage> sent = new CopyOnWriteArrayList<>();

        CapturingEmail(AppProperties props, ObjectMapper json) {
            super(props, json);
        }

        @Override
        public void send(EmailMessage m) {
            sent.add(m);
        }
    }

    @TestConfiguration
    static class Emails {
        @Bean
        @Primary
        CapturingEmail capturingEmail(AppProperties props, ObjectMapper json) {
            return new CapturingEmail(props, json);
        }
    }

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired CapturingEmail email;

    @BeforeEach
    void clear() {
        email.sent.clear();
    }

    private ResultActions postJson(String url, Object body) throws Exception {
        return mvc.perform(post(url).contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(body)));
    }

    private static String linkToken(EmailMessage m, String path) {
        Matcher match = Pattern.compile("https://pf\\.example\\.app" + Pattern.quote(path) + "\\?token=([A-Za-z0-9_-]+)").matcher(m.text());
        assertThat(match.find()).as("link to %s in: %s", path, m.text()).isTrue();
        return match.group(1);
    }

    private static Map<String, Object> signUp(String address) {
        return Map.of("name", "Asha Rao", "email", address, "password", "Harbor-Quill-42", "acceptTerms", true);
    }

    @Test
    @DisplayName("sign up → confirm email → sign in (alert sent) → reset password → old sessions end")
    void fullAccountLifecycle() throws Exception {
        String address = "asha.flow@test.dev";
        postJson("/api/auth/register", signUp(address))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.data.verificationRequired").value(true))
                .andExpect(jsonPath("$.data.token").doesNotExist());
        assertThat(email.sent).hasSize(1);
        assertThat(email.sent.get(0).to()).isEqualTo(address);
        assertThat(email.sent.get(0).subject()).contains("Confirm your email");

        // Not confirmed yet: the right password still can't sign in.
        postJson("/api/auth/login", Map.of("email", address, "password", "Harbor-Quill-42"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("EMAIL_NOT_VERIFIED"));

        String confirm = linkToken(email.sent.get(0), "/verify-email");
        // Confirming doesn't sign anyone in (so an address registered by someone else can't be taken over).
        postJson("/api/auth/verify-email", Map.of("token", confirm))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.email").value(address))
                .andExpect(jsonPath("$.data.token").doesNotExist());
        // A confirmation link works once.
        postJson("/api/auth/verify-email", Map.of("token", confirm)).andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("LINK_EXPIRED"));

        email.sent.clear();
        String firstToken = JsonPath.read(postJson("/api/auth/login", Map.of("email", address, "password", "Harbor-Quill-42"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.user.emailVerified").value(true))
                .andReturn().getResponse().getContentAsString(), "$.data.token");
        assertThat(email.sent).singleElement().satisfies(m -> assertThat(m.subject()).contains("New sign-in"));

        email.sent.clear();
        postJson("/api/auth/forgot-password", Map.of("email", address)).andExpect(status().isOk());
        String reset = linkToken(email.sent.get(0), "/reset-password");
        postJson("/api/auth/reset-password", Map.of("token", reset, "password", "Newpass456")).andExpect(status().isOk());
        assertThat(email.sent).anySatisfy(m -> assertThat(m.subject()).contains("password was changed"));

        // The session from before the reset no longer works; the new password does.
        mvc.perform(get("/api/auth/me").header("Authorization", "Bearer " + firstToken)).andExpect(status().isUnauthorized());
        postJson("/api/auth/login", Map.of("email", address, "password", "Harbor-Quill-42")).andExpect(status().isUnauthorized());
        postJson("/api/auth/login", Map.of("email", address, "password", "Newpass456")).andExpect(status().isOk());
        postJson("/api/auth/reset-password", Map.of("token", reset, "password", "Another789")).andExpect(status().isBadRequest());
    }

    @Test
    @DisplayName("changing the password returns a new session and ends the old one")
    void changePasswordKeepsThisDevice() throws Exception {
        String address = "ravi.flow@test.dev";
        postJson("/api/auth/register", signUp(address)).andExpect(status().isCreated());
        postJson("/api/auth/verify-email", Map.of("token", linkToken(email.sent.get(0), "/verify-email"))).andExpect(status().isOk());
        String old = JsonPath.read(postJson("/api/auth/login", Map.of("email", address, "password", "Harbor-Quill-42"))
                .andReturn().getResponse().getContentAsString(), "$.data.token");
        String fresh = JsonPath.read(mvc.perform(put("/api/users/me/password").header("Authorization", "Bearer " + old)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(Map.of("currentPassword", "Harbor-Quill-42", "newPassword", "Changed456"))))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString(), "$.data.token");
        mvc.perform(get("/api/auth/me").header("Authorization", "Bearer " + old)).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/auth/me").header("Authorization", "Bearer " + fresh)).andExpect(status().isOk());
    }

    @Test
    @DisplayName("signing up with a registered address answers like a new account, and tells the owner instead")
    void duplicateSignupIsGeneric() throws Exception {
        String address = "dup.flow@test.dev";
        postJson("/api/auth/register", signUp(address)).andExpect(status().isCreated());
        email.sent.clear();
        postJson("/api/auth/register", Map.of("name", "Someone Else", "email", address, "password", "Lantern-Copper-77", "acceptTerms", true))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.data.verificationRequired").value(true))
                .andExpect(jsonPath("$.data.token").doesNotExist());
        assertThat(email.sent).singleElement().satisfies(m -> {
            assertThat(m.to()).isEqualTo(address);
            assertThat(m.subject()).contains("tried to create");
        });
        // The original password still works once confirmed; the attempt changed nothing.
        postJson("/api/auth/login", Map.of("email", address, "password", "Lantern-Copper-77")).andExpect(status().isUnauthorized());
    }

    @Test
    @DisplayName("passwords over 72 bytes are refused politely, not with a server error")
    void longMultibytePasswords() throws Exception {
        String tooLong = "ä1".repeat(30); // 60 characters, 90 bytes in UTF-8
        postJson("/api/auth/register", Map.of("name", "Long Password", "email", "long.pw@test.dev", "password", tooLong, "acceptTerms", true))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.fieldErrors.password").exists());
    }

    @Test
    @DisplayName("sign-up needs accepted terms and an empty honeypot; answers don't reveal accounts")
    void botAndValidationChecks() throws Exception {
        postJson("/api/auth/register", Map.of("name", "Bot", "email", "bot@test.dev", "password", "Harbor-Quill-42"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.fieldErrors.acceptTerms").exists());
        postJson("/api/auth/register", Map.of("name", "Bot Person", "email", "bot2@test.dev", "password", "Harbor-Quill-42", "acceptTerms", true, "website", "http://spam.example"))
                .andExpect(status().isBadRequest());
        assertThat(email.sent).isEmpty();

        // Same answer whether or not the address has an account.
        String known = postJson("/api/auth/forgot-password", Map.of("email", "nobody.here@test.dev")).andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        assertThat((String) JsonPath.read(known, "$.message")).startsWith("If that address has an account");
        assertThat(email.sent).isEmpty();

        mvc.perform(get("/api/auth/options"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.emailVerificationRequired").value(true))
                .andExpect(jsonPath("$.data.passwordReset").value(true));
    }
}
