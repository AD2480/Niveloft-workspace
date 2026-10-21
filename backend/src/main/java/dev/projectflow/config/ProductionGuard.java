package dev.projectflow.config;

import dev.projectflow.security.RateCounts;
import java.net.URI;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

/**
 * Refuses to start a production server with development settings. Production is
 * APP_ENV=production (or staging), or APP_ENV=auto (the default) with a database that isn't on
 * this machine. Every problem is listed at once, each with its fix, so one restart is enough.
 * Development and test servers start as before.
 */
@Component
public class ProductionGuard {

    private static final Logger log = LoggerFactory.getLogger(ProductionGuard.class);

    /** What the guard looks at, gathered from the configuration (a plain record, so it's testable without Spring). */
    public record Settings(String environment, String databaseUrl, boolean databaseTlsRequired, boolean jwtSecretIsDevelopment,
                           List<String> corsOrigins, String appUrl, boolean httpsRequired, boolean apiDocs, String emailProvider,
                           String operatorEmails, String aiProvider, int aiRequestsPerDay, long aiTokensPerMonth, int aiPerProjectPerDay,
                           String voiceProvider, int voiceCharactersPerDay, String storageDirectory, boolean registrationOpen,
                           boolean turnstile, boolean uploadScan, int rememberDays, int trustedProxies, String rateLimitStore) {}

    public record Result(boolean production, List<String> problems, List<String> warnings) {}

    private final Result result;

    public ProductionGuard(AppProperties props, LaunchProperties launch, OperatorProperties operators, OpsProperties ops,
                           AssistantProperties assistant, Environment env) {
        LaunchProperties l = launch == null ? LaunchProperties.defaults() : launch;
        OpsProperties.Spending spending = ops == null ? new OpsProperties(null, null).spendingOrDefault() : ops.spendingOrDefault();
        AssistantProperties.Voice voice = assistant == null || assistant.voice() == null ? null : assistant.voice();
        Settings s = new Settings(
                l.environmentName(),
                env.getProperty("spring.datasource.url", ""),
                l.databaseTlsRequired(),
                props.jwt() != null && "ZGV2LW9ubHktcHJvamVjdGZsb3ctc2VjcmV0LWNoYW5nZS1tZS1iZWZvcmUtZGVwbG95aW5nLTEyMzQ1Ng==".equals(props.jwt().secret()),
                props.cors() == null || props.cors().allowedOrigins() == null ? List.of() : props.cors().allowedOrigins(),
                props.site() == null ? "" : props.site().url(),
                props.https() != null && props.https().required(),
                env.getProperty("springdoc.api-docs.enabled", Boolean.class, true) || env.getProperty("springdoc.swagger-ui.enabled", Boolean.class, true),
                props.email() == null ? "none" : props.email().providerOrNone(),
                operators == null ? "" : operators.emails(),
                props.ai() == null ? "none" : props.ai().providerName(),
                spending.aiPerDay(),
                spending.aiTokens(),
                l.aiOrDefault().perProjectPerDay(),
                voice == null ? "none" : voice.providerName(),
                voice == null ? 0 : voice.charactersPerDay(),
                props.storage() == null ? "" : props.storage().directory(),
                props.accounts() == null || props.accounts().open(),
                props.botProtection() != null && props.botProtection().turnstile(),
                l.uploadsOrDefault().scanWithClamav(),
                l.sessionsOrDefault().rememberDaysOrDefault(),
                props.botProtection() == null ? 1 : props.botProtection().proxies(),
                env.getProperty("projectflow.rate-limits.store", "auto"));
        this.result = check(s);
        if (!result.production()) {
            log.info("Environment: development (APP_ENV={}). Production checks are off.", s.environment());
            return;
        }
        result.warnings().forEach(w -> log.warn("Production: {}", w));
        if (!result.problems().isEmpty()) {
            throw new IllegalStateException("This server is running as production (APP_ENV=" + s.environment()
                    + ") but its settings aren't safe for real customers. Fix these and restart:\n  - " + String.join("\n  - ", result.problems()));
        }
        log.info("Environment: production. The production settings checks passed{}.", result.warnings().isEmpty() ? "" : ", with " + result.warnings().size() + " warning(s)");
    }

    public Result result() {
        return result;
    }

    public boolean production() {
        return result.production();
    }

    static boolean isProduction(String environment, String databaseUrl) {
        return switch (environment == null ? "auto" : environment) {
            case "production", "prod", "staging" -> true;
            case "development", "dev", "test", "local" -> false;
            default -> !isLocalDatabase(databaseUrl);
        };
    }

    /** A database on this machine (or an in-memory one). */
    static boolean isLocalDatabase(String url) {
        if (url == null || url.isBlank()) return true;
        String u = url.toLowerCase(Locale.ROOT);
        return u.startsWith("jdbc:h2:") || u.contains("//localhost") || u.contains("//127.0.0.1") || u.contains("//[::1]") || u.contains("//host.docker.internal");
    }

    /** MySQL Connector/J: sslMode=REQUIRED, VERIFY_CA or VERIFY_IDENTITY; or the older useSSL=true with requireSSL=true. */
    static boolean urlRequiresTls(String url) {
        String u = url == null ? "" : url.toLowerCase(Locale.ROOT);
        if (u.matches(".*[?&]sslmode=(required|verify_ca|verify_identity)(&.*|$)")) return true;
        return u.matches(".*[?&]usessl=true(&.*|$)") && u.matches(".*[?&]requiressl=true(&.*|$)");
    }

