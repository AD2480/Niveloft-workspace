package dev.projectflow.web.dto;

import dev.projectflow.domain.*;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;

/**
 * Response shapes. Each record matches a TypeScript interface in
 * {@code frontend/src/api/types.ts}; keep the two in sync.
 */
public final class Dto {

    private Dto() {}

    public record UserSummary(Long id, String name, String email, String avatarColor) {}

    /** {@code operator}: this person runs the site (OPERATOR_EMAILS) and may open Site health. */
    public record User(Long id, String name, String email, String avatarColor, String jobTitle, Instant createdAt, boolean emailVerified, boolean operator) {}

    public record MemberUser(Long id, String name, String email, String avatarColor, String jobTitle) {}

    /**
     * A signed-in session. When the account must confirm its email first, {@code token} and
     * {@code user} are null, {@code verificationRequired} is true and {@code email} says where the link went.
     */
    public record AuthResponse(String token, String tokenType, long expiresIn, User user, boolean verificationRequired, String email) {
        public static AuthResponse pendingVerification(String email) {
            return new AuthResponse(null, "Bearer", 0, null, true, email);
        }
    }

    /** A confirmed address; the person signs in next. */
    public record VerifiedEmail(String email) {}

    /** What the sign-in pages need to know about this server's account setup. */
    /** {@code rememberDays}: how long "keep me signed in" lasts; 0 when it's off on this server. */
    public record AuthOptions(boolean registrationOpen, boolean emailDelivery, boolean emailVerificationRequired, boolean passwordReset, boolean turnstile,
                              int rememberDays) {}

    /** One of my sign-ins. {@code network} is coarse (an IPv4 /24 or IPv6 /48). */
    public record SessionInfo(long id, String device, String network, Instant createdAt, Instant lastSeenAt, Instant expiresAt, boolean remember,
                              boolean current) {}

    /** A sensitive operation, as the audit log recorded it. */
    public record AuditEvent(long id, Instant at, String actor, String action, String target, String outcome, String detail) {}

    /** What deleting my account would do: projects it can't be deleted with, and projects that go with it. */
    public record DeletionCheck(List<String> blockedBy, List<String> deletedWith, boolean canDelete) {}

    /** An operator switch. */
    public record OpsSwitch(String name, String stops, boolean enabled, String reason, Instant changedAt) {}

    /** Tasks per status; {@code overdue} is open work past its due date, also split by the status it is in. */
    public record TaskCounts(int total, int todo, int inProgress, int inReview, int done, int overdue,
            int overdueTodo, int overdueInProgress, int overdueInReview) {}

    public record ProjectSummary(
            Long id, String key, String name, String description, String color, ProjectStatus status,
            LocalDate startDate, LocalDate deadline, UserSummary owner, Role myRole, long memberCount,
            TaskCounts taskCounts, int progress, String health, Instant createdAt, Instant updatedAt) {}

    public record Member(Long id, MemberUser user, Role role, Instant joinedAt, int openTaskCount) {}

    public record ProjectDetail(
            Long id, String key, String name, String description, String color, ProjectStatus status,
            LocalDate startDate, LocalDate deadline, UserSummary owner, Role myRole, long memberCount,
            TaskCounts taskCounts, int progress, String health, Instant createdAt, Instant updatedAt,
            List<String> healthReasons, Integer expectedProgress, List<Member> members, long version) {}

    public record Invitation(
            Long id, Long projectId, String projectName, String projectColor, String email, Role role,
            InvitationStatus status, UserSummary invitedBy, Instant createdAt, Instant respondedAt) {}

    public record Milestone(
            Long id, Long projectId, String name, String description, LocalDate dueDate, boolean completed,
            Instant completedAt, int taskCount, int doneCount, int progress, Instant createdAt) {}

    public record Criterion(Long id, int position, String text) {}

    /** The fields of a task that the dependency map and timeline need. */
    public record DependencyTask(
            Long id, String key, String title, TaskStatus status, LocalDate dueDate, UserSummary assignee, boolean overdue,
            Instant startedAt, Instant completedAt, Long milestoneId) {}

