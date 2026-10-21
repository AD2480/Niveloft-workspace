package dev.projectflow.web.dto;

import dev.projectflow.domain.*;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.time.LocalDate;
import java.util.List;

/**
 * Request bodies with Bean Validation. Messages are user-facing and match the
 * frontend's own validation so errors read the same wherever they appear.
 */
public final class Requests {

    private Requests() {}

    private static final String PASSWORD_RULE = "^(?=.*[A-Za-z])(?=.*\\d).{8,72}$";

    public record Login(
            @NotBlank(message = "Email is required.") @Size(max = 254, message = "Enter a valid email address.") String email,
            @NotBlank(message = "Password is required.") @Size(max = 200, message = "Password is too long.") String password,
            Boolean remember) {}

    /** Deleting your account: your password, and the word DELETE typed to confirm. */
    public record DeleteAccount(
            @NotBlank(message = "Enter your password to confirm.") @Size(max = 200, message = "Password is too long.") String password,
            @NotBlank(message = "Type DELETE to confirm.") @Size(max = 20) String confirm) {}

    /** Hands a project to another member, who becomes its owner; the current owner becomes a manager. */
    public record TransferOwnership(@NotNull(message = "Choose the member who will own the project.") Long memberId) {}

    /** An operator switch: on or off, and why (shown in Site health and the audit log). */
    public record SetSwitch(@NotNull(message = "Say whether it's on or off.") Boolean enabled, @Size(max = 200, message = "Keep the reason under 200 characters.") String reason) {}

    /** An operator action on an account, by email. */
    public record AccountAction(
            @NotBlank(message = "Email is required.") @Size(max = 254) String email,
            @Size(max = 200, message = "Keep the reason under 200 characters.") String reason) {}

    /** Ends every session on the server (after a suspected leak); the operator's own sessions stay. */
    public record EndAllSessions(@NotBlank(message = "Say why, for the audit log.") @Size(max = 200) String reason) {}

    /**
     * {@code website} is a honeypot: hidden from people, so only bots fill it in.
     * {@code captchaToken} is the Cloudflare Turnstile token, when Turnstile is configured.
     */
    public record Register(
            @NotBlank(message = "Name is required.") @Size(min = 2, max = 80, message = "Name must be 2–80 characters.")
            @Pattern(regexp = "^[^\\p{Cntrl}<>]*$", message = "Name can’t contain < or > or control characters.") String name,
            @NotBlank(message = "Email is required.") @Email(message = "Enter a valid email address.") @Size(max = 254, message = "Enter a valid email address.") String email,
            @NotBlank(message = "Password is required.")
            @Pattern(regexp = PASSWORD_RULE, message = "Password must be 8–72 characters with at least one letter and one number.") String password,
            @NotNull(message = "Please confirm you’re 18 or older and accept the terms and the privacy policy.") @AssertTrue(message = "Please confirm you’re 18 or older and accept the terms and the privacy policy.") Boolean acceptTerms,
            @Size(max = 200) String website,
            @Size(max = 4096) String captchaToken,
            Attribution attribution) {}

    /**
     * Which campaign or site brought a visitor (UTM tags, or the referring site), sent with a new
     * account or a contact message. Never a reason to refuse the request: values are cleaned and
     * shortened when saved (see SiteRecords).
     */
    public record Attribution(String source, String medium, String campaign, String term, String content, String referrer, String landingPath) {}

    /** A message from the Contact form. {@code website} is the honeypot; {@code captchaToken} Turnstile's. */
    public record Contact(
            @NotBlank(message = "Your name is required.") @Size(min = 2, max = 80, message = "Name must be 2–80 characters.")
            @Pattern(regexp = "^[^\\p{Cntrl}<>]*$", message = "Name can’t contain < or > or control characters.") String name,
            @NotBlank(message = "Your email is required.") @Email(message = "Enter a valid email address.") @Size(max = 254, message = "Enter a valid email address.") String email,
            @NotNull(message = "Choose what it’s about.") ContactTopic topic,
            @NotBlank(message = "Write a message.") @Size(min = 10, max = 4000, message = "Write 10 to 4000 characters.") String message,
            @Size(max = 64) @Pattern(regexp = "^[A-Za-z0-9._-]*$", message = "That reference isn’t valid.") String reference,
            @Size(max = 200) @Pattern(regexp = PRINTABLE) String page,
            @Size(max = 200) String website,
            @Size(max = 4096) String captchaToken,
            Attribution attribution) {}

