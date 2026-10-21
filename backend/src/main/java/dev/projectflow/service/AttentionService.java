package dev.projectflow.service;

import dev.projectflow.domain.*;
import dev.projectflow.repository.MilestoneRepository;
import dev.projectflow.repository.ReviewRepository;
import dev.projectflow.repository.SubmissionRepository;
import dev.projectflow.repository.TaskDependencyRepository;
import dev.projectflow.web.dto.Dto;
import java.time.*;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.*;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;

/**
 * Mission Control: "what needs attention" for one user, computed from stored records.
 *
 * <p>Every item names the rule that raised it and the records it refers to (task keys,
 * milestone names, people), so the UI never shows a risk it cannot explain. There are no
 * scores or rankings of people; workload items state counts and the tasks behind them.
 *
 * <p>Rules (all thresholds are constants below):
 * <ul>
 *   <li>REVIEW_WAITING — a pending submission the user may review (HIGH after {@value #REVIEW_WAIT_DAYS} days or if the task is overdue).</li>
 *   <li>CHANGES_REQUESTED — the user's task was sent back; lists the unmet criteria count.</li>
 *   <li>OVERDUE — the user's open task is past due.</li>
 *   <li>DUE_SOON — the user's task is due within {@value #DUE_SOON_DAYS} days and not started.</li>
 *   <li>AWAITING_REVIEW — the user's own submission has waited more than {@value #REVIEW_WAIT_DAYS} days.</li>
 *   <li>PROJECT_RISK — (managers) the project's health is At risk or Off track; reasons come from {@link HealthCalculator}.</li>
 *   <li>MILESTONE_RISK — (managers) an open milestone due within {@value #MILESTONE_WINDOW_DAYS} days, or overdue, still has open tasks.</li>
 *   <li>WORKLOAD — (managers) a person holds {@value #OVERDUE_PER_PERSON} or more overdue tasks across the projects the user manages.</li>
 *   <li>UNASSIGNED — (managers) open tasks due within {@value #MILESTONE_WINDOW_DAYS} days have no assignee.</li>
 *   <li>BLOCKED — the user's task depends on an unfinished task that is overdue or due after it.</li>
 *   <li>BLOCKING — (managers) an overdue task is holding up other open tasks.</li>
 * </ul>
 */
@Service
public class AttentionService {

    static final int REVIEW_WAIT_DAYS = 2;
    static final int DUE_SOON_DAYS = 3;
    static final int MILESTONE_WINDOW_DAYS = 7;
    static final int OVERDUE_PER_PERSON = 2;
    static final int APPROVED_WINDOW_DAYS = 14;
    static final int MAX_ITEMS = 14;

    private static final DateTimeFormatter DAY = DateTimeFormatter.ofPattern("d MMM", Locale.ENGLISH);
    private static final Map<String, Integer> SEVERITY_RANK = Map.of("HIGH", 0, "MEDIUM", 1, "LOW", 2);

    private final SubmissionRepository submissions;
    private final ReviewRepository reviews;
    private final MilestoneRepository milestones;
    private final TaskDependencyRepository dependencies;
    private final DtoMapper mapper;
    private final Clock clock;

    public AttentionService(SubmissionRepository submissions, ReviewRepository reviews, MilestoneRepository milestones,
                            TaskDependencyRepository dependencies, DtoMapper mapper, Clock clock) {
        this.dependencies = dependencies;
        this.submissions = submissions;
        this.reviews = reviews;
        this.milestones = milestones;
        this.mapper = mapper;
        this.clock = clock;
    }

    /** Result of one pass over the user's projects. */
    public record Result(List<Dto.AttentionItem> attention, List<Dto.ApprovedItem> recentlyApproved) {}

    // ------------------------------------------------------------------ wording

    static String ago(Instant when, Instant now) {
        long days = ChronoUnit.DAYS.between(when, now);
        if (days <= 0) {
            long hours = ChronoUnit.HOURS.between(when, now);
            return hours <= 0 ? "just now" : hours + (hours == 1 ? " hour ago" : " hours ago");
        }
        return days == 1 ? "yesterday" : days + " days ago";
    }

    static String relativeDay(LocalDate d, LocalDate today) {
        long n = ChronoUnit.DAYS.between(today, d);
        if (n == 0) return "today";
        if (n == 1) return "tomorrow";
        if (n == -1) return "yesterday";
        return n > 0 ? "in " + n + " days (" + DAY.format(d) + ")" : Math.abs(n) + " days ago (" + DAY.format(d) + ")";
    }

