package dev.projectflow.config;

import java.time.Duration;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.stream.Collectors;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Settings added for the production launch ({@code projectflow.launch.*} in application.yml). Every
 * field may be missing (tests, older configuration files); the accessors supply the defaults.
 *
 * @param environment production, staging, development, test, or auto (production when the
 *                    database isn't on this machine)
 * @param databaseTls required (the database URL must ask for TLS in production) or not-required
 *                    (a private network the operator vouches for)
 */
@ConfigurationProperties(prefix = "projectflow.launch")
public record LaunchProperties(String environment, String databaseTls, Sessions sessions, Uploads uploads, Passwords passwords,
                               Audit audit, Ai ai) {

    public static LaunchProperties defaults() {
        return new LaunchProperties(null, null, null, null, null, null, null);
    }

    public String environmentName() {
        return environment == null || environment.isBlank() ? "auto" : environment.trim().toLowerCase(Locale.ROOT);
    }

    public boolean databaseTlsRequired() {
        return databaseTls == null || !databaseTls.trim().equalsIgnoreCase("not-required");
    }

    public Sessions sessionsOrDefault() {
        return sessions == null ? new Sessions(null, null, null, null, null) : sessions;
    }

    public Uploads uploadsOrDefault() {
        return uploads == null ? new Uploads(null, null, null, null, null) : uploads;
    }

    public Passwords passwordsOrDefault() {
        return passwords == null ? new Passwords(null, null) : passwords;
    }

    public Audit auditOrDefault() {
        return audit == null ? new Audit(null) : audit;
    }

    public Ai aiOrDefault() {
        return ai == null ? new Ai(null, null) : ai;
    }

    /**
     * How long a sign-in lasts. Without "keep me signed in": {@code idleHours} without a request
     * ends it, and it never lasts more than {@code maxHours}. With it: {@code rememberDays}, idle or
     * not; 0 turns "keep me signed in" off. {@code previousJwtSecret}: the key being rotated out,
     * still accepted for verification (never for signing) until its tokens expire.
     * {@code cookieSameSite}: the SameSite attribute of the "keep me signed in" cookie (see
     * {@link #sameSite(boolean)}).
     */
    public record Sessions(Integer idleHours, Integer maxHours, Integer rememberDays, String previousJwtSecret, String cookieSameSite) {
        public Duration idle() {
            return Duration.ofHours(clamp(idleHours, 12, 1, 24 * 30));
        }

        public Duration max() {
            return Duration.ofHours(Math.max(clamp(maxHours, 24, 1, 24 * 90), idle().toHours()));
        }

        public int rememberDaysOrDefault() {
            return clamp(rememberDays, 14, 0, 90);
        }

        public boolean rememberAllowed() {
            return rememberDaysOrDefault() > 0;
        }

        public Duration remember() {
            return Duration.ofDays(rememberDaysOrDefault());
        }

        /**
         * The "keep me signed in" cookie's SameSite attribute. auto (the default): None over HTTPS,
         * so the cookie also reaches an API on another site than the app (it's then Secure and
         * Partitioned, kept for the app's site only), and Lax over plain HTTP (development, where
         * the app and the API share an address). Or lax, strict or none.
         */
        public String sameSite(boolean https) {
            String s = cookieSameSite == null ? "auto" : cookieSameSite.trim().toLowerCase(Locale.ROOT);
            return switch (s) {
                case "lax" -> "Lax";
                case "strict" -> "Strict";
                case "none" -> "None";
                default -> https ? "None" : "Lax";
            };
        }
    }

    /**
     * Uploaded evidence. {@code allowedExtensions}: comma-separated; empty for the built-in list.
     * {@code scan}: off, or clamav (a clamd daemon at clamavHost:clamavPort scans every upload
     * before it's stored; an upload is refused when the scanner can't be reached).
     */
    public record Uploads(String allowedExtensions, String scan, String clamavHost, Integer clamavPort, Integer scanTimeoutSeconds) {
        public static final List<String> DEFAULT_EXTENSIONS = List.of(
                "png", "jpg", "jpeg", "gif", "webp", "svg", "pdf", "txt", "md", "csv", "tsv", "json", "log", "xml", "yaml", "yml",
                "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp", "rtf", "key", "numbers", "pages",
                "zip", "mp4", "mov", "webm", "mp3", "wav", "m4a", "fig", "sketch", "drawio", "har");

        public Set<String> extensions() {
            if (allowedExtensions == null || allowedExtensions.isBlank()) return Set.copyOf(DEFAULT_EXTENSIONS);
            return Arrays.stream(allowedExtensions.split(","))
                    .map(s -> s.trim().toLowerCase(Locale.ROOT).replaceFirst("^\\.", ""))
                    .filter(s -> !s.isEmpty())
                    .collect(Collectors.toUnmodifiableSet());
        }

        public boolean scanWithClamav() {
            return scan != null && scan.trim().equalsIgnoreCase("clamav");
        }

        public String clamavHostOrDefault() {
            return clamavHost == null || clamavHost.isBlank() ? "127.0.0.1" : clamavHost.trim();
        }

        public int clamavPortOrDefault() {
            return clamp(clamavPort, 3310, 1, 65535);
        }

        public Duration scanTimeout() {
            return Duration.ofSeconds(clamp(scanTimeoutSeconds, 20, 1, 300));
        }
    }

    /** {@code breachCheck}: off, or hibp (Have I Been Pwned's range API, k-anonymity: only 5 hex characters of a SHA-1 leave the server). */
    public record Passwords(String breachCheck, String breachApiUrl) {
        public boolean hibp() {
            return breachCheck != null && breachCheck.trim().equalsIgnoreCase("hibp");
        }

        public String apiUrl() {
            return breachApiUrl == null || breachApiUrl.isBlank() ? "https://api.pwnedpasswords.com/range/" : breachApiUrl.trim();
        }
    }

    /** {@code retentionDays}: how long audit records are kept; at least 180 (India's CERT-In directions ask for 180 days of logs). */
    public record Audit(Integer retentionDays) {
        public int retention() {
            return clamp(retentionDays, 365, 180, 3650);
        }
    }

    /**
     * Flurry's shared limits, on top of each person's hourly limit and the server's daily and
     * monthly caps: {@code requestsPerProjectPerDay} (one busy project can't use the whole
     * server's budget; 0 for none) and {@code maxConcurrent} (questions being answered at once on
     * this server; more wait their turn by being refused with "busy").
     */
    public record Ai(Integer requestsPerProjectPerDay, Integer maxConcurrent) {
        public int perProjectPerDay() {
            return clamp(requestsPerProjectPerDay, 300, 0, 1_000_000);
        }

        public int concurrent() {
            return clamp(maxConcurrent, 8, 1, 256);
        }
    }

    static int clamp(Integer value, int fallback, int min, int max) {
        int v = value == null ? fallback : value;
        return Math.max(min, Math.min(max, v));
    }
}