    public enum ContactTopic {
        QUESTION("A question"), PROBLEM("A problem"), DATA("Account or data"), FEEDBACK("Feedback"), OTHER("Something else");

        private final String label;

        ContactTopic(String label) {
            this.label = label;
        }

        public String label() {
            return label;
        }
    }

    /** Form counts from the browser: [{form, event, count}], at most 50 at a time. */
    public record FormMetrics(@NotNull @Size(max = 50) List<@NotNull @Valid FormMetric> events) {}

    public record FormMetric(@NotBlank @Size(max = 20) String form, @NotBlank @Size(max = 10) String event, @Min(1) @Max(50) int count) {}

    public record ContactHandled(boolean handled) {}

    /** A vote in the Arena: which of two answer sources gave the better answer. */
    public record ArenaVote(
            @NotNull Long projectId,
            @NotBlank @Size(max = 120) @Pattern(regexp = CONTENDER, message = "Unknown answer source.") String a,
            @NotBlank @Size(max = 120) @Pattern(regexp = CONTENDER, message = "Unknown answer source.") String b,
            @NotBlank @Pattern(regexp = "^(A|B|TIE|NEITHER)$", message = "Choose A, B, a tie or neither.") String winner) {}

    /** The built-in model, the AI in Chrome, or a server model by name. */
    public static final String CONTENDER = "^(builtin|chrome|server:[A-Za-z0-9._:/-]{1,100})$";

    /** Printable text on one line (no control characters or angle brackets); empty is fine. */
    private static final String PRINTABLE = "^[^\\p{Cntrl}<>]*$";

    /** A link from an email: confirm the address. */
    public record VerifyEmail(@NotBlank(message = "The link is incomplete.") @Size(max = 200, message = "The link is invalid.") String token) {}

    /** Ask for an emailed link (confirm again, or reset the password). Same bot checks as sign-up. */
    public record EmailLinkRequest(
            @NotBlank(message = "Email is required.") @Email(message = "Enter a valid email address.") @Size(max = 254, message = "Enter a valid email address.") String email,
            @Size(max = 200) String website,
            @Size(max = 4096) String captchaToken) {}

    public record ResetPassword(
            @NotBlank(message = "The link is incomplete.") @Size(max = 200, message = "The link is invalid.") String token,
            @NotBlank(message = "New password is required.")
            @Pattern(regexp = PASSWORD_RULE, message = "Password must be 8–72 characters with at least one letter and one number.") String password) {}

    public record UpdateProfile(
            @NotBlank(message = "Name is required.") @Size(min = 2, max = 80, message = "Name must be 2–80 characters.") String name,
            @Size(max = 80, message = "Job title must be at most 80 characters.") String jobTitle,
            @NotBlank @Pattern(regexp = "^#[0-9a-fA-F]{6}$", message = "Choose a valid colour.") String avatarColor) {}

    public record ChangePassword(
            @NotBlank(message = "Current password is required.") String currentPassword,
            @NotBlank(message = "New password is required.")
            @Pattern(regexp = PASSWORD_RULE, message = "Password must be 8–72 characters with at least one letter and one number.") String newPassword) {}

    public record ProjectRequest(
            @NotBlank(message = "Name is required.") @Size(min = 3, max = 100, message = "Name must be 3–100 characters.") String name,
            @NotBlank(message = "Key is required.")
            @Pattern(regexp = "^[A-Za-z][A-Za-z0-9]{1,5}$", message = "Key must be 2–6 letters or digits, starting with a letter.") String key,
            @Size(max = 2000, message = "Description must be at most 2000 characters.") String description,
            @Pattern(regexp = "^#[0-9a-fA-F]{6}$", message = "Choose a valid colour.") String color,
            ProjectStatus status,
            @NotNull(message = "Start date is required.") LocalDate startDate,
            LocalDate deadline,
            Long version) {}

    public record RoleChange(@NotNull(message = "Choose a valid role.") Role role) {}

    public record Invite(
            @NotBlank(message = "Email is required.") @Email(message = "Enter a valid email address.") String email,
            @NotNull(message = "Choose a role you are allowed to grant.") Role role) {}

    public record MilestoneRequest(
            @NotBlank(message = "Name is required.") @Size(min = 2, max = 100, message = "Name must be 2–100 characters.") String name,
            @Size(max = 1000, message = "Description must be at most 1000 characters.") String description,
            @NotNull(message = "Due date is required.") LocalDate dueDate,
            boolean completed) {}

