package dev.projectflow.service;

import dev.projectflow.ops.Quotas;
import dev.projectflow.domain.*;
import dev.projectflow.repository.*;
import dev.projectflow.security.ProjectAccess;
import dev.projectflow.security.ProjectAccess.Access;
import dev.projectflow.security.ProjectAccess.TaskAccess;
import dev.projectflow.web.PageResponse;
import dev.projectflow.web.dto.Dto;
import dev.projectflow.web.dto.Requests;
import dev.projectflow.web.error.ApiException;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.function.Predicate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Tasks: queries, create/update/delete, workflow status changes, board moves, criteria and checklists. */
@Service
public class TaskService {

    /** Filters and sorting accepted by the task list endpoints. */
    public record Query(String search, String status, Priority priority, String assignee, Long milestoneId, String due,
                        String sort, String direction, int page, int size) {}

    private static final Map<TaskStatus, String> STATUS_LABEL = Map.of(
            TaskStatus.TODO, "To do", TaskStatus.IN_PROGRESS, "In progress", TaskStatus.IN_REVIEW, "In review", TaskStatus.DONE, "Done");
    private static final DateTimeFormatter DATE = DateTimeFormatter.ISO_LOCAL_DATE;

    private final TaskRepository tasks;
    private final ProjectRepository projects;
    private final ProjectMemberRepository members;
    private final MilestoneRepository milestones;
    private final UserRepository users;
    private final ChecklistItemRepository checklistItems;
    private final TaskStatusEventRepository statusEvents;
    private final NotificationRepository notificationRepo;
    private final ActivityRepository activityRepo;
    private final ProjectAccess access;
    private final ActivityService activity;
    private final NotificationService notifications;
    private final MentionNotifier mentions;
    private final DtoMapper mapper;
    private final Clock clock;
    private final Quotas quotas;
    private final dev.projectflow.repository.StoredFileRepository files;
    private final FileStorageService storage;

    public TaskService(TaskRepository tasks, ProjectRepository projects, ProjectMemberRepository members, MilestoneRepository milestones,
                       UserRepository users, ChecklistItemRepository checklistItems, TaskStatusEventRepository statusEvents,
                       NotificationRepository notificationRepo, ActivityRepository activityRepo, ProjectAccess access,
                       ActivityService activity, NotificationService notifications, MentionNotifier mentions, DtoMapper mapper, Clock clock, Quotas quotas,
                       dev.projectflow.repository.StoredFileRepository files, FileStorageService storage) {
        this.quotas = quotas;
        this.files = files;
        this.storage = storage;
        this.mentions = mentions;
        this.tasks = tasks;
        this.projects = projects;
        this.members = members;
        this.milestones = milestones;
        this.users = users;
        this.checklistItems = checklistItems;
        this.statusEvents = statusEvents;
        this.notificationRepo = notificationRepo;
        this.activityRepo = activityRepo;
        this.access = access;
        this.activity = activity;
        this.notifications = notifications;
        this.mapper = mapper;
        this.clock = clock;
    }

    private Instant now() {
        return Instant.now(clock);
    }

    public static String link(Task t) {
        return "/projects/" + t.getProject().getId() + "/tasks/" + t.getId();
    }

    public static String label(TaskStatus s) {
        return STATUS_LABEL.get(s);
    }

    // -------------------------------------------------------------- queries

    @Transactional(readOnly = true)
    public PageResponse<Dto.Task> list(Long projectId, Query q) {
        access.require(projectId);
        return page(tasks.findByProjectId(projectId), q, 20);
    }

    @Transactional(readOnly = true)
    public PageResponse<Dto.Task> mine(Long userId, Query q) {
        List<Long> projectIds = members.findByUserId(userId).stream().map(m -> m.getProject().getId()).toList();
        // Only this person's tasks are loaded (index: assignee), not every task of every project.
        List<Task> mine = projectIds.isEmpty() ? List.of() : tasks.findByAssigneeIdAndProjectIdIn(userId, projectIds);
        return page(mine, q, 20);
    }

