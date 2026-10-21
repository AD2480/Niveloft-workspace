package dev.projectflow.service;

import dev.projectflow.domain.*;
import dev.projectflow.repository.ProjectRepository;
import dev.projectflow.repository.TaskDependencyRepository;
import dev.projectflow.repository.TaskRepository;
import dev.projectflow.repository.UserRepository;
import dev.projectflow.security.ProjectAccess;
import dev.projectflow.security.ProjectAccess.TaskAccess;
import dev.projectflow.web.dto.Dto;
import dev.projectflow.web.error.ApiException;
import java.time.Clock;
import java.time.Instant;
import java.util.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Finish-to-start dependencies between tasks of one project.
 *
 * <p>Rules: both tasks in the same project; no self-dependency; no duplicates; no cycles
 * (the error names the loop); only people who can edit the blocked task may change its
 * blockers; archived projects are read-only. Dependencies inform — they never move tasks.
 */
@Service
public class DependencyService {

    private final TaskDependencyRepository dependencies;
    private final ProjectRepository projects;
    private final TaskRepository tasks;
    private final UserRepository users;
    private final ProjectAccess access;
    private final ActivityService activity;
    private final DtoMapper mapper;
    private final Clock clock;

    public DependencyService(TaskDependencyRepository dependencies, ProjectRepository projects, TaskRepository tasks, UserRepository users, ProjectAccess access,
                             ActivityService activity, DtoMapper mapper, Clock clock) {
        this.dependencies = dependencies;
        this.projects = projects;
        this.tasks = tasks;
        this.users = users;
        this.access = access;
        this.activity = activity;
        this.mapper = mapper;
        this.clock = clock;
    }

    Dto.DependencyTask ref(Task t) {
        return new Dto.DependencyTask(t.getId(), DtoMapper.taskKey(t), t.getTitle(), t.getStatus(), t.getDueDate(),
                t.getAssignee() == null ? null : mapper.summary(t.getAssignee()), DtoMapper.isOverdue(t, mapper.today()),
                t.getStartedAt(), t.getCompletedAt(), t.getMilestone() == null ? null : t.getMilestone().getId());
    }

    Dto.Dependency dto(TaskDependency d) {
        return new Dto.Dependency(d.getId(), d.getProjectId(), ref(d.getBlocker()), ref(d.getBlocked()), mapper.summary(d.getCreatedBy()), d.getCreatedAt());
    }

    @Transactional(readOnly = true)
    public List<Dto.Dependency> list(Long projectId) {
        access.require(projectId);
        return dependencies.findByProjectId(projectId).stream().map(this::dto).toList();
    }

    /**
     * The chain of task keys from {@code from} to {@code to} following blocker → blocked edges,
     * or empty if {@code to} is not reachable. Used to explain why a new edge would create a cycle.
     */
    static List<Long> path(Map<Long, List<Long>> edges, Long from, Long to) {
        Map<Long, Long> parent = new HashMap<>();
        Deque<Long> queue = new ArrayDeque<>(List.of(from));
        parent.put(from, null);
        while (!queue.isEmpty()) {
            Long cur = queue.poll();
            if (cur.equals(to)) {
                LinkedList<Long> out = new LinkedList<>();
                for (Long n = to; n != null; n = parent.get(n)) out.addFirst(n);
                return out;
            }
            for (Long next : edges.getOrDefault(cur, List.of())) {
                if (!parent.containsKey(next)) {
                    parent.put(next, cur);
                    queue.add(next);
                }
            }
        }
        return List.of();
    }

