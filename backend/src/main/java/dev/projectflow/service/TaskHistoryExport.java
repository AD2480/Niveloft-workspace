package dev.projectflow.service;

import dev.projectflow.domain.*;
import dev.projectflow.repository.ReviewRepository;
import dev.projectflow.repository.SubmissionRepository;
import dev.projectflow.repository.TaskDependencyRepository;
import dev.projectflow.repository.TaskRepository;
import dev.projectflow.repository.TaskStatusEventRepository;
import dev.projectflow.security.ProjectAccess;
import dev.projectflow.web.error.ApiException;
import java.time.Instant;
import java.util.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * One project's task history as CSV, for training a deadline forecast on your own work (the
 * {@code ml/} kit in the repository reads it). Owners and managers only.
 *
 * <p>It holds what a forecast learns from (dates, estimates, priorities, dependencies and counts)
 * and nothing people wrote: no titles, descriptions, comments, evidence or names. People appear
 * as p1, p2, … in the order they first own a task in this file, so a file can be shared with
 * whoever trains the model without naming anyone. The pseudonyms are per file, not stable across
 * downloads.
 *
 * <p>{@code submissions} and {@code changes_requested} are outcomes, known only after the work; the
 * kit uses them for analysis, never as predictors.
 */
@Service
public class TaskHistoryExport {

    /** The columns, in order. Version 1 of the format (the file name says so). */
    public static final List<String> COLUMNS = List.of(
            "project", "task", "status", "priority", "estimate_days", "person",
            "created_at", "started_at", "blockers_approved_at", "last_review_at", "approved_at", "due_date",
            "waits_on", "holds_up", "criteria", "checklist", "description_chars", "submissions", "changes_requested");

    /** A file can't be unbounded; a project with more tasks than this is exported up to it, oldest first. */
    static final int MAX_TASKS = 20_000;

    public record Export(String fileName, String csv, int rows) {}

    private final ProjectAccess access;
    private final TaskRepository tasks;
    private final TaskDependencyRepository dependencies;
    private final TaskStatusEventRepository events;
    private final SubmissionRepository submissions;
    private final ReviewRepository reviews;

    public TaskHistoryExport(ProjectAccess access, TaskRepository tasks, TaskDependencyRepository dependencies, TaskStatusEventRepository events,
                             SubmissionRepository submissions, ReviewRepository reviews) {
        this.access = access;
        this.tasks = tasks;
        this.dependencies = dependencies;
        this.events = events;
        this.submissions = submissions;
        this.reviews = reviews;
    }

    @Transactional(readOnly = true)
    public Export export(Long projectId) {
        ProjectAccess.Access a = access.require(projectId);
        if (!a.role().atLeast(Role.MANAGER)) throw ApiException.forbidden("Only the project’s owners and managers can download its task history.");
        List<Submission> subs = submissions.findByProjectId(projectId);
        List<Review> decided = subs.isEmpty() ? List.of() : reviews.findBySubmissionIdIn(subs.stream().map(Submission::getId).toList());
        String key = a.project().getKey();
        String csv = csv(key, tasks.findByProjectId(projectId), dependencies.findByProjectId(projectId), events.findByProjectIdOrderByOccurredAtAscIdAsc(projectId), subs, decided);
        int rows = (int) csv.chars().filter(c -> c == '\n').count() - 1;
        return new Export(key + "-task-history-v1.csv", csv, rows);
    }

    /** A project's history as the forecast trial reads it: the same file, and each task's id by key. */
    public record Snapshot(String csv, Map<String, Long> taskIds) {}

    /**
     * The same file for the forecast model trial, which runs the kit's features on it. The caller
     * has checked that the person is a member; nothing in it names anyone or quotes anything.
     */
    @Transactional(readOnly = true)
    public Snapshot snapshot(Long projectId, String projectKey) {
        List<Task> list = tasks.findByProjectId(projectId);
        List<Submission> subs = submissions.findByProjectId(projectId);
        List<Review> decided = subs.isEmpty() ? List.of() : reviews.findBySubmissionIdIn(subs.stream().map(Submission::getId).toList());
        String csv = csv(projectKey, list, dependencies.findByProjectId(projectId), events.findByProjectIdOrderByOccurredAtAscIdAsc(projectId), subs, decided);
        Map<String, Long> ids = new HashMap<>();
        for (Task t : list) ids.put(DtoMapper.taskKey(t), t.getId());
        return new Snapshot(csv, ids);
    }

