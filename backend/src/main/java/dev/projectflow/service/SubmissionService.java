package dev.projectflow.service;

import dev.projectflow.repository.TaskRepository;
import dev.projectflow.ops.Quotas;
import dev.projectflow.domain.*;
import dev.projectflow.repository.*;
import dev.projectflow.security.ProjectAccess;
import dev.projectflow.security.ProjectAccess.TaskAccess;
import dev.projectflow.web.dto.Dto;
import dev.projectflow.web.dto.Requests;
import dev.projectflow.web.error.ApiException;
import java.net.URI;
import java.time.Clock;
import java.time.Instant;
import java.util.*;
import java.util.stream.Collectors;
import org.springframework.core.io.Resource;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

/**
 * The signature workflow: evidence-based submission and criteria-based review.
 *
 * <p>Rules enforced here (never only in the UI):
 * <ul>
 *   <li>Only the assignee submits, only from To Do / In Progress, only when the checklist is complete,
 *       and only with at least one piece of evidence.</li>
 *   <li>Each submission is an immutable, numbered version with a snapshot of the acceptance criteria.</li>
 *   <li>Only a Manager/Owner who did not submit the work may review it.</li>
 *   <li>Approval requires every acceptance criterion to be marked as met; it is the only way to reach Done.</li>
 *   <li>Requesting changes requires feedback and sends the task back to In Progress.</li>
 * </ul>
 */
@Service
public class SubmissionService {

    public static final int MAX_FILES = 5;
    private static final Set<EvidenceKind> LINK_KINDS = EnumSet.of(EvidenceKind.REPOSITORY, EvidenceKind.DEPLOYMENT, EvidenceKind.LINK, EvidenceKind.SCREENSHOT, EvidenceKind.FILE);

    private final TaskRepository tasks;
    private final Quotas quotas;
    private final SubmissionRepository submissions;
    private final ReviewRepository reviews;
    private final StoredFileRepository files;
    private final ProjectMemberRepository members;
    private final UserRepository users;
    private final ProjectAccess access;
    private final TaskService taskService;
    private final ActivityService activity;
    private final NotificationService notifications;
    private final FileStorageService storage;
    private final DtoMapper mapper;
    private final Clock clock;

