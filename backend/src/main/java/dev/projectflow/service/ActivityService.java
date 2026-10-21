package dev.projectflow.service;

import dev.projectflow.domain.*;
import dev.projectflow.repository.ActivityRepository;
import dev.projectflow.repository.TaskRepository;
import dev.projectflow.web.PageResponse;
import dev.projectflow.web.dto.Dto;
import java.time.Clock;
import java.time.Instant;
import java.util.*;
import java.util.stream.Collectors;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import dev.projectflow.live.LiveEvents;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Writes and reads the project activity history. */
@Service
public class ActivityService {

    /** A structured before/after value for one field. */
    public record Change(String field, String oldValue, String newValue) {}

    private final ActivityRepository activities;
    private final TaskRepository tasks;
    private final DtoMapper mapper;
    private final Clock clock;
    private final ApplicationEventPublisher events;

    public ActivityService(ActivityRepository activities, TaskRepository tasks, DtoMapper mapper, Clock clock, ApplicationEventPublisher events) {
        this.events = events;
        this.activities = activities;
        this.tasks = tasks;
        this.mapper = mapper;
        this.clock = clock;
    }

    public void log(Project project, Long taskId, User actor, ActivityType type, String message) {
        log(project, taskId, actor, type, message, null);
    }

    public void log(Project project, Long taskId, User actor, ActivityType type, String message, Change change) {
        Activity a = new Activity();
        a.setProject(project);
        a.setTaskId(taskId);
        a.setActor(actor);
        a.setType(type);
        a.setMessage(truncate(message, 500));
        if (change != null) {
            a.setFieldName(change.field());
            a.setOldValue(truncate(change.oldValue(), 500));
            a.setNewValue(truncate(change.newValue(), 500));
        }
        a.setCreatedAt(Instant.now(clock));
        activities.save(a);
        // Every change is logged here, so this is the one place that tells live clients "refetch".
        events.publishEvent(new LiveEvents.ProjectChanged(project.getId(), taskId, actor == null ? null : actor.getId(), type.name()));
    }

    private static String truncate(String s, int max) {
        return s == null || s.length() <= max ? s : s.substring(0, max - 1) + "…";
    }

    private Map<Long, String> taskKeys(Collection<Activity> list) {
        Set<Long> ids = list.stream().map(Activity::getTaskId).filter(Objects::nonNull).collect(Collectors.toSet());
        Map<Long, String> keys = new HashMap<>();
        tasks.findAllById(ids).forEach(t -> keys.put(t.getId(), DtoMapper.taskKey(t)));
        return keys;
    }

    @Transactional(readOnly = true)
    public PageResponse<Dto.Activity> projectActivity(Long projectId, int page, int size) {
        int safeSize = Math.min(Math.max(size, 1), 100);
        Page<Activity> result = activities.findByProjectIdOrderByCreatedAtDescIdDesc(projectId, PageRequest.of(Math.max(page, 0), safeSize));
        Map<Long, String> keys = taskKeys(result.getContent());
        return new PageResponse<>(result.getContent().stream().map(a -> mapper.activity(a, keys)).toList(),
                result.getNumber(), safeSize, result.getTotalElements(), Math.max(1, result.getTotalPages()));
    }

    @Transactional(readOnly = true)
    public List<Dto.Activity> taskActivity(Long taskId) {
        List<Activity> list = activities.findByTaskIdOrderByCreatedAtDescIdDesc(taskId);
        Map<Long, String> keys = taskKeys(list);
        return list.stream().map(a -> mapper.activity(a, keys)).toList();
    }

    /** Activities as the API shows them (with their tasks' keys). */
    public List<Dto.Activity> toDtos(List<Activity> list) {
        Map<Long, String> keys = taskKeys(list);
        return list.stream().map(a -> mapper.activity(a, keys)).toList();
    }

    @Transactional(readOnly = true)
    public List<Dto.Activity> recent(Collection<Long> projectIds) {
        if (projectIds.isEmpty()) return List.of();
        List<Activity> list = activities.findTop12ByProjectIdInOrderByCreatedAtDescIdDesc(projectIds);
        Map<Long, String> keys = taskKeys(list);
        return list.stream().map(a -> mapper.activity(a, keys)).toList();
    }
}
