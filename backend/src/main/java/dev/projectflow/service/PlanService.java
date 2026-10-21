package dev.projectflow.service;

import dev.projectflow.domain.*;
import dev.projectflow.repository.ProjectMemberRepository;
import dev.projectflow.repository.TaskDependencyRepository;
import dev.projectflow.repository.TaskRepository;
import dev.projectflow.repository.UserRepository;
import dev.projectflow.security.ProjectAccess;
import dev.projectflow.security.ProjectAccess.Access;
import dev.projectflow.web.dto.Dto;
import dev.projectflow.web.dto.Requests;
import dev.projectflow.web.error.ApiException;
import java.time.Clock;
import java.time.Instant;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Applies a planning scenario (computed and previewed in the browser) in one transaction.
 *
 * <p>The server does not trust the scenario: only owners and managers may apply it, every
 * task must belong to the project and still be open, assignees must be non-viewer members,
 * and the request carries the basis the schedule was computed from: every open task with the
 * version the browser saw, plus every dependency id. If any open task was edited, added,
 * finished or deleted, or a dependency was added or removed since, nothing is applied and the
 * caller gets EDIT_CONFLICT naming what changed.
 */
@Service
public class PlanService {

    private static final DateTimeFormatter DATE = DateTimeFormatter.ISO_LOCAL_DATE;

    private final TaskRepository tasks;
    private final TaskDependencyRepository dependencies;
    private final ProjectMemberRepository members;
    private final UserRepository users;
    private final ProjectAccess access;
    private final ActivityService activity;
    private final NotificationService notifications;
    private final DtoMapper mapper;
    private final Clock clock;

    public PlanService(TaskRepository tasks, TaskDependencyRepository dependencies, ProjectMemberRepository members, UserRepository users, ProjectAccess access,
                       ActivityService activity, NotificationService notifications, DtoMapper mapper, Clock clock) {
        this.tasks = tasks;
        this.dependencies = dependencies;
        this.members = members;
        this.users = users;
        this.access = access;
        this.activity = activity;
        this.notifications = notifications;
        this.mapper = mapper;
        this.clock = clock;
    }