    static boolean localAddress(String host) {
        String h = host == null ? "" : host.toLowerCase(Locale.ROOT);
        return h.isEmpty() || h.equals("localhost") || h.endsWith(".localhost") || h.equals("127.0.0.1") || h.equals("[::1]") || h.equals("0.0.0.0");
    }

    static boolean httpsPublicUrl(String value) {
        try {
            URI u = URI.create(value == null ? "" : value.trim());
            return "https".equalsIgnoreCase(u.getScheme()) && !localAddress(u.getHost());
        } catch (IllegalArgumentException e) {
            return false;
        }
    }

    public static Result check(Settings s) {
        boolean production = isProduction(s.environment(), s.databaseUrl());
        List<String> problems = new ArrayList<>();
        List<String> warnings = new ArrayList<>();
        if (!production) return new Result(false, List.of(), List.of());

        String db = s.databaseUrl() == null ? "" : s.databaseUrl().toLowerCase(Locale.ROOT);
        if (db.startsWith("jdbc:h2:")) problems.add("DB_URL points to an in-memory H2 database: everything is lost on restart. Use MySQL.");
        if (s.databaseTlsRequired() && !db.startsWith("jdbc:h2:") && !urlRequiresTls(s.databaseUrl())) {
            problems.add("DB_URL doesn't require TLS. Add sslMode=REQUIRED (or VERIFY_IDENTITY) to it, or set DATABASE_TLS=not-required "
                    + "only if the database is reachable on a private network alone.");
        }
        if (s.jwtSecretIsDevelopment()) problems.add("JWT_SECRET is the public development key. Set it to the output of: openssl rand -base64 48");
        List<String> badOrigins = s.corsOrigins().stream().map(String::trim).filter(o -> !o.isEmpty())
                .filter(o -> o.equals("*") || !httpsPublicUrl(o)).toList();
        if (s.corsOrigins().stream().allMatch(String::isBlank)) {
            problems.add("CORS_ALLOWED_ORIGINS is empty: set it to the site's address, e.g. https://app.example.com");
        } else if (!badOrigins.isEmpty()) {
            problems.add("CORS_ALLOWED_ORIGINS must list only https:// addresses of the real site (no *, localhost or http): " + String.join(", ", badOrigins));
        }
        if (!httpsPublicUrl(s.appUrl())) problems.add("APP_URL must be the site's public https:// address (emailed links use it); it is " + quote(s.appUrl()) + ".");
        if (!s.httpsRequired()) problems.add("REQUIRE_HTTPS must be true, so plain-HTTP requests are refused.");
        if (s.apiDocs()) problems.add("API_DOCS_ENABLED must be false: the API's interactive documentation isn't meant to be public.");
        if ("log".equals(s.emailProvider())) problems.add("EMAIL_PROVIDER=log writes emails, with their sign-in links, to the server log. Use resend, or none.");
        if (s.operatorEmails() == null || s.operatorEmails().isBlank()) {
            problems.add("OPERATOR_EMAILS is empty: name at least one operator, who can see Site health and use the emergency switches.");
        }
        if (!"none".equals(s.aiProvider())) {
            if (s.aiRequestsPerDay() <= 0) problems.add("AI_MAX_REQUESTS_PER_DAY must be above 0 while AI is on: 0 means no daily cap.");
            if (s.aiTokensPerMonth() <= 0) problems.add("AI_MAX_TOKENS_PER_MONTH must be above 0 while AI is on: 0 means no monthly cap.");
            if (s.aiPerProjectPerDay() <= 0) problems.add("AI_MAX_REQUESTS_PER_PROJECT_PER_DAY must be above 0 while AI is on, so one project can't use the whole budget.");
        }
        if ("elevenlabs".equals(s.voiceProvider()) && s.voiceCharactersPerDay() <= 0) {
            problems.add("VOICE_MAX_CHARACTERS_PER_DAY must be above 0 while ElevenLabs is on: 0 means no daily cap.");
        }
        String dir = s.storageDirectory() == null ? "" : s.storageDirectory().trim();
        if (dir.isEmpty() || !(dir.startsWith("/") || dir.matches("^[A-Za-z]:[\\\\/].*"))) {
            problems.add("STORAGE_DIR must be an absolute path on a persistent volume (it is " + quote(dir)
                    + "): uploaded evidence in a container's own folder is lost at the next deploy.");
        }

        if ("none".equals(s.emailProvider())) warnings.add("EMAIL_PROVIDER=none: people can't confirm addresses or reset forgotten passwords.");
        if (s.registrationOpen() && !s.turnstile()) warnings.add("Sign-up is open without Turnstile (TURNSTILE_SECRET_KEY): only rate limits and a honeypot slow sign-up bots.");
        if (!s.uploadScan()) warnings.add("UPLOAD_SCAN=off: uploaded files aren't scanned for malware (they're always served as downloads, never run).");
        if ("memory".equals(RateCounts.store(s.rateLimitStore(), true))) {
            warnings.add("RATE_LIMIT_STORE=" + s.rateLimitStore().trim() + ": each API instance counts rate limits on its own, so with several "
                    + "instances someone gets the limit once per instance. Leave it at auto (counted in the database) unless only one instance ever runs.");
        }
        if (s.trustedProxies() > 3) warnings.add("TRUSTED_PROXIES=" + s.trustedProxies() + " is unusually high: rate limits trust that many forwarded addresses.");
        return new Result(true, List.copyOf(problems), List.copyOf(warnings));
    }

    private static String quote(String v) {
        return v == null || v.isBlank() ? "empty" : "“" + v + "”";
    }
}