    private PageResponse<Dto.Task> page(List<Task> all, Query q, int defaultSize) {
        List<Task> filtered = all.stream().filter(filter(q)).sorted(comparator(q)).toList();
        int size = q.size() <= 0 ? defaultSize : Math.min(q.size(), 500);
        int totalPages = Math.max(1, (int) Math.ceil(filtered.size() / (double) size));
        int page = Math.min(Math.max(q.page(), 0), totalPages - 1);
        List<Task> slice = filtered.subList(page * size, Math.min(filtered.size(), page * size + size));
        return new PageResponse<>(mapper.tasks(slice), page, size, filtered.size(), totalPages);
    }

    private Predicate<Task> filter(Query q) {
        LocalDate today = mapper.today();
        LocalDate in7 = today.plusDays(7);
        String search = q.search() == null ? "" : q.search().trim().toLowerCase();
        Long me = dev.projectflow.security.CurrentUser.id();
        return t -> {
            if (!search.isEmpty()) {
                String hay = (DtoMapper.taskKey(t) + " " + t.getTitle() + " " + Objects.toString(t.getDescription(), "")).toLowerCase();
                if (!hay.contains(search)) return false;
            }
            if (q.status() != null && !q.status().isBlank()) {
                if ("OPEN".equals(q.status())) {
                    if (t.getStatus() == TaskStatus.DONE) return false;
                } else if (!t.getStatus().name().equals(q.status())) return false;
            }
            if (q.priority() != null && t.getPriority() != q.priority()) return false;
            if (q.assignee() != null && !q.assignee().isBlank()) {
                Long assigneeId = t.getAssignee() == null ? null : t.getAssignee().getId();
                switch (q.assignee()) {
                    case "me" -> { if (!Objects.equals(assigneeId, me)) return false; }
                    case "unassigned" -> { if (assigneeId != null) return false; }
                    default -> {
                        try {
                            if (!Objects.equals(assigneeId, Long.valueOf(q.assignee()))) return false;
                        } catch (NumberFormatException e) {
                            return false;
                        }
                    }
                }
            }
            if (q.milestoneId() != null && (t.getMilestone() == null || !t.getMilestone().getId().equals(q.milestoneId()))) return false;
            if (q.due() != null && !q.due().isBlank()) {
                LocalDate d = t.getDueDate();
                switch (q.due()) {
                    case "overdue" -> { if (!DtoMapper.isOverdue(t, today)) return false; }
                    case "today" -> { if (!today.equals(d)) return false; }
                    case "week" -> { if (d == null || d.isBefore(today) || d.isAfter(in7)) return false; }
                    case "none" -> { if (d != null) return false; }
                    default -> { }
                }
            }
            return true;
        };
    }

    private Comparator<Task> comparator(Query q) {
        String sort = q.sort() == null ? "position" : q.sort();
        boolean desc = "desc".equalsIgnoreCase(q.direction());
        Comparator<Task> c = switch (sort) {
            case "dueDate" -> Comparator.comparing(Task::getDueDate, desc ? Comparator.nullsFirst(Comparator.naturalOrder()) : Comparator.nullsLast(Comparator.naturalOrder()));
            case "priority" -> Comparator.comparing((Task t) -> t.getPriority().rank()).reversed();
            case "createdAt" -> Comparator.comparing(Task::getCreatedAt).reversed();
            case "updatedAt" -> Comparator.comparing(Task::getUpdatedAt).reversed();
            case "title" -> Comparator.comparing(Task::getTitle, String.CASE_INSENSITIVE_ORDER);
            default -> Comparator.comparing((Task t) -> t.getStatus().ordinal()).thenComparingDouble(Task::getPosition);
        };
        if (desc) c = c.reversed();
        return c.thenComparing(Task::getId);
    }

    @Transactional(readOnly = true)
    public Dto.Task get(Long taskId) {
        return mapper.task(access.requireTask(taskId).task());
    }

    // --------------------------------------------------------------- create

    private record Validated(User assignee, Milestone milestone) {}

