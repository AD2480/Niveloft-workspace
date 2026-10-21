package dev.projectflow.service;

import dev.projectflow.ops.ProjectCache;
import dev.projectflow.domain.*;
import dev.projectflow.repository.*;
import dev.projectflow.security.ProjectAccess;
import dev.projectflow.security.ProjectAccess.Access;
import dev.projectflow.web.dto.Dto;
import java.time.*;
import java.time.temporal.ChronoUnit;
import java.time.temporal.TemporalAdjusters;
import java.util.*;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Read-only views computed from stored records: dashboard, project analytics and calendar.
 * Nothing here is estimated or invented; every figure can be traced to rows in the database.
 */
@Service
public class InsightService {

    private final ProjectMemberRepository members;
    private final TaskRepository tasks;
    private final MilestoneRepository milestones;
    private final SubmissionRepository submissions;
    private final ProjectAccess access;
    private final ActivityService activity;
    private final DtoMapper mapper;
    private final AttentionService attention;
    private final TaskStatusEventRepository events;
    private final ReviewRepository reviews;
    private final Clock clock;
    private final ProjectCache cache;

    public InsightService(ProjectMemberRepository members, TaskRepository tasks, MilestoneRepository milestones, SubmissionRepository submissions,
                          ProjectAccess access, ActivityService activity, DtoMapper mapper, AttentionService attention,
                          TaskStatusEventRepository events, ReviewRepository reviews, Clock clock, ProjectCache cache) {
        this.cache = cache;
        this.attention = attention;
        this.events = events;
        this.reviews = reviews;
        this.members = members;
        this.tasks = tasks;
        this.milestones = milestones;
        this.submissions = submissions;
        this.access = access;
        this.activity = activity;
        this.mapper = mapper;
        this.clock = clock;
    }

    private static final Comparator<Task> BY_DUE = Comparator
            .comparing(Task::getDueDate, Comparator.nullsLast(Comparator.naturalOrder()))
            .thenComparing((Task t) -> -t.getPriority().rank())
            .thenComparing(Task::getId);

    /** Weekly created/completed counts for the last {@code weeks} ISO weeks (Monday start), oldest first. */
    List<Dto.TrendPoint> completionTrend(Collection<Task> list, int weeks) {
        ZoneId zone = clock.getZone();
        LocalDate thisMonday = LocalDate.now(clock).with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
        List<Dto.TrendPoint> points = new ArrayList<>();
        for (int i = weeks - 1; i >= 0; i--) {
            LocalDate start = thisMonday.minusWeeks(i);
            Instant from = start.atStartOfDay(zone).toInstant();
            Instant to = start.plusWeeks(1).atStartOfDay(zone).toInstant();
            int created = (int) list.stream().filter(t -> !t.getCreatedAt().isBefore(from) && t.getCreatedAt().isBefore(to)).count();
            int completed = (int) list.stream().filter(t -> t.getCompletedAt() != null && !t.getCompletedAt().isBefore(from) && t.getCompletedAt().isBefore(to)).count();
            points.add(new Dto.TrendPoint(start, created, completed));
        }
        return points;
    }

    // ---------------------------------------------------------------- dashboard

