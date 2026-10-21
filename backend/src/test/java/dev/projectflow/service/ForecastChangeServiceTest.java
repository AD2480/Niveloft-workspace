package dev.projectflow.service;

import static org.assertj.core.api.Assertions.assertThat;

import dev.projectflow.domain.Activity;
import dev.projectflow.domain.ActivityType;
import dev.projectflow.domain.ProjectMember;
import dev.projectflow.domain.User;
import dev.projectflow.web.dto.Dto;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** The changes a forecast replay reads: normalised values, ids only where a name is unambiguous. */
class ForecastChangeServiceTest {

    private static final Map<Long, String> KEYS = Map.of(54L, "ONB-9", 55L, "ONB-10");
    private static final Map<String, Long> IDS = Map.of("ONB-9", 54L, "ONB-10", 55L);

    private static Activity change(ActivityType type, String field, String oldValue, String newValue) {
        Activity a = new Activity();
        a.setType(type);
        a.setTaskId(54L);
        a.setFieldName(field);
        a.setOldValue(oldValue);
        a.setNewValue(newValue);
        a.setCreatedAt(Instant.parse("2026-10-15T09:00:00Z"));
        return a;
    }

    private static ProjectMember member(long id, String name) {
        User u = new User();
        u.setId(id);
        u.setName(name);
        ProjectMember m = new ProjectMember();
        m.setUser(u);
        return m;
    }

    @Test
    void valuesComeBackInTheFormsAReplayReads() {
        Map<String, Long> people = ForecastChangeService.uniqueNames(List.of(member(1, "Aarav Shah"), member(2, "Maya Chen"), member(3, "Sam Lee"), member(4, "Sam Lee")));
        assertThat(people).containsOnlyKeys("Aarav Shah", "Maya Chen");

        Dto.FieldChange estimate = ForecastChangeService.normalise(change(ActivityType.TASK_UPDATED, "estimate", "3 working days", "1 working day"), KEYS, IDS, people);
        assertThat(estimate.oldValue()).isEqualTo("3");
        assertThat(estimate.newValue()).isEqualTo("1");
        assertThat(estimate.taskKey()).isEqualTo("ONB-9");
        assertThat(ForecastChangeService.normalise(change(ActivityType.PLAN_APPLIED, "estimate", null, "5 working days"), KEYS, IDS, people).oldValue()).isNull();

        assertThat(ForecastChangeService.normalise(change(ActivityType.TASK_UPDATED, "priority", "Medium", "Urgent"), KEYS, IDS, people).newValue()).isEqualTo("URGENT");
        assertThat(ForecastChangeService.normalise(change(ActivityType.TASK_UPDATED, "dueDate", "2026-10-20", "not a date"), KEYS, IDS, people).newValue()).isNull();

        Dto.FieldChange owner = ForecastChangeService.normalise(change(ActivityType.TASK_ASSIGNED, "assignee", "Sam Lee", "Maya Chen"), KEYS, IDS, people);
        assertThat(owner.oldUserId()).isNull(); // two members are called Sam Lee: not guessed
        assertThat(owner.newUserId()).isEqualTo(2L);
        assertThat(owner.oldValue()).isEqualTo("Sam Lee");

        Dto.FieldChange added = ForecastChangeService.normalise(change(ActivityType.DEPENDENCY_ADDED, "dependency", null, "ONB-10"), KEYS, IDS, people);
        assertThat(added.blockerId()).isEqualTo(55L);
        Dto.FieldChange gone = ForecastChangeService.normalise(change(ActivityType.DEPENDENCY_REMOVED, "dependency", "ONB-77", null), KEYS, IDS, people);
        assertThat(gone.blockerId()).isNull(); // a blocker deleted since: its key is kept, its id is unknown
        assertThat(gone.oldValue()).isEqualTo("ONB-77");
    }

    @Test
    void editsAReplayDoesntNeedAreLeftOut() {
        assertThat(ForecastChangeService.normalise(change(ActivityType.TASK_UPDATED, "title", "a", "b"), KEYS, IDS, Map.of())).isNull();
        assertThat(ForecastChangeService.normalise(change(ActivityType.TASK_UPDATED, "description", null, null), KEYS, IDS, Map.of())).isNull();
        Activity orphan = change(ActivityType.TASK_UPDATED, "estimate", "1 working day", "2 working days");
        orphan.setTaskId(99L);
        assertThat(ForecastChangeService.normalise(orphan, KEYS, IDS, Map.of())).isNull();
        assertThat(ForecastChangeService.number("12 working days")).isEqualTo("12");
        assertThat(ForecastChangeService.number("none")).isNull();
    }
}
