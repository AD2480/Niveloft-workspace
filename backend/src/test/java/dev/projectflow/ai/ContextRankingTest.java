package dev.projectflow.ai;

import static org.assertj.core.api.Assertions.assertThat;

import dev.projectflow.domain.TaskStatus;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

/** Which tasks a big project's question lists: named, matching, open, recent; in key order. */
class ContextRankingTest {

    private static List<ContextRanking.Task> project() {
        List<ContextRanking.Task> all = new ArrayList<>();
        Instant base = Instant.parse("2026-01-01T00:00:00Z");
        for (int i = 1; i <= 300; i++) {
            TaskStatus status = i <= 200 ? TaskStatus.DONE : i <= 260 ? TaskStatus.TODO : i <= 285 ? TaskStatus.IN_PROGRESS : TaskStatus.IN_REVIEW;
            String title = i == 3 ? "Deployment pipeline for staging" : i == 7 ? "Write release notes" : "Task number " + i;
            all.add(new ContextRanking.Task((long) i, i, "ONB-" + i, title, status, i == 250, i == 255, base.plusSeconds(i * 3600L)));
        }
        return all;
    }

    @Test
    void listsWhatTheQuestionNeedsFirst() {
        List<Integer> numbers = ContextRanking.pick(project(), "Is the deploy pipeline ready? And ONB-17?", List.of("Earlier: what about ONB-12"), 120)
                .stream().map(ContextRanking.Task::number).toList();
        assertThat(numbers).hasSize(120).contains(17, 12, 3).contains(286, 300, 261, 285, 250, 255).doesNotContain(7, 1);
        assertThat(numbers).isSorted();
    }

    @Test
    void smallProjectsAreListedWholeAndKeysMatchWhole() {
        assertThat(ContextRanking.pick(project().subList(0, 10), "x", List.of(), 50)).hasSize(10);
        assertThat(ContextRanking.named("ABOUT ONB-12 AND ONB-170", "ONB-1")).isFalse();
        assertThat(ContextRanking.named("WHAT ABOUT (ONB-1)?", "onb-1")).isTrue();
        assertThat(ContextRanking.alike("deployment", "deploy")).isTrue();
        assertThat(ContextRanking.alike("api", "apis")).isFalse();
    }
}