    public record TaskRequest(
            @NotBlank(message = "Title is required.") @Size(min = 3, max = 200, message = "Title must be 3–200 characters.") String title,
            @Size(max = 5000, message = "Description must be at most 5000 characters.") String description,
            @NotNull(message = "Choose a valid priority.") Priority priority,
            TaskStatus status,
            Long assigneeId,
            LocalDate dueDate,
            Long milestoneId,
            /** Version the client last saw; if it differs the update is rejected (EDIT_CONFLICT). */
            Long version,
            /** Optional on create: initial acceptance criteria and checklist. */
            List<@NotBlank @Size(max = 500) String> acceptanceCriteria,
            List<@NotBlank @Size(max = 300) String> checklist,
            /** Estimated effort in working days (1–250), or null for "not estimated". */
            @Min(value = 1, message = "Estimate must be at least 1 working day.") @Max(value = 250, message = "Estimate must be at most 250 working days.") Integer estimateDays) {}

    public record StatusChange(@NotNull(message = "Choose a valid status.") TaskStatus status) {}

    public record Move(
            @NotNull(message = "Choose a valid status.") TaskStatus status,
            Long previousTaskId,
            Long nextTaskId) {}

    public record CriterionInput(Long id, @NotBlank(message = "Criterion text is required.") @Size(max = 500, message = "Each criterion must be at most 500 characters.") String text) {}

    public record CriteriaUpdate(@NotNull @Size(max = 20, message = "Add at most 20 criteria.") List<@Valid CriterionInput> items, Long version) {}

    public record ChecklistInput(Long id, @NotBlank(message = "Checklist text is required.") @Size(max = 300, message = "Each item must be at most 300 characters.") String text, boolean done) {}

    public record ChecklistUpdate(@NotNull @Size(max = 30, message = "Add at most 30 checklist items.") List<@Valid ChecklistInput> items, Long version) {}

    public record ChecklistToggle(boolean done) {}

    public record CommentBody(@NotBlank(message = "Comment is required.") @Size(max = 2000, message = "Comment must be at most 2000 characters.") String body) {}

    public record EvidenceInput(@NotNull EvidenceKind kind, @Size(max = 120) String label, @Size(max = 2048) String url) {}

    /** The JSON "data" part of a multipart submission; files arrive as separate "files" parts. */
    public record SubmissionData(
            @NotBlank(message = "Notes are required.") @Size(min = 10, max = 5000, message = "Notes must be 10–5000 characters.") String notes,
            @Size(max = 12, message = "Add at most 12 links.") List<@Valid EvidenceInput> evidence) {}

    public record CriterionVerdict(@NotNull Long submissionCriterionId, @NotNull Boolean met, @Size(max = 1000) String note) {}

    public record ReviewRequest(
            @NotNull(message = "Choose a decision.") ReviewDecision decision,
            @Size(max = 5000, message = "Feedback must be at most 5000 characters.") String feedback,
            List<@Valid CriterionVerdict> results) {}

    public record ReadFlag(Boolean read) {}

    /**
     * One task change from a planning scenario. {@code version} is the task version the scenario
     * was computed from; if the task changed since, the whole apply is rejected (EDIT_CONFLICT).
     * Null fields are left unchanged; {@code clearDueDate}/{@code unassign} make "set to none" explicit.
     */
    public record PlanChange(
            @NotNull Long taskId,
            @NotNull Long version,
            LocalDate dueDate,
            Long assigneeId,
            @Min(value = 1, message = "Estimate must be at least 1 working day.") @Max(value = 250, message = "Estimate must be at most 250 working days.") Integer estimateDays,
            boolean unassign) {}

    /** A task version the scenario was calculated from. */
    public record TaskVersion(@NotNull Long taskId, @NotNull Long version) {}

    /**
     * Everything the browser-side schedule depended on: every open task of the project with the
     * version it saw, and the ids of every dependency. If any of it changed, the scenario is stale.
     */
    public record PlanBasis(@NotNull @Size(max = 2000) List<@NotNull @Valid TaskVersion> tasks,
                            @NotNull @Size(max = 5000) List<@NotNull Long> dependencyIds) {}

    public record PlanApply(@NotNull @Size(min = 1, max = 200, message = "Choose between 1 and 200 changes.") List<@NotNull @Valid PlanChange> changes,
                            @NotNull(message = "The plan must say which data it was calculated from.") @Valid PlanBasis basis,
                            @Size(max = 200) String note) {}

