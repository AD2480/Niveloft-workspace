package dev.projectflow.security;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.projectflow.config.AppProperties;
import dev.projectflow.web.error.ApiException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * Checks forms that bots target (sign-up, emailed links) for signs of automation:
 * a hidden "honeypot" field people never fill in, and, when a secret key is configured, a
 * Cloudflare Turnstile token verified with Cloudflare from the server.
 */
@Component
public class HumanCheck {

    private static final Logger log = LoggerFactory.getLogger(HumanCheck.class);
    private static final String DEFAULT_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

    private final String secret;
    private final String verifyUrl;
    private final ObjectMapper json;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();

    public HumanCheck(AppProperties props, ObjectMapper json) {
        AppProperties.BotProtection bp = props.botProtection();
        this.secret = bp != null && bp.turnstile() ? bp.turnstileSecret().trim() : null;
        this.verifyUrl = bp != null && bp.turnstileVerifyUrl() != null && !bp.turnstileVerifyUrl().isBlank() ? bp.turnstileVerifyUrl() : DEFAULT_VERIFY_URL;
        this.json = json;
    }

    public boolean turnstileEnabled() {
        return secret != null;
    }

    /** Throws a 400 when the request looks automated. */
    public void require(String honeypot, String turnstileToken, String ip) {
        if (honeypot != null && !honeypot.isBlank()) {
            // Only bots see and fill this field. Say nothing specific.
            throw ApiException.validation("form", "We couldn’t process this form. Please reload the page and try again.");
        }
        if (secret == null) return;
        if (turnstileToken == null || turnstileToken.isBlank()) {
            throw ApiException.validation("captcha", "Please complete the check that you’re not a bot.");
        }
        if (!verify(turnstileToken, ip)) {
            throw ApiException.validation("captcha", "The check that you’re not a bot didn’t pass. Please try it again.");
        }
    }

    boolean verify(String token, String ip) {
        String form = "secret=" + enc(secret) + "&response=" + enc(token) + (ip == null ? "" : "&remoteip=" + enc(ip));
        try {
            HttpResponse<String> res = http.send(
                    HttpRequest.newBuilder(URI.create(verifyUrl))
                            .timeout(Duration.ofSeconds(8))
                            .header("Content-Type", "application/x-www-form-urlencoded")
                            .POST(HttpRequest.BodyPublishers.ofString(form))
                            .build(),
                    HttpResponse.BodyHandlers.ofString());
            JsonNode body = json.readTree(res.body());
            return res.statusCode() == 200 && body.path("success").asBoolean(false);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return false;
        } catch (Exception e) {
            // Fail closed: without the check, sign-ups stay shut rather than open to bots.
            log.warn("Turnstile verification failed: {}", e.toString());
            return false;
        }
    }

    private static String enc(String s) {
        return URLEncoder.encode(s, StandardCharsets.UTF_8);
    }
}
