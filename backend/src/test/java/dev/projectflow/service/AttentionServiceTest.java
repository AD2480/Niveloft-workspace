package dev.projectflow.service;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import org.junit.jupiter.api.Test;

/** The wording helpers that make attention items readable. */
class AttentionServiceTest {

    @Test
    void relativeDays() {
        LocalDate today = LocalDate.of(2026, 9, 26);
        assertThat(AttentionService.relativeDay(today, today)).isEqualTo("today");
        assertThat(AttentionService.relativeDay(today.plusDays(1), today)).isEqualTo("tomorrow");
        assertThat(AttentionService.relativeDay(today.minusDays(1), today)).isEqualTo("yesterday");
        assertThat(AttentionService.relativeDay(today.plusDays(5), today)).isEqualTo("in 5 days (1 Oct)");
        assertThat(AttentionService.relativeDay(today.minusDays(4), today)).isEqualTo("4 days ago (22 Sep)");
    }

    @Test
    void ago() {
        Instant now = Instant.parse("2026-09-26T12:00:00Z");
        assertThat(AttentionService.ago(now.minus(10, ChronoUnit.MINUTES), now)).isEqualTo("just now");
        assertThat(AttentionService.ago(now.minus(3, ChronoUnit.HOURS), now)).isEqualTo("3 hours ago");
        assertThat(AttentionService.ago(now.minus(1, ChronoUnit.DAYS), now)).isEqualTo("yesterday");
        assertThat(AttentionService.ago(now.minus(6, ChronoUnit.DAYS), now)).isEqualTo("6 days ago");
    }

    @Test
    void searchRanking() {
        assertThat(SearchService.rank("ccp-5", "CCP-5", "Login")).isZero();
        assertThat(SearchService.rank("ccp", "CCP-5", "Login")).isEqualTo(1);
        assertThat(SearchService.rank("log", "CCP-5", "Login page")).isEqualTo(2);
        assertThat(SearchService.rank("page", "CCP-5", "Login page")).isEqualTo(3);
        assertThat(SearchService.rank("zzz", "CCP-5", "Login page")).isEqualTo(-1);
    }
}
