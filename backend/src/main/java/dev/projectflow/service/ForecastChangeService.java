package dev.projectflow.service;

import dev.projectflow.domain.Activity;
import dev.projectflow.domain.ActivityType;
import dev.projectflow.domain.ProjectMember;
import dev.projectflow.domain.Task;
import dev.projectflow.repository.ActivityRepository;
import dev.projectflow.repository.ProjectMemberRepository;
import dev.projectflow.repository.TaskRepository;
import dev.projectflow.security.ProjectAccess;
import dev.projectflow.web.dto.Dto;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The recorded changes a delivery forecast needs to be replayed as of an earlier moment: estimates,
 * due dates, priorities, owners and dependencies changed since then, and tasks deleted. The
 * browser rebuilds the project as it stood then from these and its status history, and works out
 * what each kind of change did to the likely finish. Nothing is inferred here: values are only
 * normalised (an estimate's "3 working days" becomes 3), and a name becomes a member id only when
 * exactly one member has it.
 */
@Service
public class ForecastChangeService {

    /** A replay looks back at most this far. */
    static final Duration MAX_BACK = Duration.ofDays(90);
    /** Changes sent at most; past this the log says it's cut short. */
    static final int MAX_CHANGES = 5_000;

    static final Set<ActivityType> TYPES = EnumSet.of(ActivityType.TASK_UPDATED, ActivityType.TASK_ASSIGNED, ActivityType.PLAN_APPLIED,
            ActivityType.DEPENDENCY_ADDED, ActivityType.DEPENDENCY_REMOVED, ActivityType.TASK_DELETED);
    private static final Set<String> FIELDS = Set.of("estimate", "dueDate", "priority", "assignee", "dependency");
    private static final Pattern NUMBER = Pattern.compile("^\\s*(\\d{1,4})");
    private static final Pattern DELETED_KEY = Pattern.compile("deleted ([A-Z][A-Z0-9]{1,9}-\\d{1,6})");

    private final ProjectAccess access;
    private final ActivityRepository activities;
    private final TaskRepository tasks;
    private final ProjectMemberRepository members;
    private final Clock clock;

    public ForecastChangeService(ProjectAccess access, ActivityRepository activities, TaskRepository tasks, ProjectMemberRepository members, Clock clock) {
        this.access = access;
        this.activities = activities;
        this.tasks = tasks;
        this.members = members;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public Dto.ChangeLog since(Long projectId, Instant since) {
        access.require(projectId);
        Instant now = Instant.now(clock);
        Instant from = since == null || since.isBefore(now.minus(MAX_BACK)) ? now.minus(MAX_BACK) : since.isAfter(now) ? now : since;
        List<Activity> rows = activities.findChangesSince(projectId, from, TYPES, PageRequest.of(0, MAX_CHANGES + 1));
        boolean truncated = rows.size() > MAX_CHANGES;
        if (truncated) rows = rows.subList(0, MAX_CHANGES);
        Map<Long, String> keyById = new HashMap<>();
        Map<String, Long> idByKey = new HashMap<>();
        for (Task t : tasks.findByProjectId(projectId)) {
            String key = DtoMapper.taskKey(t);
            keyById.put(t.getId(), key);
            idByKey.put(key, t.getId());
        }
        Map<String, Long> people = uniqueNames(members.findByProjectId(projectId));
        List<Dto.FieldChange> changes = new ArrayList<>();
        List<Dto.DeletedTask> deleted = new ArrayList<>();
        for (Activity a : rows) {
            if (a.getType() == ActivityType.TASK_DELETED) {
                Matcher m = DELETED_KEY.matcher(Objects.toString(a.getMessage(), ""));
                if (m.find()) deleted.add(new Dto.DeletedTask(m.group(1), a.getCreatedAt()));
                continue;
            }
            Dto.FieldChange c = normalise(a, keyById, idByKey, people);
            if (c != null) changes.add(c);
        }
        return new Dto.ChangeLog(from, changes, deleted, truncated);
    }

    /** Names that exactly one member has, to their ids. */
    static Map<String, Long> uniqueNames(List<ProjectMember> list) {
        Map<String, Long> out = new HashMap<>();
        Set<String> twice = new HashSet<>();
        for (ProjectMember m : list) {
            String name = m.getUser().getName();
            if (out.putIfAbsent(name, m.getUser().getId()) != null) twice.add(name);
        }
        twice.forEach(out::remove);
        return out;
    }

    /** One activity as a replayable change, or null when it isn't one (a title edit, an unreadable value). */
    static Dto.FieldChange normalise(Activity a, Map<Long, String> keyById, Map<String, Long> idByKey, Map<String, Long> people) {
        String field = a.getFieldName();
        if (field == null || !FIELDS.contains(field) || a.getTaskId() == null) return null;
        String key = keyById.get(a.getTaskId());
        if (key == null) return null; // the task was deleted since; its deletion is reported on its own
        String oldValue = a.getOldValue(), newValue = a.getNewValue();
        Long oldUser = null, newUser = null, blocker = null;
        switch (field) {
            case "estimate" -> {
                oldValue = number(oldValue);
                newValue = number(newValue);
            }
            case "dueDate" -> {
                oldValue = isoDate(oldValue);
                newValue = isoDate(newValue);
            }
            case "priority" -> {
                oldValue = oldValue == null ? null : oldValue.trim().toUpperCase(Locale.ROOT);
                newValue = newValue == null ? null : newValue.trim().toUpperCase(Locale.ROOT);
            }
            case "assignee" -> {
                oldUser = oldValue == null ? null : people.get(oldValue);
                newUser = newValue == null ? null : people.get(newValue);
            }
            case "dependency" -> {
                String k = newValue != null ? newValue : oldValue;
                blocker = k == null ? null : idByKey.get(k.trim().toUpperCase(Locale.ROOT));
            }
            default -> {
                return null;
            }
        }
        return new Dto.FieldChange(a.getTaskId(), key, field, oldValue, newValue, oldUser, newUser, blocker, a.getCreatedAt());
    }

    static String number(String v) {
        if (v == null) return null;
        Matcher m = NUMBER.matcher(v);
        return m.find() ? String.valueOf(Integer.parseInt(m.group(1))) : null;
    }

    static String isoDate(String v) {
        if (v == null || v.isBlank()) return null;
        try {
            return LocalDate.parse(v.trim()).toString();
        } catch (RuntimeException e) {
            return null;
        }
    }
}