    /** blocker must be done before blocked can finish. */
    public record Dependency(Long id, Long projectId, DependencyTask blocker, DependencyTask blocked, UserSummary createdBy, Instant createdAt) {}

    public record ChecklistItem(Long id, int position, String text, boolean done, UserSummary doneBy, Instant doneAt) {}

    public record Task(
            Long id, Long projectId, String projectKey, String projectName, String projectColor, String key,
            String title, String description, TaskStatus status, Priority priority, UserSummary assignee,
            UserSummary reporter, LocalDate dueDate, Long milestoneId, String milestoneName, double position,
            long commentCount, long submissionCount, boolean overdue, Instant createdAt, Instant updatedAt,
            Instant startedAt, Instant completedAt, List<Criterion> acceptanceCriteria, List<ChecklistItem> checklist,
            long version, Integer estimateDays) {}

    /** Result of applying a planning scenario. */
    public record PlanResult(int changedTasks, List<Task> tasks) {}

    public record Comment(Long id, Long taskId, UserSummary author, String body, Instant createdAt, Instant updatedAt) {}

    /**
     * Where a task is mentioned (a backlink): another task's description, or a comment on another
     * task, in a project the reader belongs to. {@code source} is DESCRIPTION or COMMENT.
     */
    public record TaskMention(String source, Long taskId, String taskKey, String taskTitle, TaskStatus taskStatus, Long projectId, String projectName,
                              Long commentId, UserSummary author, String excerpt, Instant at) {}

    public record Attachment(Long id, String fileName, long size, String contentType, String url) {}

    public record Evidence(Long id, EvidenceKind kind, String label, String url, Attachment file) {}

    public record SubmittedCriterion(Long id, Long criterionId, int position, String text) {}

    public record CriterionResult(Long submissionCriterionId, String text, boolean met, String note) {}

    public record Review(Long id, UserSummary reviewer, ReviewDecision decision, String feedback, Instant createdAt, List<CriterionResult> results) {}

    public record Submission(
            Long id, Long taskId, int version, UserSummary submittedBy, String notes, SubmissionStatus status,
            Instant createdAt, List<SubmittedCriterion> criteria, List<Evidence> evidence, Review review) {}

    public record Activity(
            Long id, Long projectId, String projectName, Long taskId, String taskKey, UserSummary actor,
            ActivityType type, String message, String field, String oldValue, String newValue, Instant createdAt) {}

    /**
     * "Since you were last here": what other people did in your projects after you last caught up,
     * counted by kind, with the latest few. {@code since} is null before your first visit; when the
     * last visit is too long ago, counting starts at a cut-off instead ({@code capped}).
     */
    public record CatchUp(Instant since, boolean capped, Map<ActivityType, Long> counts, long dueDateChanges, List<Activity> latest) {}

    public record Notification(
            Long id, NotificationType type, String title, String message, String link, boolean read,
            UserSummary actor, Long invitationId, Instant createdAt) {}

    public record TrendPoint(LocalDate weekStart, int created, int completed) {}

    public record StatusCount(TaskStatus status, int count) {}

    public record PriorityCount(Priority priority, int count) {}

    public record WorkloadRow(UserSummary user, int todo, int inProgress, int inReview, int done, int overdue, int open) {}

    public record ProjectAnalytics(
            Long projectId, int progress, Integer expectedProgress, String health, List<String> healthReasons,
            TaskCounts taskCounts, List<StatusCount> statusDistribution, List<PriorityCount> priorityDistribution,
            List<WorkloadRow> workload, List<TrendPoint> completionTrend, List<Task> overdueTasks,
            List<Task> upcomingDeadlines, List<Milestone> milestones, Double averageCycleDays, Integer approvalRate,
            List<FlowPoint> flow, ReviewStats reviewStats, List<TimeInStatus> timeInStatus) {}

