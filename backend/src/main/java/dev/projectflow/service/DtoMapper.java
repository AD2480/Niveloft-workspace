package dev.projectflow.service;

import dev.projectflow.domain.*;
import dev.projectflow.ops.Operators;
import dev.projectflow.repository.CommentRepository;
import dev.projectflow.repository.SubmissionRepository;
import dev.projectflow.web.dto.Dto;
import java.time.Clock;
import java.time.LocalDate;
import java.util.*;
import java.util.stream.Collectors;
import org.springframework.stereotype.Component;

/**
 * Entity → response mapping. Always called inside a transaction so lazy
 * associations can load; list mapping batches the per-task counts.
 */
@Component
public class DtoMapper {

    private final CommentRepository comments;
    private final SubmissionRepository submissions;
    private final Clock clock;
    private final Operators operators;

    public DtoMapper(CommentRepository comments, SubmissionRepository submissions, Clock clock, Operators operators) {
        this.comments = comments;
        this.submissions = submissions;
        this.clock = clock;
        this.operators = operators;
    }

    public LocalDate today() {
        return LocalDate.now(clock);
    }

    // ------------------------------------------------------------------ users

    public Dto.UserSummary summary(User u) {
        return u == null ? null : new Dto.UserSummary(u.getId(), u.getName(), u.getEmail(), u.getAvatarColor());
    }

    public Dto.User user(User u) {
        return new Dto.User(u.getId(), u.getName(), u.getEmail(), u.getAvatarColor(), u.getJobTitle(), u.getCreatedAt(), u.isEmailVerified(),
                operators != null && operators.isOperator(u.getEmail()));
    }

    // ------------------------------------------------------------------ tasks

    public static boolean isOverdue(Task t, LocalDate today) {
        return t.getStatus() != TaskStatus.DONE && t.getDueDate() != null && t.getDueDate().isBefore(today);
    }

    public static String taskKey(Task t) {
        return t.getProject().getKey() + "-" + t.getNumber();
    }

    private static Map<Long, Long> toCountMap(List<Object[]> rows) {
        Map<Long, Long> m = new HashMap<>();
        for (Object[] r : rows) m.put((Long) r[0], ((Number) r[1]).longValue());
        return m;
    }

    public List<Dto.Task> tasks(Collection<Task> list) {
        if (list.isEmpty()) return List.of();
        List<Long> ids = list.stream().map(Task::getId).toList();
        Map<Long, Long> commentCounts = toCountMap(comments.countByTaskIds(ids));
        Map<Long, Long> submissionCounts = toCountMap(submissions.countByTaskIds(ids));
        LocalDate today = today();
        return list.stream().map(t -> task(t, commentCounts.getOrDefault(t.getId(), 0L), submissionCounts.getOrDefault(t.getId(), 0L), today)).toList();
    }

    public Dto.Task task(Task t) {
        return tasks(List.of(t)).get(0);
    }

    private Dto.Task task(Task t, long commentCount, long submissionCount, LocalDate today) {
        Project p = t.getProject();
        Milestone m = t.getMilestone();
        return new Dto.Task(
                t.getId(), p.getId(), p.getKey(), p.getName(), p.getColor(), taskKey(t),
                t.getTitle(), t.getDescription(), t.getStatus(), t.getPriority(), summary(t.getAssignee()), summary(t.getReporter()),
                t.getDueDate(), m == null ? null : m.getId(), m == null ? null : m.getName(), t.getPosition(),
                commentCount, submissionCount, isOverdue(t, today), t.getCreatedAt(), t.getUpdatedAt(),
                t.getStartedAt(), t.getCompletedAt(),
                t.getCriteria().stream().map(c -> new Dto.Criterion(c.getId(), c.getPosition(), c.getContent())).toList(),
                t.getChecklist().stream().map(c -> new Dto.ChecklistItem(c.getId(), c.getPosition(), c.getContent(), c.isDone(), summary(c.getDoneBy()), c.getDoneAt())).toList(),
                t.getVersion(), t.getEstimateDays());
    }

    public Dto.TaskCounts counts(Collection<Task> list) {
        LocalDate today = today();
        int todo = 0, prog = 0, review = 0, done = 0, overdue = 0, lateTodo = 0, lateProg = 0, lateReview = 0;
        for (Task t : list) {
            switch (t.getStatus()) {
                case TODO -> todo++;
                case IN_PROGRESS -> prog++;
                case IN_REVIEW -> review++;
                case DONE -> done++;
            }
            if (isOverdue(t, today)) {
                overdue++;
                switch (t.getStatus()) {
                    case TODO -> lateTodo++;
                    case IN_PROGRESS -> lateProg++;
                    case IN_REVIEW -> lateReview++;
                    default -> { }
                }
            }
        }
        return new Dto.TaskCounts(list.size(), todo, prog, review, done, overdue, lateTodo, lateProg, lateReview);
    }

    // --------------------------------------------------------------- projects

    public HealthCalculator.Result health(Project p, Dto.TaskCounts c) {
        return HealthCalculator.calculate(p.getStatus(), p.getStartDate(), p.getDeadline(), c.total(), c.done(), c.overdue(), today());
    }

    public Dto.ProjectSummary projectSummary(Project p, Role myRole, List<Task> projectTasks, long memberCount) {
        Dto.TaskCounts c = counts(projectTasks);
        HealthCalculator.Result h = health(p, c);
        return new Dto.ProjectSummary(p.getId(), p.getKey(), p.getName(), p.getDescription(), p.getColor(), p.getStatus(),
                p.getStartDate(), p.getDeadline(), summary(p.getOwner()), myRole, memberCount, c, h.progress(), h.health(),
                p.getCreatedAt(), p.getUpdatedAt());
    }