    private static String keys(List<Task> list, int max) {
        String shown = list.stream().limit(max).map(DtoMapper::taskKey).collect(Collectors.joining(", "));
        return list.size() > max ? shown + " and " + (list.size() - max) + " more" : shown;
    }

    private static List<String> refs(List<Task> list, int max) {
        return list.stream().limit(max).map(DtoMapper::taskKey).toList();
    }

    private static String plural(long n, String one, String many) {
        return n + " " + (n == 1 ? one : many);
    }

    private static String reviewLink(Task t) {
        return TaskService.link(t) + "/review";
    }

    // ------------------------------------------------------------------ compute

    public Result compute(Long userId, Map<Long, Role> roles, List<Project> projects, List<Task> all) {
        LocalDate today = mapper.today();
        Instant now = Instant.now(clock);
        List<Long> ids = projects.stream().map(Project::getId).toList();
        List<Dto.AttentionItem> items = new ArrayList<>();

        List<Submission> subs = ids.isEmpty() ? List.of() : submissions.findByProjectIds(ids);
        Map<Long, Review> reviewBySubmission = subs.isEmpty() ? Map.of()
                : reviews.findBySubmissionIdIn(subs.stream().map(Submission::getId).toList()).stream()
                        .collect(Collectors.toMap(r -> r.getSubmission().getId(), Function.identity(), (a, b) -> a));
        Map<Long, List<Submission>> subsByTask = subs.stream().collect(Collectors.groupingBy(s -> s.getTask().getId()));
        subsByTask.values().forEach(l -> l.sort(Comparator.comparingInt(Submission::getNumber).reversed()));

        // 1. Reviews the user can make ------------------------------------------------
        for (Submission s : subs) {
            Task t = s.getTask();
            if (s.getStatus() != SubmissionStatus.PENDING || t.getStatus() != TaskStatus.IN_REVIEW) continue;
            if (!Permissions.reviewSubmission(roles.get(t.getProject().getId()), s.getSubmittedBy().getId(), userId)) continue;
            long waited = ChronoUnit.DAYS.between(s.getCreatedAt(), now);
            boolean overdue = DtoMapper.isOverdue(t, today);
            int criteria = s.getCriteria().size();
            String reason = s.getSubmittedBy().getName() + " submitted version " + s.getNumber() + " " + ago(s.getCreatedAt(), now) + ". "
                    + (criteria == 0 ? "No acceptance criteria were set, so judge it from the notes and evidence." : plural(criteria, "acceptance criterion", "acceptance criteria") + " to check.")
                    + (overdue ? " The task was due " + relativeDay(t.getDueDate(), today) + "." : "");
            items.add(item("review-" + s.getId(), "REVIEW_WAITING", waited >= REVIEW_WAIT_DAYS || overdue ? "HIGH" : "MEDIUM",
                    "Review " + DtoMapper.taskKey(t) + ": " + t.getTitle(), reason, List.of(DtoMapper.taskKey(t)), reviewLink(t), t.getProject(), t.getDueDate()));
        }

        List<TaskDependency> deps = ids.isEmpty() ? List.of() : dependencies.findByProjectIdIn(ids);
        Map<Long, List<Task>> openBlockersOf = new HashMap<>();
        Map<Long, List<Task>> openBlockedBy = new HashMap<>();
        for (TaskDependency d : deps) {
            if (d.getBlocker().getStatus() == TaskStatus.DONE || d.getBlocked().getStatus() == TaskStatus.DONE) continue;
            openBlockersOf.computeIfAbsent(d.getBlocked().getId(), k -> new ArrayList<>()).add(d.getBlocker());
            openBlockedBy.computeIfAbsent(d.getBlocker().getId(), k -> new ArrayList<>()).add(d.getBlocked());
        }

        // 2-5. The user's own work ------------------------------------------------------
        List<Task> mine = all.stream().filter(t -> t.getAssignee() != null && t.getAssignee().getId().equals(userId) && t.getStatus() != TaskStatus.DONE).toList();
        for (Task t : mine) {
            List<Submission> history = subsByTask.getOrDefault(t.getId(), List.of());
            Submission latest = history.isEmpty() ? null : history.get(0);
            String key = DtoMapper.taskKey(t);
            boolean overdue = DtoMapper.isOverdue(t, today);
            String dueNote = overdue ? " It was due " + relativeDay(t.getDueDate(), today) + "." : "";

            if (t.getStatus() == TaskStatus.IN_PROGRESS && latest != null && latest.getStatus() == SubmissionStatus.CHANGES_REQUESTED) {
                Review r = reviewBySubmission.get(latest.getId());
                String who = r == null ? "A reviewer" : r.getReviewer().getName();
                String when = r == null ? "" : " " + ago(r.getCreatedAt(), now);
                long unmet = r == null ? 0 : r.getResults().stream().filter(x -> !x.isMet()).count();
                long total = r == null ? 0 : r.getResults().size();
                String detail = total > 0 ? ": " + unmet + " of " + plural(total, "criterion", "criteria") + " not met." : ".";
                items.add(item("changes-" + t.getId(), "CHANGES_REQUESTED", "HIGH", "Changes requested on " + key + ": " + t.getTitle(),
                        who + " requested changes on version " + latest.getNumber() + when + detail + dueNote, List.of(key), TaskService.link(t), t.getProject(), t.getDueDate()));
                    continue;
            }
            List<Task> blockers = openBlockersOf.getOrDefault(t.getId(), List.of());
            List<Task> lateBlockers = blockers.stream().filter(b -> DtoMapper.isOverdue(b, today)).toList();
            List<Task> laterBlockers = blockers.stream().filter(b -> !DtoMapper.isOverdue(b, today) && b.getDueDate() != null
                    && t.getDueDate() != null && !b.getDueDate().isBefore(t.getDueDate())).toList();
            if (t.getStatus() != TaskStatus.IN_REVIEW && (!lateBlockers.isEmpty() || !laterBlockers.isEmpty())) {
                Task b = !lateBlockers.isEmpty() ? lateBlockers.get(0) : laterBlockers.get(0);
                String owner = b.getAssignee() == null ? "unassigned" : b.getAssignee().getName();
                String why = !lateBlockers.isEmpty()
                        ? "It depends on " + DtoMapper.taskKey(b) + " (" + owner + "), which was due " + relativeDay(b.getDueDate(), today) + " and is still " + TaskService.label(b.getStatus()).toLowerCase() + "."
                        : "It depends on " + DtoMapper.taskKey(b) + " (" + owner + "), due " + relativeDay(b.getDueDate(), today) + ", which is not before this task’s own due date (" + DAY.format(t.getDueDate()) + ").";
                if (blockers.size() > 1) why += " " + plural(blockers.size(), "unfinished blocker", "unfinished blockers") + " in total: " + keys(blockers, 4) + ".";
                List<String> r = new ArrayList<>(List.of(key));
                blockers.stream().limit(3).map(DtoMapper::taskKey).forEach(r::add);
                items.add(item("blocked-" + t.getId(), "BLOCKED", !lateBlockers.isEmpty() ? "HIGH" : "MEDIUM", key + " is blocked: " + t.getTitle(),
                        why + dueNote, r, TaskService.link(t), t.getProject(), t.getDueDate()));
                continue;
            }
            if (overdue && t.getStatus() != TaskStatus.IN_REVIEW) {
                items.add(item("overdue-" + t.getId(), "OVERDUE", "HIGH", key + " is overdue: " + t.getTitle(),
                        "Due " + relativeDay(t.getDueDate(), today) + " and still " + TaskService.label(t.getStatus()).toLowerCase() + ".", List.of(key), TaskService.link(t), t.getProject(), t.getDueDate()));
                    continue;
            }
            if (t.getStatus() == TaskStatus.TODO && t.getDueDate() != null && !t.getDueDate().isAfter(today.plusDays(DUE_SOON_DAYS))) {
                items.add(item("soon-" + t.getId(), "DUE_SOON", "MEDIUM", key + " is due soon: " + t.getTitle(),
                        "Due " + relativeDay(t.getDueDate(), today) + " and not started yet.", List.of(key), TaskService.link(t), t.getProject(), t.getDueDate()));
                    continue;
            }
            if (t.getStatus() == TaskStatus.IN_REVIEW && latest != null && latest.getStatus() == SubmissionStatus.PENDING
                    && ChronoUnit.DAYS.between(latest.getCreatedAt(), now) > REVIEW_WAIT_DAYS) {
                items.add(item("waiting-" + t.getId(), "AWAITING_REVIEW", "LOW", key + " is waiting for a reviewer",
                        "You submitted version " + latest.getNumber() + " " + ago(latest.getCreatedAt(), now) + " and nobody has reviewed it yet." + dueNote,
                        List.of(key), reviewLink(t), t.getProject(), t.getDueDate()));
            }
        }

        // 6-9. Projects the user manages ---------------------------------------------------
        Map<Long, List<Task>> byProject = all.stream().collect(Collectors.groupingBy(t -> t.getProject().getId()));
        Map<Long, List<Milestone>> msByProject = (ids.isEmpty() ? List.<Milestone>of() : milestones.findByProjectIdInOrderByDueDateAsc(ids)).stream()
                .collect(Collectors.groupingBy(m -> m.getProject().getId()));
        List<Task> managedOverdue = new ArrayList<>();
        for (Project p : projects) {
            if (!Permissions.atLeast(roles.get(p.getId()), Role.MANAGER)) continue;
            if (p.getStatus() == ProjectStatus.ARCHIVED || p.getStatus() == ProjectStatus.COMPLETED) continue;
            List<Task> list = byProject.getOrDefault(p.getId(), List.of());
            List<Task> overdueTasks = list.stream().filter(t -> DtoMapper.isOverdue(t, today))
                    .sorted(Comparator.comparing(Task::getDueDate)).toList();

            HealthCalculator.Result h = mapper.health(p, mapper.counts(list));
            if ("AT_RISK".equals(h.health()) || "OFF_TRACK".equals(h.health())) {
                String label = "OFF_TRACK".equals(h.health()) ? "off track" : "at risk";
                String because = String.join(" ", h.reasons());
                String examples = overdueTasks.isEmpty() ? "" : " Overdue: " + keys(overdueTasks, 3) + ".";
                items.add(item("project-" + p.getId(), "PROJECT_RISK", "OFF_TRACK".equals(h.health()) ? "HIGH" : "MEDIUM",
                        p.getName() + " is " + label, because + examples, refs(overdueTasks, 3), "/projects/" + p.getId(), p, p.getDeadline()));
            }

            for (Milestone m : msByProject.getOrDefault(p.getId(), List.of())) {
                if (m.isCompleted() || m.getDueDate().isAfter(today.plusDays(MILESTONE_WINDOW_DAYS))) continue;
                List<Task> scoped = list.stream().filter(t -> t.getMilestone() != null && t.getMilestone().getId().equals(m.getId())).toList();
                List<Task> open = scoped.stream().filter(t -> t.getStatus() != TaskStatus.DONE).toList();
                if (open.isEmpty()) continue;
                boolean late = m.getDueDate().isBefore(today);
                items.add(item("milestone-" + m.getId(), "MILESTONE_RISK", late ? "HIGH" : "MEDIUM",
                        "Milestone “" + m.getName() + "” " + (late ? "has passed" : "is close"),
                        open.size() + " of " + plural(scoped.size(), "task", "tasks") + " still open (" + keys(open, 3) + "); due " + relativeDay(m.getDueDate(), today) + ".",
                        refs(open, 4), "/projects/" + p.getId() + "/milestones", p, m.getDueDate()));
            }

            managedOverdue.addAll(overdueTasks);

            for (Task late : overdueTasks) {
                List<Task> waiting = openBlockedBy.getOrDefault(late.getId(), List.of());
                if (waiting.isEmpty()) continue;
                String owner = late.getAssignee() == null ? "unassigned" : late.getAssignee().getName();
                List<String> r = new ArrayList<>(List.of(DtoMapper.taskKey(late)));
                waiting.stream().limit(3).map(DtoMapper::taskKey).forEach(r::add);
                items.add(item("blocking-" + late.getId(), "BLOCKING", waiting.size() >= 2 ? "HIGH" : "MEDIUM",
                        DtoMapper.taskKey(late) + " is overdue and holding up " + plural(waiting.size(), "task", "tasks"),
                        DtoMapper.taskKey(late) + " (" + owner + ") was due " + relativeDay(late.getDueDate(), today) + " and blocks " + keys(waiting, 4) + ".",
                        r, TaskService.link(late), p, late.getDueDate()));
            }

            List<Task> unassigned = list.stream().filter(t -> t.getAssignee() == null && t.getStatus() != TaskStatus.DONE && t.getDueDate() != null
                    && !t.getDueDate().isAfter(today.plusDays(MILESTONE_WINDOW_DAYS))).sorted(Comparator.comparing(Task::getDueDate)).toList();
            if (!unassigned.isEmpty()) {
                items.add(item("unassigned-" + p.getId(), "UNASSIGNED", "LOW", plural(unassigned.size(), "task has", "tasks have") + " no assignee in " + p.getKey(),
                        keys(unassigned, 4) + (unassigned.size() == 1 ? " is" : " are") + " due within " + MILESTONE_WINDOW_DAYS + " days.",
                        refs(unassigned, 4), "/projects/" + p.getId() + "/tasks?assignee=unassigned", p, unassigned.get(0).getDueDate()));
            }
        }

        // Workload: one person holding several overdue tasks across the projects the user manages.
        Map<Long, List<Task>> overdueByPerson = managedOverdue.stream().filter(t -> t.getAssignee() != null && !t.getAssignee().getId().equals(userId))
                .collect(Collectors.groupingBy(t -> t.getAssignee().getId(), LinkedHashMap::new, Collectors.toList()));
        overdueByPerson.forEach((personId, theirs) -> {
            if (theirs.size() < OVERDUE_PER_PERSON) return;
            User u = theirs.get(0).getAssignee();
            List<Project> where = theirs.stream().map(Task::getProject).distinct().toList();
            long open = all.stream().filter(t -> t.getAssignee() != null && t.getAssignee().getId().equals(personId) && t.getStatus() != TaskStatus.DONE
                    && where.contains(t.getProject())).count();
            String scope = where.size() == 1 ? "in " + where.get(0).getKey() : "across " + where.size() + " projects (" + where.stream().map(Project::getKey).collect(Collectors.joining(", ")) + ")";
            Project first = where.get(0);
            items.add(item("workload-" + personId, "WORKLOAD", "MEDIUM", u.getName() + " has " + theirs.size() + " overdue tasks " + scope,
                    "Overdue: " + keys(theirs, 4) + ". " + plural(open, "open task", "open tasks") + " assigned to them in total. Consider re-planning or reassigning.",
                    refs(theirs, 4), "/projects/" + first.getId() + "/tasks?assignee=" + personId + "&due=overdue", first, theirs.get(0).getDueDate()));
        });

        items.sort(Comparator.comparing((Dto.AttentionItem i) -> SEVERITY_RANK.getOrDefault(i.severity(), 3))
                .thenComparing(Dto.AttentionItem::date, Comparator.nullsLast(Comparator.naturalOrder()))
                .thenComparing(Dto.AttentionItem::id));

        // Recently approved: the evidence each completion was accepted on ------------------
        Instant since = now.minus(APPROVED_WINDOW_DAYS, ChronoUnit.DAYS);
        List<Dto.ApprovedItem> approved = subs.stream()
                .filter(s -> s.getStatus() == SubmissionStatus.APPROVED && reviewBySubmission.containsKey(s.getId()))
                .map(s -> Map.entry(s, reviewBySubmission.get(s.getId())))
                .filter(e -> e.getValue().getCreatedAt().isAfter(since))
                .sorted(Comparator.comparing((Map.Entry<Submission, Review> e) -> e.getValue().getCreatedAt()).reversed())
                .limit(6)
                .map(e -> {
                    Submission s = e.getKey();
                    Task t = s.getTask();
                    Project p = t.getProject();
                    return new Dto.ApprovedItem(t.getId(), DtoMapper.taskKey(t), t.getTitle(), p.getId(), p.getName(), p.getColor(),
                            e.getValue().getCreatedAt(), mapper.summary(e.getValue().getReviewer()), mapper.summary(s.getSubmittedBy()), s.getNumber(),
                            s.getEvidence().size(), s.getCriteria().size(), TaskService.link(t) + "/review");
                })
                .toList();

        return new Result(items.stream().limit(MAX_ITEMS).toList(), approved);
    }

    private static Dto.AttentionItem item(String id, String kind, String severity, String title, String reason, List<String> refs, String link, Project p, LocalDate date) {
        return new Dto.AttentionItem(id, kind, severity, title, reason, refs, link, p.getId(), p.getName(), p.getColor(), date);
    }
}