    @Transactional
    public Dto.Dependency add(Long blockedTaskId, Long blockerTaskId) {
        TaskAccess a = access.requireTask(blockedTaskId);
        Task blocked = a.task();
        if (!Permissions.editTask(a.role(), blocked, a.userId())) {
            throw ApiException.forbidden("You can only change dependencies of tasks that are assigned to you or that you created.");
        }
        if (a.project().getStatus() == ProjectStatus.ARCHIVED) throw ApiException.conflict("Archived projects are read-only.");
        if (blocked.getStatus() == TaskStatus.DONE) throw ApiException.workflow("This task is already done, so nothing can block it.");
        if (blocked.getId().equals(blockerTaskId)) throw ApiException.validation("blockerTaskId", "A task can’t depend on itself.");

        Task blocker = tasks.findById(blockerTaskId)
                .filter(t -> t.getProject().getId().equals(a.project().getId()))
                .orElseThrow(() -> ApiException.validation("blockerTaskId", "Choose a task from this project. Dependencies across projects aren’t supported."));
        if (dependencies.existsByBlockerIdAndBlockedId(blocker.getId(), blocked.getId())) {
            throw ApiException.conflict(DtoMapper.taskKey(blocked) + " already depends on " + DtoMapper.taskKey(blocker) + ".");
        }

        // Serialise concurrent edits of this project's graph before reading it (see ProjectRepository.lockById).
        projects.lockById(a.project().getId());

        // Adding blocker → blocked closes a loop if blocked already (transitively) blocks blocker.
        List<TaskDependency> existing = dependencies.findByProjectId(a.project().getId());
        Map<Long, List<Long>> edges = new HashMap<>();
        Map<Long, Task> byId = new HashMap<>();
        for (TaskDependency d : existing) {
            edges.computeIfAbsent(d.getBlocker().getId(), k -> new ArrayList<>()).add(d.getBlocked().getId());
            byId.put(d.getBlocker().getId(), d.getBlocker());
            byId.put(d.getBlocked().getId(), d.getBlocked());
        }
        byId.put(blocker.getId(), blocker);
        byId.put(blocked.getId(), blocked);
        List<Long> loop = path(edges, blocked.getId(), blocker.getId());
        if (!loop.isEmpty()) {
            List<String> names = new ArrayList<>(loop.stream().map(id -> DtoMapper.taskKey(byId.get(id))).toList());
            names.add(DtoMapper.taskKey(blocked));
            throw ApiException.validation("blockerTaskId", "That would create a loop: " + String.join(" → ", names) + ". Remove one of these dependencies first.");
        }

        User me = users.findById(a.userId()).orElseThrow();
        TaskDependency d = new TaskDependency();
        d.setProjectId(a.project().getId());
        d.setBlocker(blocker);
        d.setBlocked(blocked);
        d.setCreatedBy(me);
        d.setCreatedAt(Instant.now(clock));
        dependencies.save(d);
        activity.log(a.project(), blocked.getId(), me, ActivityType.DEPENDENCY_ADDED,
                "made " + DtoMapper.taskKey(blocked) + " depend on " + DtoMapper.taskKey(blocker),
                new ActivityService.Change("dependency", null, DtoMapper.taskKey(blocker)));
        return dto(d);
    }

    @Transactional
    public void remove(Long dependencyId) {
        TaskDependency d = dependencies.findById(dependencyId).orElseThrow(() -> ApiException.notFound("Dependency not found."));
        // Non-members get the same 404 as for an unknown id, so ids can't be probed.
        TaskAccess a;
        try {
            a = access.requireTask(d.getBlocked().getId());
        } catch (ApiException e) {
            throw ApiException.notFound("Dependency not found.");
        }
        if (!Permissions.editTask(a.role(), d.getBlocked(), a.userId())) {
            throw ApiException.forbidden("You can only change dependencies of tasks that are assigned to you or that you created.");
        }
        if (a.project().getStatus() == ProjectStatus.ARCHIVED) throw ApiException.conflict("Archived projects are read-only.");
        String blocked = DtoMapper.taskKey(d.getBlocked());
        String blocker = DtoMapper.taskKey(d.getBlocker());
        dependencies.delete(d);
        activity.log(a.project(), d.getBlocked().getId(), users.getReferenceById(a.userId()), ActivityType.DEPENDENCY_REMOVED,
                "removed " + blocked + "’s dependency on " + blocker, new ActivityService.Change("dependency", blocker, null));
    }
}