    @Transactional
    public Dto.PlanResult apply(Long projectId, Requests.PlanApply req) {
        Access a = access.require(projectId);
        if (!Permissions.atLeast(a.role(), Role.MANAGER)) throw ApiException.forbidden("Only owners and managers can apply a plan.");
        if (a.project().getStatus() == ProjectStatus.ARCHIVED) throw ApiException.conflict("Archived projects are read-only.");

        Map<Long, Requests.PlanChange> byTask = new LinkedHashMap<>();
        for (Requests.PlanChange c : req.changes()) {
            if (byTask.put(c.taskId(), c) != null) throw ApiException.validation("changes", "Each task may appear only once in a plan.");
        }
        Map<Long, Task> found = tasks.findAllById(byTask.keySet()).stream()
                .filter(t -> t.getProject().getId().equals(projectId))
                .collect(Collectors.toMap(Task::getId, t -> t));
        if (found.size() != byTask.size()) throw ApiException.validation("changes", "A change refers to a task that isn’t in this project.");

        // Stale check over the whole basis, not just the tasks being changed: the schedule also
        // depended on every other open task and on the dependency graph.
        List<Task> projectTasks = tasks.findByProjectId(projectId);
        Map<Long, Task> allById = projectTasks.stream().collect(Collectors.toMap(Task::getId, t -> t));
        Map<Long, Long> seen = new HashMap<>();
        for (Requests.TaskVersion v : req.basis().tasks()) seen.put(v.taskId(), v.version());
        Set<String> stale = new TreeSet<>();
        for (Task t : projectTasks) {
            boolean open = t.getStatus() != TaskStatus.DONE;
            Long saw = seen.get(t.getId());
            if (open ? (saw == null || saw != t.getVersion()) : saw != null) stale.add(DtoMapper.taskKey(t));
        }
        for (Requests.PlanChange c : byTask.values()) {
            if (c.version() != found.get(c.taskId()).getVersion()) stale.add(DtoMapper.taskKey(found.get(c.taskId())));
        }
        boolean deletedTasks = seen.keySet().stream().anyMatch(id -> !allById.containsKey(id));
        Set<Long> depsNow = dependencies.findByProjectId(projectId).stream().map(TaskDependency::getId).collect(Collectors.toSet());
        boolean depsChanged = !depsNow.equals(new HashSet<>(req.basis().dependencyIds()));
        if (!stale.isEmpty() || deletedTasks || depsChanged) {
            List<String> what = new ArrayList<>();
            if (!stale.isEmpty()) what.add(String.join(", ", stale) + (stale.size() == 1 ? " was" : " were") + " changed");
            if (deletedTasks) what.add("a task was deleted");
            if (depsChanged) what.add("dependencies were added or removed");
            throw ApiException.editConflict("This plan is out of date: " + String.join("; ", what)
                    + " after the scenario was calculated. Recalculate and review it again.");
        }
        List<String> done = found.values().stream().filter(t -> t.getStatus() == TaskStatus.DONE).map(DtoMapper::taskKey).sorted().toList();
        if (!done.isEmpty()) throw ApiException.workflow("Plans only change open work; " + String.join(", ", done) + (done.size() == 1 ? " is" : " are") + " already done.");

        Map<Long, Role> roles = members.findByProjectId(projectId).stream().collect(Collectors.toMap(m -> m.getUser().getId(), ProjectMember::getRole));
        for (Requests.PlanChange c : byTask.values()) {
            if (c.assigneeId() != null) {
                Role r = roles.get(c.assigneeId());
                if (r == null || r == Role.VIEWER) throw ApiException.validation("changes", "Assignees must be project members who are not viewers.");
            }
        }

        User me = users.findById(a.userId()).orElseThrow();
        Instant now = Instant.now(clock);
        Map<Long, List<String>> movedFor = new LinkedHashMap<>();
        List<Task> changed = new ArrayList<>();
        for (Requests.PlanChange c : byTask.values()) {
            Task t = found.get(c.taskId());
            String key = DtoMapper.taskKey(t);
            boolean any = false;
            if (c.dueDate() != null && !c.dueDate().equals(t.getDueDate())) {
                activity.log(a.project(), t.getId(), me, ActivityType.PLAN_APPLIED, "rescheduled " + key + " from a plan",
                        new ActivityService.Change("dueDate", t.getDueDate() == null ? null : DATE.format(t.getDueDate()), DATE.format(c.dueDate())));
                t.setDueDate(c.dueDate());
                any = true;
                if (t.getAssignee() != null) movedFor.computeIfAbsent(t.getAssignee().getId(), k -> new ArrayList<>()).add(key);
            }
            if (c.estimateDays() != null && !c.estimateDays().equals(t.getEstimateDays())) {
                activity.log(a.project(), t.getId(), me, ActivityType.PLAN_APPLIED, "re-estimated " + key + " from a plan",
                        new ActivityService.Change("estimate", TaskService.days(t.getEstimateDays()), TaskService.days(c.estimateDays())));
                t.setEstimateDays(c.estimateDays());
                any = true;
            }
            Long currentAssignee = t.getAssignee() == null ? null : t.getAssignee().getId();
            Long nextAssignee = c.unassign() ? null : (c.assigneeId() != null ? c.assigneeId() : currentAssignee);
            if (!Objects.equals(currentAssignee, nextAssignee)) {
                User next = nextAssignee == null ? null : users.findById(nextAssignee).orElseThrow();
                activity.log(a.project(), t.getId(), me, ActivityType.PLAN_APPLIED, (next == null ? "unassigned " : "reassigned ") + key + " from a plan",
                        new ActivityService.Change("assignee", t.getAssignee() == null ? null : t.getAssignee().getName(), next == null ? null : next.getName()));
                t.setAssignee(next);
                any = true;
                if (next != null) {
                    notifications.notify(next.getId(), me, NotificationType.TASK_ASSIGNED, "Task assigned to you",
                            me.getName() + " assigned you " + key + " “" + t.getTitle() + "” while re-planning " + a.project().getName() + ".",
                            TaskService.link(t), projectId, null);
                }
            }
            if (any) {
                t.setUpdatedAt(now);
                changed.add(t);
            }
        }
        String why = req.note() == null || req.note().isBlank() ? "" : " Reason: " + req.note().trim();
        movedFor.forEach((userId, keys) -> notifications.notify(userId, me, NotificationType.PLAN_CHANGED, "Due dates changed",
                me.getName() + " applied a new plan in " + a.project().getName() + " that moves " + String.join(", ", keys) + "." + why,
                "/projects/" + projectId + "/plan", projectId, null));
        tasks.flush();
        return new Dto.PlanResult(changed.size(), mapper.tasks(changed));
    }
}
