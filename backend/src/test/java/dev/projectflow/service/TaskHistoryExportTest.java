package dev.projectflow.service;

import static org.assertj.core.api.Assertions.assertThat;

import dev.projectflow.domain.*;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import org.junit.jupiter.api.Test;

/** The task-history file: its columns, what it leaves out, and how it reads the records. */
class TaskHistoryExportTest {

    private static User user(long id, String name) {
        User u = new User();
        u.setId(id);
        u.setName(name);
        u.setEmail(name.toLowerCase().replace(' ', '.') + "@example.com");
        return u;
    }

    private static Task task(long id, Project p, int number, TaskStatus status, User owner, Integer estimate, String created, String started, String approved) {
        Task t = new Task();
        t.setId(id);
        t.setProject(p);
        t.setNumber(number);
        t.setTitle("Secret title " + number);
        t.setDescription("Private notes about " + number);
        t.setStatus(status);
        t.setPriority(Priority.HIGH);
        t.setAssignee(owner);
        t.setEstimateDays(estimate);
        t.setCreatedAt(Instant.parse(created));
        t.setStartedAt(started == null ? null : Instant.parse(started));
        t.setCompletedAt(approved == null ? null : Instant.parse(approved));
        return t;
    }

    private static TaskStatusEvent toReview(Task t, String at) {
        TaskStatusEvent e = new TaskStatusEvent();
        e.setTask(t);
        e.setFromStatus(TaskStatus.IN_PROGRESS);
        e.setToStatus(TaskStatus.IN_REVIEW);
        e.setOccurredAt(Instant.parse(at));
        return e;
    }

    @Test
    void writesWhatAForecastLearnsFromAndNothingPeopleWrote() {
        Project p = new Project();
        p.setId(6L);
        p.setKey("ONB");
        User maya = user(2, "Maya Chen"), rohan = user(3, "Rohan Mehta");
        Task api = task(54, p, 9, TaskStatus.DONE, maya, 3, "2026-09-01T09:00:00Z", "2026-09-02T09:00:00Z", "2026-09-09T15:00:00Z");
        api.setDueDate(LocalDate.of(2026, 9, 8));
        Task screens = task(55, p, 10, TaskStatus.IN_PROGRESS, rohan, null, "2026-09-01T09:00:00Z", "2026-09-10T09:00:00Z", null);
        Task copy = task(56, p, 11, TaskStatus.TODO, null, 2, "2026-09-03T09:00:00Z", null, null);
        Task more = task(57, p, 12, TaskStatus.TODO, maya, 1, "2026-09-04T09:00:00Z", null, null);

        TaskDependency dep = new TaskDependency();
        dep.setProjectId(6L);
        dep.setBlocker(api);
        dep.setBlocked(screens);

        Submission first = new Submission();
        first.setId(70L);
        first.setTask(api);
        first.setNumber(1);
        Submission second = new Submission();
        second.setId(71L);
        second.setTask(api);
        second.setNumber(2);
        Review changes = new Review();
        changes.setSubmission(first);
        changes.setDecision(ReviewDecision.CHANGES_REQUESTED);
        Review approved = new Review();
        approved.setSubmission(second);
        approved.setDecision(ReviewDecision.APPROVED);

        String csv = TaskHistoryExport.csv("ONB", List.of(more, copy, screens, api), List.of(dep),
                List.of(toReview(api, "2026-09-05T10:00:00Z"), toReview(api, "2026-09-08T10:00:00Z")), List.of(first, second), List.of(changes, approved));
        List<String> lines = csv.lines().toList();

        assertThat(lines.get(0)).isEqualTo(String.join(",", TaskHistoryExport.COLUMNS));
        assertThat(lines).hasSize(5);
        // In task order; people as p1, p2 in order of first appearance; the unassigned task has none.
        assertThat(lines.get(1)).isEqualTo("ONB,ONB-9,DONE,HIGH,3,p1,2026-09-01T09:00:00Z,2026-09-02T09:00:00Z,,2026-09-08T10:00:00Z,2026-09-09T15:00:00Z,2026-09-08,0,1,0,0,21,2,1");
        assertThat(lines.get(2)).isEqualTo("ONB,ONB-10,IN_PROGRESS,HIGH,,p2,2026-09-01T09:00:00Z,2026-09-10T09:00:00Z,2026-09-09T15:00:00Z,,,,1,0,0,0,22,0,0");
        assertThat(lines.get(3)).startsWith("ONB,ONB-11,TODO,HIGH,2,,");
        assertThat(lines.get(4)).startsWith("ONB,ONB-12,TODO,HIGH,1,p1,");
        // No titles, descriptions, names or emails.
        assertThat(csv).doesNotContain("Secret", "Private", "Maya", "Rohan", "example.com");
    }

    @Test
    void neverLetsASpreadsheetReadACellAsAFormula() {
        assertThat(TaskHistoryExport.cell("=SUM(A1)")).isEqualTo("'=SUM(A1)");
        assertThat(TaskHistoryExport.cell("a,b")).isEqualTo("\"a,b\"");
        assertThat(TaskHistoryExport.cell("ONB-9")).isEqualTo("ONB-9");
    }
}