    /** The file itself, from the records. No I/O, so it's tested with records built in memory. */
    static String csv(String projectKey, List<Task> taskList, List<TaskDependency> deps, List<TaskStatusEvent> history, List<Submission> subs, List<Review> decided) {
        List<Task> ordered = new ArrayList<>(taskList);
        ordered.sort(Comparator.comparingInt(Task::getNumber));
        if (ordered.size() > MAX_TASKS) ordered = ordered.subList(0, MAX_TASKS);

        Map<Long, List<Task>> waitsOn = new HashMap<>();
        Map<Long, Integer> holdsUp = new HashMap<>();
        for (TaskDependency d : deps) {
            waitsOn.computeIfAbsent(d.getBlocked().getId(), k -> new ArrayList<>()).add(d.getBlocker());
            holdsUp.merge(d.getBlocker().getId(), 1, Integer::sum);
        }
        Map<Long, List<Instant>> reviewEntries = new HashMap<>();
        for (TaskStatusEvent e : history) {
            if (e.getToStatus() == TaskStatus.IN_REVIEW) reviewEntries.computeIfAbsent(e.getTask().getId(), k -> new ArrayList<>()).add(e.getOccurredAt());
        }
        Map<Long, Integer> submissionCount = new HashMap<>();
        Map<Long, Long> taskOfSubmission = new HashMap<>();
        for (Submission s : subs) {
            submissionCount.merge(s.getTask().getId(), 1, Integer::sum);
            taskOfSubmission.put(s.getId(), s.getTask().getId());
        }
        Map<Long, Integer> changesRequested = new HashMap<>();
        for (Review r : decided) {
            if (r.getDecision() == ReviewDecision.CHANGES_REQUESTED) {
                Long taskId = taskOfSubmission.get(r.getSubmission().getId());
                if (taskId != null) changesRequested.merge(taskId, 1, Integer::sum);
            }
        }

        Map<Long, String> people = new LinkedHashMap<>();
        StringBuilder out = new StringBuilder(String.join(",", COLUMNS)).append('\n');
        for (Task t : ordered) {
            String person = "";
            if (t.getAssignee() != null) person = people.computeIfAbsent(t.getAssignee().getId(), k -> "p" + (people.size() + 1));
            Instant approved = t.getStatus() == TaskStatus.DONE ? t.getCompletedAt() : null;
            // When everything it waited on was approved; empty when it waits on nothing or on work not approved yet.
            List<Task> blockers = waitsOn.getOrDefault(t.getId(), List.of());
            Instant blockersApproved = null;
            if (!blockers.isEmpty() && blockers.stream().allMatch(b -> b.getStatus() == TaskStatus.DONE && b.getCompletedAt() != null)) {
                blockersApproved = blockers.stream().map(Task::getCompletedAt).max(Comparator.naturalOrder()).orElse(null);
            }
            // The last time it went to review (before its approval, when it's approved).
            Instant lastReview = reviewEntries.getOrDefault(t.getId(), List.of()).stream()
                    .filter(at -> approved == null || !at.isAfter(approved))
                    .max(Comparator.naturalOrder()).orElse(null);
            List<String> row = List.of(
                    projectKey,
                    DtoMapper.taskKey(t),
                    t.getStatus().name(),
                    t.getPriority().name(),
                    t.getEstimateDays() == null ? "" : t.getEstimateDays().toString(),
                    person,
                    instant(t.getCreatedAt()),
                    instant(t.getStartedAt()),
                    instant(blockersApproved),
                    instant(lastReview),
                    instant(approved),
                    t.getDueDate() == null ? "" : t.getDueDate().toString(),
                    Integer.toString(blockers.size()),
                    Integer.toString(holdsUp.getOrDefault(t.getId(), 0)),
                    Integer.toString(t.getCriteria().size()),
                    Integer.toString(t.getChecklist().size()),
                    Integer.toString(t.getDescription() == null ? 0 : t.getDescription().length()),
                    Integer.toString(submissionCount.getOrDefault(t.getId(), 0)),
                    Integer.toString(changesRequested.getOrDefault(t.getId(), 0)));
            out.append(String.join(",", row.stream().map(TaskHistoryExport::cell).toList())).append('\n');
        }
        return out.toString();
    }

    private static String instant(Instant at) {
        return at == null ? "" : at.toString();
    }

    /** Every value here is a key, a name of a state, a number or a date; quoted anyway if that ever changes. */
    static String cell(String v) {
        if (v == null) return "";
        boolean quote = v.contains(",") || v.contains("\"") || v.contains("\n") || v.contains("\r");
        // A leading = + - @ would be read as a formula by spreadsheets.
        String safe = !v.isEmpty() && "=+-@".indexOf(v.charAt(0)) >= 0 ? "'" + v : v;
        return quote ? "\"" + safe.replace("\"", "\"\"") + "\"" : safe;
    }
}
