// Ported from the plain-Java checks that ran in the sandbox for the launch release (the same
// assertions, now run by ./mvnw verify).
package dev.projectflow.config;

import java.util.ArrayList;
import java.util.List;

/** The production settings guard: what it refuses, what it only warns about, and when it applies. */
class ProductionGuardRulesTest {
    static final List<String> results = new ArrayList<>();

    static void check(String name, boolean ok) {
        results.add((ok ? "PASS  " : "FAIL  ") + name);
    }

    static ProductionGuard.Settings good() {
        return new ProductionGuard.Settings("production", "jdbc:mysql://db.internal:3306/niveloft?sslMode=VERIFY_IDENTITY", true, false,
                List.of("https://app.niveloft.example"), "https://app.niveloft.example", true, false, "resend", "ops@niveloft.example", "openai", 1000,
                5_000_000L, 300, "none", 0, "/data/uploads", true, true, true, 0, 1, "auto");
    }

    static ProductionGuard.Settings with(java.util.function.UnaryOperator<Object[]> change) {
        ProductionGuard.Settings g = good();
        Object[] f = {g.environment(), g.databaseUrl(), g.databaseTlsRequired(), g.jwtSecretIsDevelopment(), g.corsOrigins(), g.appUrl(),
                g.httpsRequired(), g.apiDocs(), g.emailProvider(), g.operatorEmails(), g.aiProvider(), g.aiRequestsPerDay(), g.aiTokensPerMonth(),
                g.aiPerProjectPerDay(), g.voiceProvider(), g.voiceCharactersPerDay(), g.storageDirectory(), g.registrationOpen(), g.turnstile(),
                g.uploadScan(), g.rememberDays(), g.trustedProxies(), g.rateLimitStore()};
        f = change.apply(f);
        @SuppressWarnings("unchecked") List<String> origins = (List<String>) f[4];
        return new ProductionGuard.Settings((String) f[0], (String) f[1], (Boolean) f[2], (Boolean) f[3], origins, (String) f[5],
                (Boolean) f[6], (Boolean) f[7], (String) f[8], (String) f[9], (String) f[10], (Integer) f[11], (Long) f[12], (Integer) f[13],
                (String) f[14], (Integer) f[15], (String) f[16], (Boolean) f[17], (Boolean) f[18], (Boolean) f[19], (Integer) f[20], (Integer) f[21], (String) f[22]);
    }

    static boolean refuses(ProductionGuard.Settings s, String word) {
        return ProductionGuard.check(s).problems().stream().anyMatch(p -> p.contains(word));
    }