    public record DependencyRequest(@NotNull(message = "Choose the task that must finish first.") Long blockerTaskId) {}

    // ------------------------------------------------------------------- AI

    /** Text for Flurry's server voice to read aloud (an answer it gave). */
    public record Speech(@NotBlank(message = "There’s nothing to read aloud.") @Size(max = 4000, message = "That’s too long to read aloud.") String text) {}

    /**
     * A question about one project. The server builds the context from the project's own records;
     * the client may add the scheduler's estimate it already shows (structured, checked against the
     * project's task keys, and always labelled as an estimate), plus up to six earlier turns.
     */
    public record AiAsk(
            @NotBlank(message = "Ask a question.") @Size(max = 500, message = "Keep the question under 500 characters.") String question,
            @Size(max = 6, message = "Send at most six earlier questions.") List<@NotNull @Valid AiTurn> previous,
            @Valid AiForecast forecast,
            /** A model from GET /api/ai/models (the Arena); the server's default when empty. */
            @Size(max = 100) @Pattern(regexp = "^[A-Za-z0-9._:/-]*$", message = "Unknown model.") String model) {}

    public record AiTurn(@NotBlank @Size(max = 500) String question, @NotBlank @Size(max = 4000) String answer) {}

    /**
     * Whether one of Flurry's answers was right; if not, which kinds of mistake (from the fixed list)
     * and what the right answer would have been. The question, answer, model and lookups are sent
     * back as the person saw them.
     */
    public record AiFeedback(
            @NotBlank @Pattern(regexp = "^(right|wrong)$", message = "Say whether the answer was right or wrong.") String verdict,
            @Size(max = 8) List<@NotBlank @Size(max = 20) String> categories,
            @Size(max = 2000, message = "Keep the correction under 2,000 characters.") String correction,
            @NotBlank @Size(max = 500) String question,
            @NotBlank @Size(max = 4000) String answer,
            @Size(max = 100) String model,
            @Size(max = 12) List<@Size(max = 120) String> lookups) {}

    /** A project document: its title and text (Markdown or plain), and the version last seen when editing. */
    public record DocumentRequest(
            @NotBlank(message = "Give the document a title.") @Size(max = 160, message = "Keep the title under 160 characters.") String title,
            @NotBlank(message = "The document has no text.") @Size(max = 200_000, message = "A document can be at most 200,000 characters; split it into parts.") String body,
            Integer version) {}

    /** Approving a document for Flurry, or withdrawing that approval. */
    public record DocumentApproval(boolean approved) {}

    /** One step of the blocker journey on the Delivery page (counted, nothing else). */
    public record JourneyStep(
            @NotBlank @Pattern(regexp = "^(shown|evidence|impact|previewed|confirmed|dismissed)$", message = "Unknown step.") String step,
            @Pattern(regexp = "^(review|late|in-progress|not-started|last)$", message = "Unknown kind of blocker.") String blockerKind,
            @Pattern(regexp = "^(review-now|ask-review|cut-scope|reassign|take-it|ask-owner)$", message = "Unknown response.") String option) {}

    /** Flurry's "Plan a project": the brief to turn into draft tasks. */
    public record AiPlan(@NotBlank(message = "Describe the work to plan.") @Size(max = 4000, message = "Keep the brief under 4,000 characters.") String brief) {}

    public record AiForecast(LocalDate finish, @Size(max = 2000) List<@NotNull @Valid AiForecastTask> tasks, @Valid AiForecastRange range) {}

    /**
     * The browser's dependency-aware simulation range for the whole project, as the page shows it.
     * The AI quotes and explains it; it never works out dates of its own.
     */
    public record AiForecastRange(
            @NotNull LocalDate optimistic,
            @NotNull LocalDate likely,
            @NotNull LocalDate cautious,
            @Min(0) @Max(100) Integer chanceByDeadlinePercent,
            @Size(max = 40) @Pattern(regexp = "^[A-Za-z0-9-]*$") String mainBlocker) {}

    /** One task of the browser's scheduler estimate. {@code assumed}: the task had no estimate, so a default duration was used. */
    public record AiForecastTask(@NotBlank @Size(max = 40) String key, @NotNull LocalDate start, @NotNull LocalDate finish, boolean late, Boolean assumed) {}
}