    /** Tasks in each status at the end of a day, reconstructed from the status-change history. */
    public record FlowPoint(LocalDate date, int todo, int inProgress, int inReview, int done) {}

    /** One recorded status change; the 3D model replays these to rebuild the project at any moment. */
    public record StatusChange(Long taskId, TaskStatus from, TaskStatus to, Instant at) {}

    /**
     * Review flow from submissions and reviews. reworkRate = share of reviews that requested changes;
     * roundsToApproval = average number of submissions per approved task.
     */
    public record ReviewStats(int submissions, int reviewed, int pending, Double medianHoursToReview, Integer reworkRate, Double roundsToApproval) {}

    /** How long tasks stayed in a status (completed stays only), from the status-change history. */
    public record TimeInStatus(TaskStatus status, Double medianDays, int samples) {}

    /** A deadline or milestone soon; {@code key} is the task's key (null for milestones). */
    public record UpcomingItem(
            String type, Long id, String title, String key, LocalDate date, Long projectId, String projectName,
            String projectColor, String link, boolean overdue) {}

    public record DashboardStats(int activeProjects, int myOpenTasks, int myOverdueTasks, int awaitingMyReview, int completedThisWeek) {}

    public record Dashboard(
            DashboardStats stats, List<Task> myTasks, List<Task> reviewQueue, List<ProjectSummary> projects,
            List<UpcomingItem> upcoming, List<TrendPoint> completionTrend, List<Activity> recentActivity,
            List<AttentionItem> attention, List<ApprovedItem> recentlyApproved) {}

    /**
     * Something that needs a decision, with the rule that raised it and the records it is about.
     * kind: REVIEW_WAITING, CHANGES_REQUESTED, OVERDUE, DUE_SOON, AWAITING_REVIEW, PROJECT_RISK,
     * MILESTONE_RISK, WORKLOAD, UNASSIGNED, BLOCKED, BLOCKING. severity: HIGH, MEDIUM, LOW.
     */
    public record AttentionItem(
            String id, String kind, String severity, String title, String reason, List<String> refs, String link,
            Long projectId, String projectName, String projectColor, LocalDate date) {}

    /** Recently approved work and the evidence it was approved on. */
    public record ApprovedItem(
            Long taskId, String taskKey, String title, Long projectId, String projectName, String projectColor,
            Instant approvedAt, UserSummary reviewer, UserSummary submittedBy, int version, int evidenceCount,
            int criteriaCount, String link) {}

    public record SearchHit(String type, Long id, String key, String title, String subtitle, String color, TaskStatus status, String link) {}

    public record SearchResult(String query, List<SearchHit> projects, List<SearchHit> tasks) {}

    public record CalendarEvent(
            String id, String type, String title, LocalDate date, Long projectId, String projectName,
            String projectColor, TaskStatus status, Priority priority, boolean completed, boolean overdue, String link) {}

    public record Count(long count) {}

    // ------------------------------------------------------------------- AI

    /** Whether AI assistance is usable; when not, {@code reason} says why (never a fake answer). */
    /**
     * {@code tools}: Flurry may look things up (function calling) with this provider and model.
     * {@code voice}: the server voice for reading answers aloud ("elevenlabs"), or null for the browser's own.
     */
    public record AiStatus(boolean available, String provider, String model, String reason, int remainingThisHour, boolean tools, String voice) {}

    public record AiCriterionNote(Long submissionCriterionId, String criterion, String whatToCheck, String concern) {}

    /**
     * Review assistance: suggestions for the reviewer, who decides. {@code limits} lists what the AI
     * did not or could not do (e.g. it never opened links or files).
     */
    public record AiReviewAssist(String model, List<AiCriterionNote> criteria, String draftFeedback, List<String> limits) {}

    public record AiCriteriaSuggestion(String model, List<String> criteria, List<String> limits) {}

    public record AiSummary(String model, String text, List<String> limits) {}