    @org.junit.jupiter.api.Test
    void allRules() throws Exception {
        results.clear();
        ProductionGuard.Result ok = ProductionGuard.check(good());
        check("a complete production configuration passes with no warnings", ok.production() && ok.problems().isEmpty() && ok.warnings().isEmpty());
        check("the public development key is refused", refuses(with(f -> { f[3] = true; return f; }), "JWT_SECRET"));
        check("localhost CORS is refused", refuses(with(f -> { f[4] = List.of("https://app.niveloft.example", "http://localhost:5174"); return f; }), "CORS_ALLOWED_ORIGINS"));
        check("a * origin is refused", refuses(with(f -> { f[4] = List.of("*"); return f; }), "CORS_ALLOWED_ORIGINS"));
        check("no origins is refused", refuses(with(f -> { f[4] = List.of(); return f; }), "CORS_ALLOWED_ORIGINS"));
        check("an http or localhost APP_URL is refused", refuses(with(f -> { f[5] = "http://app.niveloft.example"; return f; }), "APP_URL")
                && refuses(with(f -> { f[5] = "https://localhost:5174"; return f; }), "APP_URL"));
        check("REQUIRE_HTTPS=false is refused", refuses(with(f -> { f[6] = false; return f; }), "REQUIRE_HTTPS"));
        check("public API docs are refused", refuses(with(f -> { f[7] = true; return f; }), "API_DOCS_ENABLED"));
        check("EMAIL_PROVIDER=log is refused", refuses(with(f -> { f[8] = "log"; return f; }), "EMAIL_PROVIDER"));
        check("no operator is refused", refuses(with(f -> { f[9] = " "; return f; }), "OPERATOR_EMAILS"));
        check("AI without a daily cap is refused", refuses(with(f -> { f[11] = 0; return f; }), "AI_MAX_REQUESTS_PER_DAY"));
        check("AI without a monthly cap is refused", refuses(with(f -> { f[12] = 0L; return f; }), "AI_MAX_TOKENS_PER_MONTH"));
        check("AI without a project cap is refused", refuses(with(f -> { f[13] = 0; return f; }), "AI_MAX_REQUESTS_PER_PROJECT_PER_DAY"));
        check("caps don't matter with AI off", !refuses(with(f -> { f[10] = "none"; f[11] = 0; f[12] = 0L; return f; }), "AI_MAX"));
        check("ElevenLabs without a cap is refused", refuses(with(f -> { f[14] = "elevenlabs"; f[15] = 0; return f; }), "VOICE_MAX_CHARACTERS_PER_DAY"));
        check("a relative storage folder is refused", refuses(with(f -> { f[16] = "./data/uploads"; return f; }), "STORAGE_DIR"));
        check("a database URL without TLS is refused…", refuses(with(f -> { f[1] = "jdbc:mysql://db.internal:3306/n?useSSL=false"; return f; }), "TLS"));
        check("…unless the operator says it's a private network", !refuses(with(f -> { f[1] = "jdbc:mysql://db.internal:3306/n"; f[2] = false; return f; }), "TLS"));
        check("useSSL=true alone isn't enough; with requireSSL=true it is", refuses(with(f -> { f[1] = "jdbc:mysql://d:3306/n?useSSL=true"; return f; }), "TLS")
                && !refuses(with(f -> { f[1] = "jdbc:mysql://d:3306/n?useSSL=true&requireSSL=true"; return f; }), "TLS"));
        check("H2 in production is refused", refuses(with(f -> { f[1] = "jdbc:h2:mem:x"; return f; }), "H2"));
        check("every problem is listed at once", ProductionGuard.check(with(f -> { f[3] = true; f[6] = false; f[7] = true; return f; })).problems().size() == 3);
        ProductionGuard.Result warn = ProductionGuard.check(with(f -> { f[8] = "none"; f[18] = false; f[19] = false; f[20] = 14; return f; }));
        check("warnings: no email, sign-up without Turnstile, no scanning (kept sign-ins need none: their cookie is HttpOnly)",
                warn.problems().isEmpty() && warn.warnings().size() == 3);
        check("development isn't checked", !ProductionGuard.check(with(f -> { f[0] = "development"; f[3] = true; return f; })).production());
        check("auto: a remote database means production", ProductionGuard.isProduction("auto", "jdbc:mysql://db.example.com/n")
                && !ProductionGuard.isProduction("auto", "jdbc:mysql://localhost:3306/n") && !ProductionGuard.isProduction("auto", "jdbc:h2:mem:t"));
        check("staging is checked like production", ProductionGuard.isProduction("staging", "jdbc:h2:mem:t"));
        ProductionGuard.Result memory = ProductionGuard.check(with(f -> { f[22] = "memory"; return f; }));
        check("rate limits counted per instance are a warning, not a refusal", memory.problems().isEmpty()
                && memory.warnings().size() == 1 && memory.warnings().get(0).contains("RATE_LIMIT_STORE"));
        check("auto and database count rate limits in the database in production", ProductionGuard.check(with(f -> { f[22] = "database"; return f; })).warnings().isEmpty()
                && dev.projectflow.security.RateCounts.store("auto", true).equals("database")
                && dev.projectflow.security.RateCounts.store("auto", false).equals("memory")
                && dev.projectflow.security.RateCounts.store(" Shared ", false).equals("database")
                && dev.projectflow.security.RateCounts.store("local", true).equals("memory"));
        org.assertj.core.api.Assertions.assertThat(results.stream().filter(r -> r.startsWith("FAIL")).toList()).as("failed checks").isEmpty();
    }
}