    @Transactional(readOnly = true)
    public Dto.Dashboard dashboard(Long userId) {
        List<ProjectMember> mine = members.findByUserId(userId);
        Map<Long, Role> roles = mine.stream().collect(Collectors.toMap(m -> m.getProject().getId(), ProjectMember::getRole));
        List<Project> projects = mine.stream().map(ProjectMember::getProject).toList();
        List<Long> ids = projects.stream().map(Project::getId).toList();
        List<Task> all = tasks.findByProjectIdIn(ids);
        LocalDate today = mapper.today();
        Instant weekStart = today.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY)).atStartOfDay(clock.getZone()).toInstant();

        List<Task> myOpen = all.stream().filter(t -> t.getAssignee() != null && t.getAssignee().getId().equals(userId) && t.getStatus() != TaskStatus.DONE)
                .sorted(BY_DUE).toList();

        Map<Long, Submission> pending = submissions.findByProjectIdsAndStatus(ids, SubmissionStatus.PENDING).stream()
                .collect(Collectors.toMap(s -> s.getTask().getId(), s -> s, (x, y) -> x));
        List<Task> reviewQueue = all.stream()
                .filter(t -> t.getStatus() == TaskStatus.IN_REVIEW)
                .filter(t -> {
                    Submission s = pending.get(t.getId());
                    return s != null && Permissions.reviewSubmission(roles.get(t.getProject().getId()), s.getSubmittedBy().getId(), userId);
                })
                .sorted(BY_DUE).toList();

        LocalDate horizon = today.plusDays(21);
        List<Dto.UpcomingItem> upcoming = new ArrayList<>();
        for (Task t : myOpen) {
            if (t.getDueDate() != null && !t.getDueDate().isAfter(horizon)) {
                Project p = t.getProject();
                upcoming.add(new Dto.UpcomingItem("TASK", t.getId(), t.getTitle(), DtoMapper.taskKey(t), t.getDueDate(), p.getId(), p.getName(),
                        p.getColor(), TaskService.link(t), DtoMapper.isOverdue(t, today)));
            }
        }
        for (Milestone m : milestones.findByProjectIdInOrderByDueDateAsc(ids)) {
            if (!m.isCompleted() && !m.getDueDate().isAfter(horizon)) {
                Project p = m.getProject();
                upcoming.add(new Dto.UpcomingItem("MILESTONE", m.getId(), m.getName(), null, m.getDueDate(), p.getId(), p.getName(), p.getColor(),
                        "/projects/" + p.getId() + "/milestones", m.getDueDate().isBefore(today)));
            }
        }
        upcoming.sort(Comparator.comparing(Dto.UpcomingItem::date));

        Map<Long, List<Task>> byProject = all.stream().collect(Collectors.groupingBy(t -> t.getProject().getId()));
        Map<Long, Long> memberCounts = members.findByProjectIdIn(ids).stream().collect(Collectors.groupingBy(m -> m.getProject().getId(), Collectors.counting()));
        List<Dto.ProjectSummary> active = projects.stream()
                .filter(p -> p.getStatus() == ProjectStatus.ACTIVE || p.getStatus() == ProjectStatus.ON_HOLD)
                .sorted(Comparator.comparing(Project::getDeadline, Comparator.nullsLast(Comparator.naturalOrder())))
                .map(p -> mapper.projectSummary(p, roles.get(p.getId()), byProject.getOrDefault(p.getId(), List.of()), memberCounts.getOrDefault(p.getId(), 0L)))
                .toList();

        Dto.DashboardStats stats = new Dto.DashboardStats(
                (int) projects.stream().filter(p -> p.getStatus() == ProjectStatus.ACTIVE).count(),
                myOpen.size(),
                (int) myOpen.stream().filter(t -> DtoMapper.isOverdue(t, today)).count(),
                reviewQueue.size(),
                (int) all.stream().filter(t -> t.getCompletedAt() != null && !t.getCompletedAt().isBefore(weekStart)).count());

        AttentionService.Result focus = attention.compute(userId, roles, projects, all);
        return new Dto.Dashboard(stats, mapper.tasks(myOpen.stream().limit(8).toList()), mapper.tasks(reviewQueue.stream().limit(6).toList()), active,
                upcoming.stream().limit(8).toList(), completionTrend(all, 8), activity.recent(ids), focus.attention(), focus.recentlyApproved());
    }

    // ---------------------------------------------------------------- analytics

    /** Every recorded status change in a project, oldest first (for replaying its history). */
    @Transactional(readOnly = true)
    public List<Dto.StatusChange> history(Long projectId) {
        access.require(projectId);
        return cache.get("history", projectId, () -> events.findByProjectIdOrderByOccurredAtAscIdAsc(projectId).stream()
                .map(e -> new Dto.StatusChange(e.getTask().getId(), e.getFromStatus(), e.getToStatus(), e.getOccurredAt()))
                .toList());
    }

    /** The same for every member, so it's cached until the project next changes (see {@link ProjectCache}). */
    @Transactional(readOnly = true)
    public Dto.ProjectAnalytics analytics(Long projectId) {
        Access a = access.require(projectId);
        return cache.get("analytics", projectId, () -> computeAnalytics(a, projectId));
    }

    private Dto.ProjectAnalytics computeAnalytics(Access a, Long projectId) {
        Project p = a.project();
        List<Task> list = tasks.findByProjectId(projectId);
        Dto.TaskCounts counts = mapper.counts(list);
        HealthCalculator.Result h = mapper.health(p, counts);
        LocalDate today = mapper.today();
        LocalDate in14 = today.plusDays(14);

        List<Dto.WorkloadRow> workload = members.findByProjectId(projectId).stream()
                .filter(m -> m.getRole() != Role.VIEWER)
                .map(m -> {
                    List<Task> theirs = list.stream().filter(t -> t.getAssignee() != null && t.getAssignee().getId().equals(m.getUser().getId())).toList();
                    Dto.TaskCounts c = mapper.counts(theirs);
                    return new Dto.WorkloadRow(mapper.summary(m.getUser()), c.todo(), c.inProgress(), c.inReview(), c.done(), c.overdue(), c.total() - c.done());
                })
                .sorted(Comparator.comparing(w -> w.user().name())) // alphabetical: workload is shown, people are not ranked
                .toList();

        // Cycle time: first move to In Progress → approval, for tasks that have both timestamps.
        List<Long> cycleDays = list.stream().filter(t -> t.getStartedAt() != null && t.getCompletedAt() != null)
                .map(t -> Math.max(0, ChronoUnit.DAYS.between(t.getStartedAt(), t.getCompletedAt()))).toList();
        Double avgCycle = cycleDays.isEmpty() ? null : Math.round(cycleDays.stream().mapToLong(Long::longValue).average().orElse(0) * 10) / 10.0;

        // First-time approval: share of reviewed tasks whose first submission was approved.
        List<Submission> projectSubs = submissions.findByProjectId(projectId);
        Map<Long, List<Submission>> subsByTask = projectSubs.stream().collect(Collectors.groupingBy(s -> s.getTask().getId()));
        int reviewedTasks = 0, firstTime = 0;
        for (List<Submission> subs : subsByTask.values()) {
            Submission first = subs.stream().min(Comparator.comparingInt(Submission::getNumber)).orElseThrow();
            if (first.getStatus() == SubmissionStatus.PENDING) continue;
            reviewedTasks++;
            if (first.getStatus() == SubmissionStatus.APPROVED) firstTime++;
        }
        Integer approvalRate = reviewedTasks == 0 ? null : (int) Math.round(firstTime * 100.0 / reviewedTasks);

        List<Dto.StatusCount> statusDistribution = Arrays.stream(TaskStatus.values())
                .map(s -> new Dto.StatusCount(s, (int) list.stream().filter(t -> t.getStatus() == s).count())).toList();
        List<Dto.PriorityCount> priorityDistribution = List.of(Priority.URGENT, Priority.HIGH, Priority.MEDIUM, Priority.LOW).stream()
                .map(pr -> new Dto.PriorityCount(pr, (int) list.stream().filter(t -> t.getPriority() == pr && t.getStatus() != TaskStatus.DONE).count())).toList();

        return new Dto.ProjectAnalytics(projectId, h.progress(), h.expectedProgress(), h.health(), h.reasons(), counts, statusDistribution,
                priorityDistribution, workload, completionTrend(list, 8),
                mapper.tasks(list.stream().filter(t -> DtoMapper.isOverdue(t, today)).sorted(BY_DUE).toList()),
                mapper.tasks(list.stream().filter(t -> t.getStatus() != TaskStatus.DONE && t.getDueDate() != null
                        && !t.getDueDate().isBefore(today) && !t.getDueDate().isAfter(in14)).sorted(BY_DUE).toList()),
                milestones.findByProjectIdOrderByDueDateAsc(projectId).stream().map(m -> mapper.milestone(m, list)).toList(),
                avgCycle, approvalRate, flow(list, events.findByProjectIdOrderByOccurredAtAscIdAsc(projectId), 28),
                reviewStats(projectSubs, subsByTask), timeInStatus(events.findByProjectIdOrderByOccurredAtAscIdAsc(projectId)));
    }

    private static Double median(List<Double> values) {
        if (values.isEmpty()) return null;
        List<Double> v = values.stream().sorted().toList();
        int n = v.size();
        double m = n % 2 == 1 ? v.get(n / 2) : (v.get(n / 2 - 1) + v.get(n / 2)) / 2.0;
        return Math.round(m * 10) / 10.0;
    }

    /** Status of every task at the end of each of the last {@code days} days, replayed from status events. */
    List<Dto.FlowPoint> flow(List<Task> list, List<TaskStatusEvent> history, int days) {
        ZoneId zone = clock.getZone();
        LocalDate today = LocalDate.now(clock);
        Map<Long, List<TaskStatusEvent>> byTask = history.stream().collect(Collectors.groupingBy(e -> e.getTask().getId()));
        List<Dto.FlowPoint> out = new ArrayList<>();
        for (int i = days - 1; i >= 0; i--) {
            LocalDate d = today.minusDays(i);
            Instant end = d.plusDays(1).atStartOfDay(zone).toInstant();
            int[] c = new int[4];
            for (Task t : list) {
                if (!t.getCreatedAt().isBefore(end)) continue;
                TaskStatus s = TaskStatus.TODO;
                for (TaskStatusEvent e : byTask.getOrDefault(t.getId(), List.of())) {
                    if (e.getOccurredAt().isBefore(end)) s = e.getToStatus();
                    else break;
                }
                c[s.ordinal()]++;
            }
            out.add(new Dto.FlowPoint(d, c[TaskStatus.TODO.ordinal()], c[TaskStatus.IN_PROGRESS.ordinal()], c[TaskStatus.IN_REVIEW.ordinal()], c[TaskStatus.DONE.ordinal()]));
        }
        return out;
    }

    Dto.ReviewStats reviewStats(List<Submission> subs, Map<Long, List<Submission>> subsByTask) {
        Map<Long, Review> bySub = subs.isEmpty() ? Map.of() : reviews.findBySubmissionIdIn(subs.stream().map(Submission::getId).toList()).stream()
                .collect(Collectors.toMap(r -> r.getSubmission().getId(), r -> r, (a, b) -> a));
        List<Double> hours = new ArrayList<>();
        int changes = 0;
        for (Submission s : subs) {
            Review r = bySub.get(s.getId());
            if (r == null) continue;
            hours.add(ChronoUnit.MINUTES.between(s.getCreatedAt(), r.getCreatedAt()) / 60.0);
            if (r.getDecision() == ReviewDecision.CHANGES_REQUESTED) changes++;
        }
        List<Integer> rounds = subsByTask.values().stream()
                .filter(l -> l.stream().anyMatch(s -> s.getStatus() == SubmissionStatus.APPROVED))
                .map(List::size).toList();
        int pending = (int) subs.stream().filter(s -> s.getStatus() == SubmissionStatus.PENDING).count();
        return new Dto.ReviewStats(subs.size(), bySub.size(), pending, median(hours),
                bySub.isEmpty() ? null : (int) Math.round(changes * 100.0 / bySub.size()),
                rounds.isEmpty() ? null : Math.round(rounds.stream().mapToInt(Integer::intValue).average().orElse(0) * 10) / 10.0);
    }

    /** Median days spent In Progress and In Review, counting only stays that have ended. */
    List<Dto.TimeInStatus> timeInStatus(List<TaskStatusEvent> history) {
        Map<TaskStatus, List<Double>> spans = new EnumMap<>(TaskStatus.class);
        Map<Long, List<TaskStatusEvent>> byTask = history.stream().collect(Collectors.groupingBy(e -> e.getTask().getId()));
        for (List<TaskStatusEvent> list : byTask.values()) {
            for (int i = 0; i + 1 < list.size(); i++) {
                TaskStatusEvent enter = list.get(i);
                TaskStatusEvent leave = list.get(i + 1);
                spans.computeIfAbsent(enter.getToStatus(), k -> new ArrayList<>())
                        .add(ChronoUnit.MINUTES.between(enter.getOccurredAt(), leave.getOccurredAt()) / 1440.0);
            }
        }
        return List.of(TaskStatus.IN_PROGRESS, TaskStatus.IN_REVIEW).stream()
                .map(s -> new Dto.TimeInStatus(s, median(spans.getOrDefault(s, List.of())), spans.getOrDefault(s, List.of()).size()))
                .toList();
    }

    // ----------------------------------------------------------------- calendar

    @Transactional(readOnly = true)
    public List<Dto.CalendarEvent> calendar(Long userId, LocalDate from, LocalDate to, Long projectId, boolean mineOnly) {
        LocalDate today = mapper.today();
        List<Project> projects = members.findByUserId(userId).stream().map(ProjectMember::getProject)
                .filter(p -> projectId == null || p.getId().equals(projectId)).toList();
        List<Long> ids = projects.stream().map(Project::getId).toList();
        LocalDate lo = from == null ? LocalDate.MIN : from;
        LocalDate hi = to == null ? LocalDate.MAX : to;
        List<Dto.CalendarEvent> events = new ArrayList<>();
        for (Task t : tasks.findByProjectIdIn(ids)) {
            LocalDate d = t.getDueDate();
            if (d == null || d.isBefore(lo) || d.isAfter(hi)) continue;
            if (mineOnly && (t.getAssignee() == null || !t.getAssignee().getId().equals(userId))) continue;
            Project p = t.getProject();
            events.add(new Dto.CalendarEvent("task-" + t.getId(), "TASK", DtoMapper.taskKey(t) + " " + t.getTitle(), d, p.getId(), p.getName(), p.getColor(),
                    t.getStatus(), t.getPriority(), t.getStatus() == TaskStatus.DONE, DtoMapper.isOverdue(t, today), TaskService.link(t)));
        }
        for (Milestone m : milestones.findByProjectIdInOrderByDueDateAsc(ids)) {
            LocalDate d = m.getDueDate();
            if (d.isBefore(lo) || d.isAfter(hi)) continue;
            Project p = m.getProject();
            events.add(new Dto.CalendarEvent("milestone-" + m.getId(), "MILESTONE", m.getName(), d, p.getId(), p.getName(), p.getColor(),
                    null, null, m.isCompleted(), !m.isCompleted() && d.isBefore(today), "/projects/" + p.getId() + "/milestones"));
        }
        for (Project p : projects) {
            LocalDate d = p.getDeadline();
            if (d == null || d.isBefore(lo) || d.isAfter(hi)) continue;
            boolean closed = p.getStatus() == ProjectStatus.COMPLETED || p.getStatus() == ProjectStatus.ARCHIVED;
            events.add(new Dto.CalendarEvent("project-" + p.getId(), "PROJECT_DEADLINE", p.getName() + " deadline", d, p.getId(), p.getName(), p.getColor(),
                    null, null, p.getStatus() == ProjectStatus.COMPLETED, !closed && d.isBefore(today), "/projects/" + p.getId()));
        }
        events.sort(Comparator.comparing(Dto.CalendarEvent::date).thenComparing(Dto.CalendarEvent::type));
        return events;
    }
}