    /**
     * An answer about one project. {@code citedTasks} only contains keys that exist in the project;
     * {@code notInRecords} lists what the question needed but the records don't contain, kept
     * apart from the answer so "unknown" never reads as "no".
     */
    public record AiAnswer(String model, String answer, List<String> citedTasks, List<String> notInRecords, List<String> limits, Instant asOf,
                           List<AiProposal> proposals, List<AiLookup> lookedUp) {}

    /**
     * One thing Flurry looked up to answer (a tool call), as the person sees it: "Read ONB-9",
     * "Searched tasks for “passkey”". {@code result}: found; nothing (read, and the records show
     * nothing, which isn't proof it didn't happen); unavailable (couldn't be read, so unknown); or
     * declined (a suggestion that wasn't noted).
     */
    public record AiLookup(String tool, String label, String result, List<AiRef> refs) {}

    /**
     * A record a lookup read, so "How I found this" can link to it: {@code kind} is task, comment,
     * submission, review or document. {@code taskId} and {@code taskKey} name the task it belongs to
     * (empty for a document); {@code id} is the comment's, submission's or review's id, or the
     * document passage's. Only records of the project asked about, which the person can already open.
     */
    public record AiRef(String kind, String taskKey, Long taskId, Long id, String label, Long documentId) {
        public static AiRef task(String key, Long taskId, String label) {
            return new AiRef("task", key, taskId, null, label, null);
        }

        public static AiRef on(String kind, String key, Long taskId, Long id, String label) {
            return new AiRef(kind, key, taskId, id, label, null);
        }
    }

    /**
     * Something the assistant suggests doing. Never applied by the server: the app shows it for a
     * person to review and confirm, and then calls the normal endpoints with their permissions.
     * {@code type} is CREATE_TASK (title, priority, dueDate, assigneeName, estimateDays) or
     * START_TASK (taskKey).
     */
    public record AiProposal(String type, String taskKey, String title, String description, String priority, LocalDate dueDate, String assigneeName,
                             Integer estimateDays) {}

    /**
     * A draft plan from a brief (Flurry's "Plan a project"). Due dates and owners appear only where
     * the brief states them; {@code dependsOn} holds positions of earlier tasks in the same plan.
     * Nothing is created: the app shows the draft and the person confirms the tasks they want.
     */
    public record AiPlan(String model, List<AiPlanTask> tasks, List<String> questions, List<String> limits) {}

    public record AiPlanTask(String title, String description, String priority, LocalDate dueDate, String assigneeName, Integer estimateDays,
                             List<Integer> dependsOn) {}

    public record ProjectRef(Long projectId) {}

    /** One wrong answer someone corrected. */
    public record AiFeedbackItem(Long id, String question, String answer, List<String> categories, String correction, String model, String lookups, Instant at) {}

    public record AiFeedbackModel(String model, long right, long wrong) {}

    /**
     * Corrections to Flurry in a project: how many answers were rated right and wrong, the kinds of
     * mistake, per model, how many wrong answers were written without looking anything up, and the
     * latest corrections. {@code kinds} names each kind of mistake.
     */
    public record AiFeedbackSummary(Instant since, int days, long rated, long right, long wrong, Map<String, Long> byKind, List<AiFeedbackModel> byModel,
                                    long withoutLookups, long wrongWithoutLookups, List<AiFeedbackItem> latest, Map<String, String> kinds) {}

    /** A project document in the list: no text, only what it is and where it stands. */
    public record DocumentSummary(Long id, String title, String status, int chars, int passages, UserSummary updatedBy, Instant updatedAt, UserSummary approvedBy,
                                  Instant approvedAt, boolean mine, int version) {}

    /** One passage of a document: the part Flurry cites, with the headings above it. */
    public record DocumentPassage(Long id, int ordinal, String heading, String content) {}

    /** A project document with its text and passages, and what the person may do with it. */
    public record Document(Long id, Long projectId, String title, String body, String status, UserSummary createdBy, Instant createdAt, UserSummary updatedBy,
                           Instant updatedAt, UserSummary approvedBy, Instant approvedAt, int version, List<DocumentPassage> passages, boolean canEdit,
                           boolean canApprove, boolean canDelete) {}