    public Dto.ProjectDetail projectDetail(Project p, Role myRole, List<Task> projectTasks, List<Dto.Member> members) {
        Dto.TaskCounts c = counts(projectTasks);
        HealthCalculator.Result h = health(p, c);
        return new Dto.ProjectDetail(p.getId(), p.getKey(), p.getName(), p.getDescription(), p.getColor(), p.getStatus(),
                p.getStartDate(), p.getDeadline(), summary(p.getOwner()), myRole, members.size(), c, h.progress(), h.health(),
                p.getCreatedAt(), p.getUpdatedAt(), h.reasons(), h.expectedProgress(), members, p.getVersion());
    }

    private static final Map<Role, Integer> ROLE_ORDER = Map.of(Role.OWNER, 0, Role.MANAGER, 1, Role.MEMBER, 2, Role.VIEWER, 3);

    public List<Dto.Member> members(List<ProjectMember> list, List<Task> projectTasks) {
        Map<Long, Long> open = projectTasks.stream()
                .filter(t -> t.getAssignee() != null && t.getStatus() != TaskStatus.DONE)
                .collect(Collectors.groupingBy(t -> t.getAssignee().getId(), Collectors.counting()));
        return list.stream()
                .sorted(Comparator.comparing((ProjectMember m) -> ROLE_ORDER.get(m.getRole())).thenComparing(m -> m.getUser().getName()))
                .map(m -> member(m, open.getOrDefault(m.getUser().getId(), 0L).intValue()))
                .toList();
    }

    public Dto.Member member(ProjectMember m, int openTasks) {
        User u = m.getUser();
        return new Dto.Member(m.getId(), new Dto.MemberUser(u.getId(), u.getName(), u.getEmail(), u.getAvatarColor(), u.getJobTitle()),
                m.getRole(), m.getJoinedAt(), openTasks);
    }

    public Dto.Invitation invitation(Invitation i) {
        Project p = i.getProject();
        return new Dto.Invitation(i.getId(), p.getId(), p.getName(), p.getColor(), i.getEmail(), i.getRole(), i.getStatus(),
                summary(i.getInvitedBy()), i.getCreatedAt(), i.getRespondedAt());
    }

    public Dto.Milestone milestone(Milestone m, List<Task> projectTasks) {
        List<Task> linked = projectTasks.stream().filter(t -> t.getMilestone() != null && Objects.equals(t.getMilestone().getId(), m.getId())).toList();
        int done = (int) linked.stream().filter(t -> t.getStatus() == TaskStatus.DONE).count();
        int progress = linked.isEmpty() ? (m.isCompleted() ? 100 : 0) : (int) Math.round(done * 100.0 / linked.size());
        return new Dto.Milestone(m.getId(), m.getProject().getId(), m.getName(), m.getDescription(), m.getDueDate(), m.isCompleted(),
                m.getCompletedAt(), linked.size(), done, progress, m.getCreatedAt());
    }

    // ------------------------------------------------------- collaboration

    public Dto.Comment comment(Comment c) {
        return new Dto.Comment(c.getId(), c.getTask().getId(), summary(c.getAuthor()), c.getBody(), c.getCreatedAt(), c.getUpdatedAt());
    }

    public Dto.Attachment attachment(StoredFile f) {
        return f == null ? null : new Dto.Attachment(f.getId(), f.getOriginalName(), f.getSizeBytes(), f.getContentType(), "/api/files/" + f.getId());
    }

    public Dto.Submission submission(Submission s, Review review) {
        List<Dto.SubmittedCriterion> criteria = s.getCriteria().stream()
                .map(c -> new Dto.SubmittedCriterion(c.getId(), c.getCriterionId(), c.getPosition(), c.getContent())).toList();
        List<Dto.Evidence> evidence = s.getEvidence().stream()
                .map(e -> new Dto.Evidence(e.getId(), e.getKind(), e.getLabel(), e.getUrl(), attachment(e.getFile()))).toList();
        Dto.Review r = null;
        if (review != null) {
            List<Dto.CriterionResult> results = review.getResults().stream()
                    .map(x -> new Dto.CriterionResult(x.getCriterion().getId(), x.getCriterion().getContent(), x.isMet(), x.getNote())).toList();
            r = new Dto.Review(review.getId(), summary(review.getReviewer()), review.getDecision(), review.getFeedback(), review.getCreatedAt(), results);
        }
        return new Dto.Submission(s.getId(), s.getTask().getId(), s.getNumber(), summary(s.getSubmittedBy()), s.getNotes(), s.getStatus(),
                s.getCreatedAt(), criteria, evidence, r);
    }

    public Dto.Activity activity(Activity a, Map<Long, String> taskKeys) {
        Project p = a.getProject();
        return new Dto.Activity(a.getId(), p.getId(), p.getName(), a.getTaskId(), a.getTaskId() == null ? null : taskKeys.get(a.getTaskId()),
                summary(a.getActor()), a.getType(), a.getMessage(), a.getFieldName(), a.getOldValue(), a.getNewValue(), a.getCreatedAt());
    }

    public Dto.Notification notification(Notification n) {
        return new Dto.Notification(n.getId(), n.getType(), n.getTitle(), n.getMessage(), n.getLink(), n.isRead(), summary(n.getActor()),
                n.getInvitationId(), n.getCreatedAt());
    }
}
