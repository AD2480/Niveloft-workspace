package dev.projectflow.config;

import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;

/** Typed view of the {@code projectflow.*} settings in application.yml. */
@ConfigurationProperties(prefix = "projectflow")
public record AppProperties(
        String zone,
        Jwt jwt,
        Cors cors,
        Storage storage,
        Ai ai,
        Site site,
        Email email,
        Accounts accounts,
        BotProtection botProtection,
        Https https) {

    public record Jwt(String secret, long expirationSeconds) {}

    public record Cors(List<String> allowedOrigins) {}

    public record Storage(String directory) {}

    /** Where the frontend lives, for links in emails (e.g. https://projectflow.vercel.app). */
    public record Site(String url, String name, String contactEmail) {}

    /**
     * Outgoing email. provider = "none" (nothing is sent), "log" (written to the server log, for
     * local testing) or "resend" (sent through Resend's HTTPS API; SMTP isn't used because many
     * hosts block it). The key stays on the server.
     */
    public record Email(String provider, String apiKey, String from, String replyTo, String apiUrl, Boolean signInAlerts) {
        public String providerOrNone() {
            return provider == null || provider.isBlank() ? "none" : provider.trim().toLowerCase();
        }

        public boolean sends() {
            return !"none".equals(providerOrNone());
        }

        /** On unless turned off. */
        public boolean alertsOnSignIn() {
            return signInAlerts == null || signInAlerts;
        }
    }

    /**
     * Sign-up rules. requireEmailVerification = "auto" (on when email is sent through a real
     * provider), "true" or "false".
     */
    public record Accounts(String requireEmailVerification, Boolean registrationOpen) {
        /** Open unless closed. */
        public boolean open() {
            return registrationOpen == null || registrationOpen;
        }
    }

    /**
     * Protection against automated sign-ups and password guessing: per-address rate limits (always
     * on unless disabled for tests) and, optionally, a Cloudflare Turnstile check. trustedProxies is
     * how many proxies in front of the server add to X-Forwarded-For (1 on Railway or Render).
     */
    public record BotProtection(Boolean rateLimits, String turnstileSecret, String turnstileVerifyUrl, Integer trustedProxies) {
        /** On unless turned off (only tests do). */
        public boolean limitsOn() {
            return rateLimits == null || rateLimits;
        }

        /** 1 unless set: one hosting proxy in front of the server. */
        public int proxies() {
            return trustedProxies == null ? 1 : Math.max(0, trustedProxies);
        }

        public boolean turnstile() {
            return turnstileSecret != null && !turnstileSecret.isBlank();
        }
    }

    /** requireHttps: redirect plain-HTTP requests to HTTPS (behind a proxy that sets X-Forwarded-Proto). */
    public record Https(boolean required) {}

    /**
     * Optional AI assistance. provider = "none" (default) or "anthropic". The key stays on the
     * server; the browser never sees it.
     */
    public record Ai(String provider, String apiKey, String model, String baseUrl, int maxRequestsPerHour) {
        /**
         * The provider, normalised: blank means "auto" (use Ollama on this computer if it's
         * there), and "off"/"false"/"disabled" mean "none".
         */
        public String providerName() {
            String p = provider == null ? "" : provider.trim().toLowerCase(java.util.Locale.ROOT);
            if (p.isEmpty()) return "auto";
            return switch (p) {
                case "off", "false", "disabled" -> "none";
                default -> p;
            };
        }

        /** An explicitly chosen provider with what it needs (auto and ollama find their model themselves). */
        public boolean configured() {
            String p = providerName();
            if (p.equals("none") || p.equals("auto") || p.equals("ollama") || model == null || model.isBlank()) return false;
            // A local model (Ollama, LM Studio) needs no key; hosted services do.
            boolean keyless = !"anthropic".equals(p) && baseUrl != null
                    && (baseUrl.contains("localhost") || baseUrl.contains("127.0.0.1") || baseUrl.contains("host.docker.internal"));
            return keyless || (apiKey != null && !apiKey.isBlank());
        }
    }
}
