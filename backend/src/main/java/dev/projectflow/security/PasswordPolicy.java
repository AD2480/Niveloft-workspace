package dev.projectflow.security;

import dev.projectflow.config.LaunchProperties;
import dev.projectflow.web.error.ApiException;
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Duration;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.Locale;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * What a new password must not be: one of the passwords attackers try first (a bundled list, and
 * the same words with digits, symbols or letter-for-number swaps around them), the account's own
 * email name or the product's name, or a few characters repeated. Long passphrases and password
 * managers' output always pass these rules; the length and letter-and-number rule is checked
 * where the request is validated.
 *
 * <p>Optionally ({@code PASSWORD_BREACH_CHECK=hibp}) a password is also checked against Have I Been
 * Pwned's breach corpus with its range API: only the first 5 hex characters of the password's
 * SHA-1 leave the server. If that service can't be reached in 3 seconds the check is skipped (and
 * logged), so an outage there doesn't stop sign-ups.
 */
@Component
public class PasswordPolicy {

    private static final Logger log = LoggerFactory.getLogger(PasswordPolicy.class);
    static final String TOO_COMMON = "This password is too common or too easy to guess. A longer phrase of unrelated words works well, or let your password manager make one.";
    static final String BREACHED = "This password has appeared in a known data breach, so attackers try it. Choose a different one.";

    private final Set<String> common;
    private final LaunchProperties.Passwords config;
    private final HttpClient http;

    public PasswordPolicy(LaunchProperties launch) {
        this(load(), (launch == null ? LaunchProperties.defaults() : launch).passwordsOrDefault(),
                HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build());
    }

    PasswordPolicy(Set<String> common, LaunchProperties.Passwords config, HttpClient http) {
        this.common = common;
        this.config = config;
        this.http = http;
    }

    /** Refuses the password for {@code field} with a message saying why, or returns. */
    public void check(String password, String email, String name, String field) {
        String problem = problem(password, email, name, common);
        if (problem == null && config.hibp() && breached(password)) problem = BREACHED;
        if (problem != null) throw ApiException.validation(field, problem);
    }

    /** Why a password is too weak (beyond the length and character rules), or null. */
    static String problem(String password, String email, String name, Set<String> common) {
        if (password == null) return null;
        String lower = password.toLowerCase(Locale.ROOT);
        if (common.contains(lower)) return TOO_COMMON;
        // The rules below only apply to shorter passwords: a long phrase is strong even if it contains a word.
        if (password.length() >= 16) return null;
        String core = unleet(lower.replaceAll("^[^\\p{L}]+|[^\\p{L}]+$", ""));
        if (!core.isEmpty() && common.contains(core)) return TOO_COMMON;
        if (lower.chars().distinct().count() <= 3) return TOO_COMMON;
        String local = email == null ? "" : email.toLowerCase(Locale.ROOT).replaceFirst("@.*$", "").replaceAll("[^\\p{L}\\p{N}]", "");
        if (local.length() >= 4 && lower.replaceAll("[^\\p{L}\\p{N}]", "").contains(local)) {
            return "Your password can’t contain your email address. Choose something others couldn’t guess from it.";
        }
        if (name != null) {
            for (String part : name.toLowerCase(Locale.ROOT).split("[^\\p{L}]+")) {
                if (part.length() >= 4 && core.equals(part)) return "Your password can’t be just your name with numbers or symbols around it.";
            }
        }
        if (lower.contains("niveloft") || lower.contains("projectflow")) return TOO_COMMON;
        return null;
    }

    /** Undoes the usual letter-for-number swaps (p@ssw0rd → password). */
    static String unleet(String s) {
        StringBuilder b = new StringBuilder(s.length());
        for (char c : s.toCharArray()) {
            b.append(switch (c) {
                case '0' -> 'o';
                case '1', '!' -> 'i';
                case '3' -> 'e';
                case '4', '@' -> 'a';
                case '5', '$' -> 's';
                case '7' -> 't';
                default -> c;
            });
        }
        return b.toString();
    }

    /** Whether Have I Been Pwned lists the password; false when it can't be asked. */
    boolean breached(String password) {
        String sha1 = sha1(password);
        String prefix = sha1.substring(0, 5);
        String suffix = sha1.substring(5);
        try {
            HttpRequest req = HttpRequest.newBuilder(URI.create(config.apiUrl() + prefix))
                    .timeout(Duration.ofSeconds(3))
                    .header("Add-Padding", "true")
                    .header("User-Agent", "Niveloft password check")
                    .GET().build();
            HttpResponse<String> res = http.send(req, HttpResponse.BodyHandlers.ofString());
            if (res.statusCode() != 200) {
                log.warn("Password breach check skipped: the service answered {}.", res.statusCode());
                return false;
            }
            for (String line : res.body().split("\r?\n")) {
                int colon = line.indexOf(':');
                if (colon <= 0) continue;
                if (line.substring(0, colon).trim().equalsIgnoreCase(suffix)) {
                    String count = line.substring(colon + 1).trim();
                    return !count.equals("0"); // padding rows have a count of 0
                }
            }
            return false;
        } catch (IOException e) {
            log.warn("Password breach check skipped: {}", e.getMessage());
            return false;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return false;
        }
    }

    static String sha1(String s) {
        try {
            return HexFormat.of().withUpperCase().formatHex(MessageDigest.getInstance("SHA-1").digest(s.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    static Set<String> load() {
        Set<String> words = new HashSet<>();
        try (InputStream in = PasswordPolicy.class.getResourceAsStream("/security/common-passwords.txt")) {
            if (in == null) throw new IllegalStateException("security/common-passwords.txt is missing from the build");
            try (BufferedReader r = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8))) {
                String line;
                while ((line = r.readLine()) != null) {
                    String w = line.trim().toLowerCase(Locale.ROOT);
                    if (!w.isEmpty() && !w.startsWith("#")) words.add(w);
                }
            }
        } catch (IOException e) {
            throw new IllegalStateException("Couldn't read the common-password list", e);
        }
        return Set.copyOf(words);
    }
}
