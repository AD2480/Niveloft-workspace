package dev.projectflow.web;

import dev.projectflow.security.CurrentUser;
import dev.projectflow.service.*;
import dev.projectflow.web.dto.Dto;
import dev.projectflow.web.dto.Requests;
import jakarta.validation.Valid;
import java.nio.charset.StandardCharsets;
import java.util.List;
import org.springframework.core.io.Resource;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

/**
 * Endpoints addressed by the id of a child record (milestone, comment, checklist item,
 * submission, file, invitation, notification). Each service resolves the owning project
 * and checks the caller's access before doing anything.
 */
@RestController
@RequestMapping("/api")
public class ResourceController {

    private final MilestoneService milestones;
    private final CommentService comments;
    private final TaskService tasks;
    private final SubmissionService submissions;
    private final ProjectService projects;
    private final NotificationService notifications;
    private final DependencyService dependencies;

    public ResourceController(MilestoneService milestones, CommentService comments, TaskService tasks, SubmissionService submissions,
                              ProjectService projects, NotificationService notifications, DependencyService dependencies) {
        this.dependencies = dependencies;
        this.milestones = milestones;
        this.comments = comments;
        this.tasks = tasks;
        this.submissions = submissions;
        this.projects = projects;
        this.notifications = notifications;
    }

    // ------------------------------------------------------------- milestones

    @PutMapping("/milestones/{id}")
    public ApiResponse<Dto.Milestone> updateMilestone(@PathVariable Long id, @Valid @RequestBody Requests.MilestoneRequest req) {
        return ApiResponse.ok(milestones.update(id, req), "Milestone updated.");
    }

    @DeleteMapping("/milestones/{id}")
    public ApiResponse<Void> deleteMilestone(@PathVariable Long id) {
        milestones.delete(id);
        return ApiResponse.ok(null, "Milestone deleted.");
    }

    // ------------------------------------------------------ checklist/comments

    @PatchMapping("/checklist-items/{id}")
    public ApiResponse<Dto.Task> toggleChecklist(@PathVariable Long id, @RequestBody Requests.ChecklistToggle req) {
        return ApiResponse.ok(tasks.toggleChecklistItem(id, req.done()));
    }

    @PutMapping("/comments/{id}")
    public ApiResponse<Dto.Comment> editComment(@PathVariable Long id, @Valid @RequestBody Requests.CommentBody req) {
        return ApiResponse.ok(comments.edit(id, req.body()), "Comment updated.");
    }

    @DeleteMapping("/comments/{id}")
    public ApiResponse<Void> deleteComment(@PathVariable Long id) {
        comments.delete(id);
        return ApiResponse.ok(null, "Comment deleted.");
    }

    @DeleteMapping("/dependencies/{id}")
    public ApiResponse<Void> removeDependency(@PathVariable Long id) {
        dependencies.remove(id);
        return ApiResponse.ok(null, "Dependency removed.");
    }

    // ------------------------------------------------------ reviews and files

    @PostMapping("/submissions/{id}/review")
    public ApiResponse<Dto.Submission> review(@PathVariable Long id, @Valid @RequestBody Requests.ReviewRequest req) {
        return ApiResponse.ok(submissions.review(id, req), "Review recorded.");
    }

    /** Evidence download. Images that are safe to render are shown inline; everything else downloads. */
    @GetMapping("/files/{id}")
    public ResponseEntity<Resource> file(@PathVariable Long id) {
        SubmissionService.FileDownload d = submissions.download(id);
        boolean inline = FileStorageService.INLINE_TYPES.contains(d.file().getContentType());
        ContentDisposition disposition = (inline ? ContentDisposition.inline() : ContentDisposition.attachment())
                .filename(d.file().getOriginalName(), StandardCharsets.UTF_8).build();
        MediaType type = inline ? MediaType.parseMediaType(d.file().getContentType()) : MediaType.APPLICATION_OCTET_STREAM;
        return ResponseEntity.ok()
                .contentType(type)
                .contentLength(d.file().getSizeBytes())
                .header(HttpHeaders.CONTENT_DISPOSITION, disposition.toString())
                .header("X-Content-Type-Options", "nosniff")
                // Opened on its own, a file can't run scripts or reach anything (in case a browser ever renders one).
                .header("Content-Security-Policy", "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'")
                .header(HttpHeaders.CACHE_CONTROL, "private, max-age=300")
                .body(d.resource());
    }

    // ------------------------------------------------------------ invitations

    @GetMapping("/invitations/mine")
    public ApiResponse<List<Dto.Invitation>> myInvitations() {
        return ApiResponse.ok(projects.myInvitations(CurrentUser.id()));
    }

    @PostMapping("/invitations/{id}/accept")
    public ApiResponse<Dto.ProjectRef> accept(@PathVariable Long id) {
        return ApiResponse.ok(projects.respond(CurrentUser.id(), id, true), "You joined the project.");
    }

    @PostMapping("/invitations/{id}/decline")
    public ApiResponse<Dto.ProjectRef> decline(@PathVariable Long id) {
        return ApiResponse.ok(projects.respond(CurrentUser.id(), id, false), "Invitation declined.");
    }

    // ---------------------------------------------------------- notifications

    @GetMapping("/notifications")
    public ApiResponse<PageResponse<Dto.Notification>> notifications(@RequestParam(defaultValue = "ALL") String category,
                                                                     @RequestParam(defaultValue = "0") int page,
                                                                     @RequestParam(defaultValue = "20") int size) {
        return ApiResponse.ok(notifications.list(category, page, size));
    }

    @GetMapping("/notifications/unread-count")
    public ApiResponse<Dto.Count> unreadCount() {
        return ApiResponse.ok(new Dto.Count(notifications.unreadCount()));
    }

    @PatchMapping("/notifications/{id}/read")
    public ApiResponse<Dto.Notification> markRead(@PathVariable Long id, @RequestBody(required = false) Requests.ReadFlag req) {
        return ApiResponse.ok(notifications.markRead(id, req == null || req.read() == null || req.read()));
    }

    @PostMapping("/notifications/read-all")
    public ApiResponse<Dto.Count> readAll() {
        int n = notifications.markAllRead();
        return ApiResponse.ok(new Dto.Count(n), n == 0 ? "You’re all caught up." : "Marked " + n + " notification" + (n == 1 ? "" : "s") + " as read.");
    }

    @DeleteMapping("/notifications/{id}")
    public ApiResponse<Void> deleteNotification(@PathVariable Long id) {
        notifications.delete(id);
        return ApiResponse.ok(null, "Notification deleted.");
    }
}