    /**
     * One recorded change that moves a forecast, normalised for replay: {@code field} is estimate
     * (working days as a number), dueDate (ISO date), priority (LOW…URGENT), assignee (names, with
     * the member's id when the name is unambiguous) or dependency (the blocker's key: {@code
     * newValue} when it was added, {@code oldValue} when it was removed, with its id if it still
     * exists).
     */
    public record FieldChange(Long taskId, String taskKey, String field, String oldValue, String newValue, Long oldUserId, Long newUserId, Long blockerId, Instant at) {}

    public record DeletedTask(String key, Instant at) {}

    /**
     * How the blocker journey was used in a project: counts per step (shown, evidence, impact,
     * previewed, confirmed, dismissed), and per kind of response, its steps.
     */
    /** The trained model on trial, as the server read it from its file. */
    public record ForecastModelInfo(String id, String name, String description, String kind, Instant trainedThrough, int trainedTasks,
                                    List<String> trainedProjects, boolean synthetic) {}

    /** Work in progress: how long it has been going, and the two forecasts of its work in working days, as first made. */
    public record ForecastTrialOpen(Long taskId, String taskKey, Instant readyAt, double elapsedDays, double modelDays, double niveloftDays, Instant predictedAt) {}

    /**
     * How the two forecasts did on finished work. A miss is a factor: 1.30 means 30% too long or
     * too short on a typical task. Null when there's nothing to score.
     */
    public record ForecastTrialScore(int tasks, Double modelMiss, Double niveloftMiss, int modelCloser, int niveloftCloser) {}

    public record ForecastTrialResult(Long taskId, String taskKey, double modelDays, double niveloftDays, double actualDays, boolean beforeFinish, Instant finishedAt) {}

    /** The forecast model trial for one project: what's on trial, the open forecasts, and how each forecast has done. */
    public record ForecastTrial(boolean available, String reason, ForecastModelInfo model, List<ForecastTrialOpen> open, ForecastTrialScore beforeFinish,
                                ForecastTrialScore afterTheFact, List<ForecastTrialResult> recent, String verdict, Instant asOf) {}

    public record JourneySummary(Instant since, int days, Map<String, Long> steps, Map<String, Map<String, Long>> responses) {}

    /** What was recorded since a moment that a forecast replay needs. {@code truncated}: more changes than are sent. */
    public record ChangeLog(Instant since, List<FieldChange> changes, List<DeletedTask> deleted, boolean truncated) {}

    // ------------------------------------------------------------------ AI models, contact, site health, arena

    /** A model the server can answer with right now; {@code isDefault}: used when none is asked for. */
    public record AiModel(String name, String provider, boolean isDefault) {}

    /** {@code delivered}: emailed to the operator as well as saved. */
    public record ContactReceipt(Long id, boolean delivered) {}

    public record ContactMessage(Long id, String name, String email, String topic, String message, String reference, String page, String source,
                                 Instant createdAt, boolean handled) {}

    public record FormStats(String form, long views, long submits, long successes, long invalid, long rejected, long failed) {}

    public record SignupSource(String source, String medium, String campaign, long count) {}

    public record Signups(long total, long attributed, List<SignupSource> sources) {}

    public record ContactSummary(long open, long total, List<ContactMessage> recent) {}

    public record Spending(long aiRequestsToday, long aiRequestsPerDay, long aiTokensThisMonth, long aiTokensPerMonth,
                           long emailsToday, long emailsPerDay, long emailsThisMonth, long emailsPerMonth) {}

    public record SiteHealth(int days, LocalDate from, LocalDate to, List<FormStats> forms, Signups signups, ContactSummary contact, Spending spending,
                             long arenaVotes) {}

    public record ArenaStanding(String contender, long votes, long wins, long losses, long ties, long bothBad) {}

    public record ArenaScoreboard(long totalVotes, long myVotes, List<ArenaStanding> standings) {}
}