    private Validated validateRefs(Long projectId, Requests.TaskRequest req) {
        User assignee = null;
        if (req.assigneeId() != null) {
            Role r = members.findByProjectIdAndUserId(projectId, req.assigneeId()).map(ProjectMember::getRole).orElse(null);
            if (r == null || r == Role.VIEWER) throw ApiException.validation("assigneeId", "The assignee must be a project member who is not a viewer.");
            assignee = users.getReferenceById(req.assigneeId());
        }
        Milestone milestone = null;
        if (req.milestoneId() != null) {
            milestone = milestones.findById(req.milestoneId()).filter(m -> m.getProject().getId().equals(projectId))
                    .orElseThrow(() -> ApiException.validation("milestoneId", "Choose a milestone from this project."));
        }
        return new Validated(assignee, milestone);
    }

    @Transactional
    public Dto.Task create(Long projectId, Requests.TaskRequest req) {
        Access a = access.require(projectId);
        if (!Permissions.createTask(a.role())) throw ApiException.forbidden("Viewers cannot create tasks.");
        if (a.project().getStatus() == ProjectStatus.ARCHIVED) throw ApiException.conflict("Archived projects are read-only. Restore the project to add tasks.");
        quotas.checkTaskRoom(projectId);
        Validated v = validateRefs(projectId, req);
        if (!Permissions.atLeast(a.role(), Role.MANAGER) && req.assigneeId() != null && !req.assigneeId().equals(a.userId())) {
            throw ApiException.forbidden("Members can only assign new tasks to themselves.");
        }
        Project p = a.project();
        p.setTaskSeq(p.getTaskSeq() + 1);
        p.setUpdatedAt(now());
        User me = users.getReferenceById(a.userId());
        TaskStatus status = req.status() == TaskStatus.IN_PROGRESS ? TaskStatus.IN_PROGRESS : TaskStatus.TODO;
        Task t = new Task();
        t.setProject(p);
        t.setNumber(p.getTaskSeq());
        t.setTitle(req.title().trim());
        t.setDescription(blankToNull(req.description()));
        t.setStatus(status);
        t.setPriority(req.priority());
        t.setAssignee(v.assignee());
        t.setReporter(me);
        t.setDueDate(req.dueDate());
        t.setMilestone(v.milestone());
        t.setEstimateDays(req.estimateDays());
        Instant ts = now();
        t.setCreatedAt(ts);
        t.setUpdatedAt(ts);
        if (status == TaskStatus.IN_PROGRESS) t.setStartedAt(ts);
        BoardOrdering.placeBetween(tasks.findByProjectIdAndStatus(projectId, status), t, null, null);
        if (req.acceptanceCriteria() != null) {
            int i = 0;
            for (String text : req.acceptanceCriteria()) t.getCriteria().add(criterion(t, i++, text));
        }
        if (req.checklist() != null) {
            int i = 0;
            for (String text : req.checklist()) t.getChecklist().add(checklistItem(t, i++, text, false));
        }
        tasks.save(t);
        recordTransition(t, null, status, me);
        String key = DtoMapper.taskKey(t);
        activity.log(p, t.getId(), me, ActivityType.TASK_CREATED, "created " + key + " “" + t.getTitle() + "”");
        Set<Long> told = new HashSet<>();
        if (v.assignee() != null && !v.assignee().getId().equals(me.getId())) {
            User assignee = users.findById(v.assignee().getId()).orElseThrow();
            activity.log(p, t.getId(), me, ActivityType.TASK_ASSIGNED, "assigned " + key, new ActivityService.Change("assignee", null, assignee.getName()));
            notifications.notify(assignee.getId(), me, NotificationType.TASK_ASSIGNED, "New task assigned to you",
                    nameOf(me) + " assigned you " + key + " “" + t.getTitle() + "” in " + p.getName() + ".", link(t), p.getId(), null);
            told.add(assignee.getId());
        }
        // People @mentioned in the description are told (the new assignee already has been).
        mentions.notifyNew(t, users.findById(me.getId()).orElseThrow(), t.getDescription(), null, told, MentionNotifier.Where.DESCRIPTION, null);
        return mapper.task(t);
    }

    private String nameOf(User u) {
        return users.findById(u.getId()).map(User::getName).orElse("Someone");
    }