    public SubmissionService(SubmissionRepository submissions, ReviewRepository reviews, StoredFileRepository files, ProjectMemberRepository members,
                             UserRepository users, ProjectAccess access, TaskService taskService, ActivityService activity,
                             NotificationService notifications, FileStorageService storage, DtoMapper mapper, Clock clock,
                             TaskRepository tasks, Quotas quotas) {
        this.tasks = tasks;
        this.quotas = quotas;
        this.submissions = submissions;
        this.reviews = reviews;
        this.files = files;
        this.members = members;
        this.users = users;
        this.access = access;
        this.taskService = taskService;
        this.activity = activity;
        this.notifications = notifications;
        this.storage = storage;
        this.mapper = mapper;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public List<Dto.Submission> list(Long taskId) {
        access.requireTask(taskId);
        List<Submission> list = submissions.findByTaskIdOrderByNumberDesc(taskId);
        Map<Long, Review> byId = reviews.findBySubmissionIdIn(list.stream().map(Submission::getId).toList()).stream()
                .collect(Collectors.toMap(r -> r.getSubmission().getId(), r -> r));
        return list.stream().map(s -> mapper.submission(s, byId.get(s.getId()))).toList();
    }

    private static boolean isHttpUrl(String value) {
        try {
            URI u = URI.create(value.trim());
            return ("http".equalsIgnoreCase(u.getScheme()) || "https".equalsIgnoreCase(u.getScheme())) && u.getHost() != null;
        } catch (IllegalArgumentException e) {
            return false;
        }
    }

    private static String defaultLabel(EvidenceKind kind, String url) {
        return switch (kind) {
            case REPOSITORY -> "Repository";
            case DEPLOYMENT -> "Deployed app";
            default -> {
                try {
                    yield URI.create(url).getHost();
                } catch (Exception e) {
                    yield "Link";
                }
            }
        };
    }

    @Transactional
    public Dto.Submission submit(Long taskId, Requests.SubmissionData data, List<MultipartFile> uploads) {
        // Lock the task first: a second submit (double click, two tabs, a retry) waits here, then
        // sees the task already in review and is refused, so there's never a duplicate submission.
        tasks.lockById(taskId);
        TaskAccess a = access.requireTask(taskId);
        Task t = a.task();
        if (t.getStatus() == TaskStatus.IN_REVIEW) throw ApiException.workflow("This task already has a submission awaiting review.");
        if (t.getStatus() == TaskStatus.DONE) throw ApiException.workflow("This task is already done.");
        if (!Permissions.submitWork(a.role(), t, a.userId())) throw ApiException.forbidden("Only the assignee can submit work for this task.");

        List<String> openItems = t.getChecklist().stream().filter(c -> !c.isDone()).map(ChecklistItem::getContent).toList();
        if (!openItems.isEmpty()) {
            throw ApiException.workflow("Complete the checklist before submitting. Still open: " + String.join("; ", openItems) + ".");
        }

        List<MultipartFile> fileParts = uploads == null ? List.of() : uploads.stream().filter(f -> f != null && !f.isEmpty()).toList();
        List<Requests.EvidenceInput> links = data.evidence() == null ? List.of() : data.evidence().stream()
                .filter(e -> e.url() != null && !e.url().isBlank()).toList();
        Map<String, String> errors = new LinkedHashMap<>();
        for (int i = 0; i < links.size(); i++) {
            Requests.EvidenceInput e = links.get(i);
            if (!LINK_KINDS.contains(e.kind()) || !isHttpUrl(e.url())) errors.put("evidence." + i, "Link " + (i + 1) + " must be a full http(s) URL.");
        }
        if (fileParts.size() > MAX_FILES) errors.put("files", "Attach at most " + MAX_FILES + " files.");
        if (links.isEmpty() && fileParts.isEmpty()) errors.put("evidence", "Add at least one piece of evidence: a link or a file.");
        if (!errors.isEmpty()) throw ApiException.validation(errors);
        quotas.checkStorage(a.project().getId(), fileParts.stream().mapToLong(MultipartFile::getSize).sum());

        User me = users.findById(a.userId()).orElseThrow();
        Submission s = new Submission();
        s.setTask(t);
        s.setNumber((int) submissions.countByTaskId(t.getId()) + 1);
        s.setSubmittedBy(me);
        s.setNotes(data.notes().trim());
        s.setStatus(SubmissionStatus.PENDING);
        s.setCreatedAt(Instant.now(clock));
        for (AcceptanceCriterion c : t.getCriteria()) {
            SubmissionCriterion sc = new SubmissionCriterion();
            sc.setSubmission(s);
            sc.setCriterionId(c.getId());
            sc.setPosition(c.getPosition());
            sc.setContent(c.getContent());
            s.getCriteria().add(sc);
        }
        int pos = 0;
        for (Requests.EvidenceInput e : links) {
            EvidenceItem item = new EvidenceItem();
            item.setSubmission(s);
            item.setPosition(pos++);
            item.setKind(e.kind());
            item.setUrl(e.url().trim());
            item.setLabel(e.label() == null || e.label().isBlank() ? defaultLabel(e.kind(), e.url().trim()) : e.label().trim());
            s.getEvidence().add(item);
        }
        for (MultipartFile f : fileParts) {
            StoredFile stored = storage.store(f, a.project(), me);
            EvidenceItem item = new EvidenceItem();
            item.setSubmission(s);
            item.setPosition(pos++);
            item.setKind(FileStorageService.INLINE_TYPES.contains(stored.getContentType()) ? EvidenceKind.SCREENSHOT : EvidenceKind.FILE);
            item.setLabel(stored.getOriginalName().length() > 120 ? stored.getOriginalName().substring(0, 120) : stored.getOriginalName());
            item.setFile(stored);
            s.getEvidence().add(item);
        }
        submissions.save(s);

        taskService.workflowMove(t, TaskStatus.IN_REVIEW, me);
        String key = DtoMapper.taskKey(t);
        activity.log(a.project(), t.getId(), me, ActivityType.SUBMISSION_CREATED, "submitted " + key + " for review" + (s.getNumber() > 1 ? " (v" + s.getNumber() + ")" : ""));
        for (ProjectMember m : members.findByProjectId(a.project().getId())) {
            if (m.getRole().atLeast(Role.MANAGER)) {
                notifications.notify(m.getUser().getId(), me, NotificationType.SUBMISSION, "Work submitted for review",
                        me.getName() + " submitted " + key + " “" + t.getTitle() + "” for review (version " + s.getNumber() + ").",
                        TaskService.link(t), a.project().getId(), null);
            }
        }
        return mapper.submission(s, null);
    }

    @Transactional
    public Dto.Submission review(Long submissionId, Requests.ReviewRequest req) {
        Submission s = submissions.findById(submissionId).orElseThrow(() -> ApiException.notFound("Submission not found."));
        TaskAccess a = access.requireTask(s.getTask().getId());
        Task t = a.task();
        if (s.getStatus() != SubmissionStatus.PENDING) throw ApiException.workflow("This submission has already been reviewed.");
        if (!Permissions.atLeast(a.role(), Role.MANAGER)) throw ApiException.forbidden("Only owners and managers can review submissions.");
        if (!Permissions.reviewSubmission(a.role(), s.getSubmittedBy().getId(), a.userId())) {
            throw ApiException.forbidden("You cannot review your own submission. Ask another manager or the owner.");
        }

        Map<Long, SubmissionCriterion> criteria = s.getCriteria().stream().collect(Collectors.toMap(SubmissionCriterion::getId, c -> c));
        Map<Long, Requests.CriterionVerdict> verdicts = new LinkedHashMap<>();
        for (Requests.CriterionVerdict v : req.results() == null ? List.<Requests.CriterionVerdict>of() : req.results()) {
            if (!criteria.containsKey(v.submissionCriterionId())) throw ApiException.validation("results", "A result refers to a criterion that isn't part of this submission.");
            verdicts.put(v.submissionCriterionId(), v);
        }
        String feedback = req.feedback() == null || req.feedback().isBlank() ? null : req.feedback().trim();

        if (req.decision() == ReviewDecision.APPROVED) {
            List<String> notAssessed = criteria.values().stream().filter(c -> !verdicts.containsKey(c.getId())).map(SubmissionCriterion::getContent).toList();
            if (!notAssessed.isEmpty()) throw ApiException.validation("results", "Mark every acceptance criterion before approving.");
            List<String> unmet = verdicts.values().stream().filter(v -> !v.met()).map(v -> criteria.get(v.submissionCriterionId()).getContent()).toList();
            if (!unmet.isEmpty()) {
                throw ApiException.workflow("All acceptance criteria must be met to approve. Not met: " + String.join("; ", unmet) + ".");
            }
        } else if (feedback == null || feedback.length() < 10) {
            throw ApiException.validation("feedback", "Explain what needs to change (at least 10 characters).");
        }

        User me = users.findById(a.userId()).orElseThrow();
        Review r = new Review();
        r.setSubmission(s);
        r.setReviewer(me);
        r.setDecision(req.decision());
        r.setFeedback(feedback);
        r.setCreatedAt(Instant.now(clock));
        for (Requests.CriterionVerdict v : verdicts.values()) {
            ReviewCriterionResult result = new ReviewCriterionResult();
            result.setReview(r);
            result.setCriterion(criteria.get(v.submissionCriterionId()));
            result.setMet(v.met());
            result.setNote(v.note() == null || v.note().isBlank() ? null : v.note().trim());
            r.getResults().add(result);
        }
        reviews.save(r);

        String key = DtoMapper.taskKey(t);
        String link = TaskService.link(t);
        if (req.decision() == ReviewDecision.APPROVED) {
            s.setStatus(SubmissionStatus.APPROVED);
            taskService.workflowMove(t, TaskStatus.DONE, me);
            t.setCompletedAt(r.getCreatedAt());
            activity.log(a.project(), t.getId(), me, ActivityType.REVIEW_APPROVED, "approved " + key + " (v" + s.getNumber() + "); task is Done");
            notifications.notify(s.getSubmittedBy().getId(), me, NotificationType.REVIEW_APPROVED, "Submission approved",
                    me.getName() + " approved " + key + " “" + t.getTitle() + "”.", link, a.project().getId(), null);
        } else {
            s.setStatus(SubmissionStatus.CHANGES_REQUESTED);
            taskService.workflowMove(t, TaskStatus.IN_PROGRESS, me);
            activity.log(a.project(), t.getId(), me, ActivityType.REVIEW_CHANGES_REQUESTED, "requested changes on " + key + " (v" + s.getNumber() + ")");
            notifications.notify(s.getSubmittedBy().getId(), me, NotificationType.CHANGES_REQUESTED, "Changes requested",
                    me.getName() + " requested changes on " + key + " “" + t.getTitle() + "”.", link, a.project().getId(), null);
        }
        notifications.resolveSubmissionNotifications(link);
        return mapper.submission(s, r);
    }

    /** A stored evidence file, after checking the caller is a member of its project. */
    public record FileDownload(StoredFile file, Resource resource) {}

    @Transactional(readOnly = true)
    public FileDownload download(Long fileId) {
        StoredFile f = files.findById(fileId).orElseThrow(() -> ApiException.notFound("File not found."));
        access.require(f.getProject().getId());
        return new FileDownload(f, storage.open(f));
    }
}
