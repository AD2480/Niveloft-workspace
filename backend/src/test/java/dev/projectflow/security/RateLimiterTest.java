package dev.projectflow.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.projectflow.config.AppProperties;
import dev.projectflow.web.error.ApiException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import org.junit.jupiter.api.Test;

class RateLimiterTest {

    private final AppProperties on = new AppProperties(null, null, null, null, null, null, null, null,
            new AppProperties.BotProtection(true, null, null, 1), null);
    private final Clock clock = Clock.fixed(Instant.parse("2026-09-27T00:00:00Z"), ZoneOffset.UTC);

    @Test
    void blocksAfterTheLimitPerKey() {
        RateLimiter limiter = new RateLimiter(on, clock);
        for (int i = 0; i < 5; i++) limiter.check("register-ip", "1.2.3.4", 5, Duration.ofHours(1));
        assertThatThrownBy(() -> limiter.check("register-ip", "1.2.3.4", 5, Duration.ofHours(1)))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("Too many attempts");
        limiter.check("register-ip", "5.6.7.8", 5, Duration.ofHours(1)); // another address is unaffected
    }

    @Test
    void onlyRecordedFailuresCount() {
        RateLimiter limiter = new RateLimiter(on, clock);
        for (int i = 0; i < 20; i++) limiter.ensureUnder("login-fail", "k", 3, Duration.ofMinutes(15));
        for (int i = 0; i < 3; i++) limiter.record("login-fail", "k", Duration.ofMinutes(15));
        assertThatThrownBy(() -> limiter.ensureUnder("login-fail", "K", 3, Duration.ofMinutes(15))).isInstanceOf(ApiException.class);
    }
}