    private static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }

    private static AcceptanceCriterion criterion(Task t, int position, String text) {
        AcceptanceCriterion c = new AcceptanceCriterion();
        c.setTask(t);
        c.setPosition(position);
        c.setContent(text.trim());
        return c;
    }

    private static ChecklistItem checklistItem(Task t, int position, String text, boolean done) {
        ChecklistItem c = new ChecklistItem();
        c.setTask(t);
        c.setPosition(position);
        c.setContent(text.trim());
        c.setDone(done);
        return c;
    }

    // --------------------------------------------------------------- update

    private static void checkVersion(Task t, Long clientVersion) {
        if (clientVersion != null && clientVersion != t.getVersion()) {
            throw ApiException.editConflict("This task was changed by someone else while you were editing. Reload to see their changes, then try again.");
        }
    }

    @Transactional
    public Dto.Task update(Long taskId, Requests.TaskRequest req) {
        TaskAccess a = access.requireTask(taskId);
        Task t = a.task();
        if (!Permissions.editTask(a.role(), t, a.userId())) {
            throw ApiException.forbidden("You can only edit tasks that are assigned to you or that you created.");
        }
        checkVersion(t, req.version());
        Validated v = validateRefs(a.project().getId(), req);
        Long oldAssigneeId = t.getAssignee() == null ? null : t.getAssignee().getId();
        if (!Objects.equals(req.assigneeId(), oldAssigneeId) && !Permissions.assignTask(a.role(), t, a.userId(), req.assigneeId())) {
            throw ApiException.forbidden("Only owners and managers can assign tasks to other people.");
        }
        User me = users.findById(a.userId()).orElseThrow();
        String key = DtoMapper.taskKey(t);
        List<ActivityService.Change> changes = new ArrayList<>();
        String newTitle = req.title().trim();
        String newDescription = blankToNull(req.description());
        if (!newTitle.equals(t.getTitle())) changes.add(new ActivityService.Change("title", t.getTitle(), newTitle));
        if (!Objects.equals(newDescription, t.getDescription())) changes.add(new ActivityService.Change("description", null, null));
        if (req.priority() != t.getPriority()) changes.add(new ActivityService.Change("priority", cap(t.getPriority().name()), cap(req.priority().name())));
        if (!Objects.equals(req.dueDate(), t.getDueDate())) {
            changes.add(new ActivityService.Change("dueDate", t.getDueDate() == null ? null : DATE.format(t.getDueDate()), req.dueDate() == null ? null : DATE.format(req.dueDate())));
        }
        Long oldMilestone = t.getMilestone() == null ? null : t.getMilestone().getId();
        if (!Objects.equals(req.milestoneId(), oldMilestone)) {
            changes.add(new ActivityService.Change("milestone", t.getMilestone() == null ? null : t.getMilestone().getName(), v.milestone() == null ? null : v.milestone().getName()));
        }
        if (!Objects.equals(req.estimateDays(), t.getEstimateDays())) {
            changes.add(new ActivityService.Change("estimate", days(t.getEstimateDays()), days(req.estimateDays())));
        }
        String oldAssigneeName = t.getAssignee() == null ? null : t.getAssignee().getName();
        String oldDescription = t.getDescription();

        t.setTitle(newTitle);
        t.setDescription(newDescription);
        t.setPriority(req.priority());
        t.setDueDate(req.dueDate());
        t.setMilestone(v.milestone());
        t.setAssignee(v.assignee());
        t.setEstimateDays(req.estimateDays());
        t.setUpdatedAt(now());

        Map<String, String> labels = Map.of("title", "title", "description", "description", "priority", "priority", "dueDate", "due date", "milestone", "milestone", "estimate", "estimate");
        for (ActivityService.Change c : changes) {
            activity.log(a.project(), t.getId(), me, ActivityType.TASK_UPDATED, "changed the " + labels.get(c.field()) + " of " + key, c);
        }
        if (!Objects.equals(req.assigneeId(), oldAssigneeId)) {
            if (req.assigneeId() != null) {
                User assignee = users.findById(req.assigneeId()).orElseThrow();
                activity.log(a.project(), t.getId(), me, ActivityType.TASK_ASSIGNED, assignee.getId().equals(me.getId()) ? "took " + key : "assigned " + key,
                        new ActivityService.Change("assignee", oldAssigneeName, assignee.getName()));
                notifications.notify(assignee.getId(), me, NotificationType.TASK_ASSIGNED, "Task assigned to you",
                        me.getName() + " assigned you " + key + " “" + t.getTitle() + "” in " + a.project().getName() + ".", link(t), a.project().getId(), null);
            } else {
                activity.log(a.project(), t.getId(), me, ActivityType.TASK_ASSIGNED, "unassigned " + key, new ActivityService.Change("assignee", oldAssigneeName, null));
            }
        }
        if (!Objects.equals(newDescription, oldDescription)) {
            // Only people the edit newly mentions are told (and not someone just told they were assigned).
            Set<Long> told = !Objects.equals(req.assigneeId(), oldAssigneeId) && req.assigneeId() != null ? Set.of(req.assigneeId()) : Set.of();
            mentions.notifyNew(t, me, newDescription, oldDescription, told, MentionNotifier.Where.DESCRIPTION, null);
        }
        tasks.flush(); // bump @Version before returning it
        return mapper.task(t);
    }

    static String days(Integer d) {
        return d == null ? null : d + (d == 1 ? " working day" : " working days");
    }

    private static String cap(String enumName) {
        String s = enumName.toLowerCase().replace('_', ' ');
        return Character.toUpperCase(s.charAt(0)) + s.substring(1);
    }

    // ------------------------------------------------------ status and board

    /** Records a status transition for analytics and stamps first-start time. Called for every status change. */
    public void recordTransition(Task t, TaskStatus from, TaskStatus to, User actor) {
        if (to == TaskStatus.IN_PROGRESS && t.getStartedAt() == null) t.setStartedAt(now());
        TaskStatusEvent e = new TaskStatusEvent();
        e.setTask(t);
        e.setProjectId(t.getProject().getId());
        e.setFromStatus(from);
        e.setToStatus(to);
        e.setActor(actor);
        e.setOccurredAt(now());
        statusEvents.save(e);
    }

    /** Moves a task to the end of another column as part of the submit/review workflow. */
    public void workflowMove(Task t, TaskStatus to, User actor) {
        TaskStatus from = t.getStatus();
        t.setStatus(to);
        BoardOrdering.placeBetween(tasks.findByProjectIdAndStatus(t.getProject().getId(), to), t, null, null);
        t.setUpdatedAt(now());
        recordTransition(t, from, to, actor);
        activity.log(t.getProject(), t.getId(), actor, ActivityType.TASK_STATUS_CHANGED, "moved " + DtoMapper.taskKey(t),
                new ActivityService.Change("status", label(from), label(to)));
    }

    private void changeStatus(TaskAccess a, TaskStatus to, Long previousId, Long nextId) {
        Task t = a.task();
        TaskStatus from = t.getStatus();
        if (from != to) {
            String blocked = Permissions.statusChangeBlockedReason(from, to);
            boolean managerReopen = from == TaskStatus.DONE && Permissions.atLeast(a.role(), Role.MANAGER);
            // Server-side guarantee: IN_REVIEW and DONE are only reachable through submit and approve.
            if (blocked != null && !managerReopen) throw ApiException.workflow(blocked);
            if (!Permissions.changeStatus(a.role(), t, a.userId(), to)) {
                throw ApiException.forbidden("Only the assignee or a manager can change this task’s status.");
            }
        } else if (!Permissions.createTask(a.role())) {
            throw ApiException.forbidden("Viewers cannot reorder tasks.");
        }
        if (a.project().getStatus() == ProjectStatus.ARCHIVED) throw ApiException.conflict("Archived projects are read-only.");
        t.setStatus(to);
        BoardOrdering.placeBetween(tasks.findByProjectIdAndStatus(a.project().getId(), to), t, previousId, nextId);
        if (from != to) {
            User me = users.findById(a.userId()).orElseThrow();
            if (from == TaskStatus.DONE) t.setCompletedAt(null);
            t.setUpdatedAt(now());
            recordTransition(t, from, to, me);
            activity.log(a.project(), t.getId(), me, ActivityType.TASK_STATUS_CHANGED,
                    (from == TaskStatus.DONE ? "reopened " : "moved ") + DtoMapper.taskKey(t), new ActivityService.Change("status", label(from), label(to)));
        }
    }

    @Transactional
    public Dto.Task setStatus(Long taskId, TaskStatus to) {
        TaskAccess a = access.requireTask(taskId);
        changeStatus(a, to, null, null);
        tasks.flush();
        return mapper.task(a.task());
    }

    @Transactional
    public Dto.Task move(Long taskId, Requests.Move req) {
        TaskAccess a = access.requireTask(taskId);
        Map<String, String> errors = new LinkedHashMap<>();
        checkNeighbour(a, req.status(), req.previousTaskId(), "previousTaskId", "The previous task must be in the destination column.", errors);
        checkNeighbour(a, req.status(), req.nextTaskId(), "nextTaskId", "The next task must be in the destination column.", errors);
        if (!errors.isEmpty()) throw ApiException.validation(errors);
        changeStatus(a, req.status(), req.previousTaskId(), req.nextTaskId());
        tasks.flush();
        return mapper.task(a.task());
    }

    private void checkNeighbour(TaskAccess a, TaskStatus to, Long id, String field, String message, Map<String, String> errors) {
        if (id == null) return;
        boolean ok = tasks.findById(id).filter(n -> n.getProject().getId().equals(a.project().getId()) && n.getStatus() == to && !n.getId().equals(a.task().getId())).isPresent();
        if (!ok) errors.put(field, message);
    }

    @Transactional
    public void delete(Long taskId) {
        TaskAccess a = access.requireTask(taskId);
        Task t = a.task();
        if (!Permissions.deleteTask(a.role(), t, a.userId())) {
            throw ApiException.forbidden("Only managers can delete tasks (members can delete their own tasks while they are to do).");
        }
        String key = DtoMapper.taskKey(t);
        String title = t.getTitle();
        activityRepo.detachTask(t.getId()); // keep history, drop the link
        notificationRepo.deleteByLink(link(t));
        notificationRepo.deleteByLinkStartingWith(link(t) + "#");
        // Evidence files belong to the task's submissions: remove their rows and bytes too, not just the links.
        List<StoredFile> evidence = files.findEvidenceOfTask(t.getId());
        List<String> keys = evidence.stream().map(StoredFile::getStorageKey).toList();
        tasks.delete(t);
        tasks.flush();
        if (!evidence.isEmpty()) {
            files.deleteAllByIdInBatch(evidence.stream().map(StoredFile::getId).toList());
            org.springframework.transaction.support.TransactionSynchronizationManager.registerSynchronization(
                    new org.springframework.transaction.support.TransactionSynchronization() {
                        @Override
                        public void afterCommit() {
                            storage.deleteKeys(keys);
                        }
                    });
        }
        activity.log(a.project(), null, users.getReferenceById(a.userId()), ActivityType.TASK_DELETED, "deleted " + key + " “" + title + "”");
    }

    // ------------------------------------------------ criteria and checklist

    private void requireEditable(TaskAccess a, String what) {
        Task t = a.task();
        if (!Permissions.editTask(a.role(), t, a.userId())) {
            throw ApiException.forbidden("You can only edit tasks that are assigned to you or that you created.");
        }
        if (t.getStatus() == TaskStatus.IN_REVIEW) throw ApiException.workflow(what + " are locked while the task is in review.");
        if (t.getStatus() == TaskStatus.DONE) throw ApiException.workflow("Reopen the task to change its " + what.toLowerCase() + ".");
    }

    @Transactional
    public Dto.Task updateCriteria(Long taskId, Requests.CriteriaUpdate req) {
        TaskAccess a = access.requireTask(taskId);
        requireEditable(a, "Acceptance criteria");
        Task t = a.task();
        checkVersion(t, req.version());
        int before = t.getCriteria().size();
        Map<Long, AcceptanceCriterion> existing = new HashMap<>();
        t.getCriteria().forEach(c -> existing.put(c.getId(), c));
        List<AcceptanceCriterion> next = new ArrayList<>();
        int i = 0;
        for (Requests.CriterionInput in : req.items()) {
            AcceptanceCriterion c = in.id() == null ? null : existing.get(in.id());
            if (c == null) c = criterion(t, i, in.text());
            c.setPosition(i++);
            c.setContent(in.text().trim());
            next.add(c);
        }
        t.getCriteria().clear();
        t.getCriteria().addAll(next);
        t.setUpdatedAt(now());
        activity.log(a.project(), t.getId(), users.getReferenceById(a.userId()), ActivityType.CRITERIA_UPDATED,
                "updated the acceptance criteria of " + DtoMapper.taskKey(t), new ActivityService.Change("criteria", before + " criteria", next.size() + " criteria"));
        tasks.flush();
        return mapper.task(t);
    }

    @Transactional
    public Dto.Task updateChecklist(Long taskId, Requests.ChecklistUpdate req) {
        TaskAccess a = access.requireTask(taskId);
        requireEditable(a, "Checklist items");
        Task t = a.task();
        checkVersion(t, req.version());
        Map<Long, ChecklistItem> existing = new HashMap<>();
        t.getChecklist().forEach(c -> existing.put(c.getId(), c));
        User me = users.getReferenceById(a.userId());
        List<ChecklistItem> next = new ArrayList<>();
        int i = 0;
        for (Requests.ChecklistInput in : req.items()) {
            ChecklistItem c = in.id() == null ? null : existing.get(in.id());
            if (c == null) c = checklistItem(t, i, in.text(), false);
            c.setPosition(i++);
            c.setContent(in.text().trim());
            setDone(c, in.done(), me);
            next.add(c);
        }
        t.getChecklist().clear();
        t.getChecklist().addAll(next);
        t.setUpdatedAt(now());
        activity.log(a.project(), t.getId(), me, ActivityType.CHECKLIST_UPDATED, "edited the checklist of " + DtoMapper.taskKey(t), checklistChange(null, next));
        tasks.flush();
        return mapper.task(t);
    }

    private void setDone(ChecklistItem c, boolean done, User me) {
        if (done && !c.isDone()) {
            c.setDoneBy(me);
            c.setDoneAt(now());
        } else if (!done) {
            c.setDoneBy(null);
            c.setDoneAt(null);
        }
        c.setDone(done);
    }

    private static ActivityService.Change checklistChange(String before, List<ChecklistItem> items) {
        long done = items.stream().filter(ChecklistItem::isDone).count();
        return new ActivityService.Change("checklist", before, done + "/" + items.size() + " done");
    }

    @Transactional
    public Dto.Task toggleChecklistItem(Long itemId, boolean done) {
        ChecklistItem item = checklistItems.findById(itemId).orElseThrow(() -> ApiException.notFound("Checklist item not found."));
        TaskAccess a = access.requireTask(item.getTask().getId());
        Task t = a.task();
        if (!Permissions.tickChecklist(a.role(), t, a.userId())) throw ApiException.forbidden("Only the assignee, the reporter or a manager can tick checklist items.");
        if (t.getStatus() == TaskStatus.IN_REVIEW || t.getStatus() == TaskStatus.DONE) {
            throw ApiException.workflow("The checklist is locked while the task is in review or done.");
        }
        long doneBefore = t.getChecklist().stream().filter(ChecklistItem::isDone).count();
        User me = users.getReferenceById(a.userId());
        setDone(item, done, me);
        t.setUpdatedAt(now());
        activity.log(a.project(), t.getId(), me, ActivityType.CHECKLIST_UPDATED,
                (done ? "ticked “" : "unticked “") + item.getContent() + "” on " + DtoMapper.taskKey(t),
                checklistChange(doneBefore + "/" + t.getChecklist().size() + " done", t.getChecklist()));
        tasks.flush();
        return mapper.task(t);
    }
}
