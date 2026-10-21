package dev.projectflow.web;

import dev.projectflow.domain.Priority;
import dev.projectflow.security.CurrentUser;
import dev.projectflow.service.*;
import dev.projectflow.web.dto.Dto;
import dev.projectflow.web.dto.Requests;
import jakarta.validation.Valid;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

/** Task endpoints: details, workflow, board moves, criteria, checklist, comments, submissions. */
@RestController
@RequestMapping("/api/tasks")
public class TaskController {

    private final TaskService tasks;
    private final CommentService comments;
    private final SubmissionService submissions;
    private final ActivityService activity;
    private final DependencyService dependencies;
    private final BacklinkService backlinks;

    public TaskController(TaskService tasks, CommentService comments, SubmissionService submissions, ActivityService activity, DependencyService dependencies,
                          BacklinkService backlinks) {
        this.backlinks = backlinks;
        this.dependencies = dependencies;
        this.tasks = tasks;
        this.comments = comments;
        this.submissions = submissions;
        this.activity = activity;
    }

    @GetMapping("/mine")
    public ApiResponse<PageResponse<Dto.Task>> mine(@RequestParam(required = false) String search,
                                                    @RequestParam(required = false) String status,
                                                    @RequestParam(required = false) Priority priority,
                                                    @RequestParam(required = false) String due,
                                                    @RequestParam(defaultValue = "dueDate") String sort,
                                                    @RequestParam(defaultValue = "asc") String direction,
                                                    @RequestParam(defaultValue = "0") int page,
                                                    @RequestParam(defaultValue = "20") int size) {
        return ApiResponse.ok(tasks.mine(CurrentUser.id(), new TaskService.Query(search, status, priority, null, null, due, sort, direction, page, size)));
    }

    @GetMapping("/{taskId}")
    @PreAuthorize("@projectAccess.canAccessTask(#taskId)")
    public ApiResponse<Dto.Task> get(@PathVariable Long taskId) {
        return ApiResponse.ok(tasks.get(taskId));
    }

    @PutMapping("/{taskId}")
    @PreAuthorize("@projectAccess.canAccessTask(#taskId)")
    public ApiResponse<Dto.Task> update(@PathVariable Long taskId, @Valid @RequestBody Requests.TaskRequest req) {
        return ApiResponse.ok(tasks.update(taskId, req), "Task updated.");
    }

    @PatchMapping("/{taskId}/status")
    @PreAuthorize("@projectAccess.canAccessTask(#taskId)")
    public ApiResponse<Dto.Task> status(@PathVariable Long taskId, @Valid @RequestBody Requests.StatusChange req) {
        return ApiResponse.ok(tasks.setStatus(taskId, req.status()));
    }

    @PatchMapping("/{taskId}/move")
    @PreAuthorize("@projectAccess.canAccessTask(#taskId)")
    public ApiResponse<Dto.Task> move(@PathVariable Long taskId, @Valid @RequestBody Requests.Move req) {
        return ApiResponse.ok(tasks.move(taskId, req));
    }

    @DeleteMapping("/{taskId}")
    @PreAuthorize("@projectAccess.canAccessTask(#taskId)")
    public ApiResponse<Void> delete(@PathVariable Long taskId) {
        tasks.delete(taskId);
        return ApiResponse.ok(null, "Task deleted.");
    }

    @PutMapping("/{taskId}/criteria")
    @PreAuthorize("@projectAccess.canAccessTask(#taskId)")
    public ApiResponse<Dto.Task> criteria(@PathVariable Long taskId, @Valid @RequestBody Requests.CriteriaUpdate req) {
        return ApiResponse.ok(tasks.updateCriteria(taskId, req), "Acceptance criteria saved.");
    }

    @PutMapping("/{taskId}/checklist")
    @PreAuthorize("@projectAccess.canAccessTask(#taskId)")
    public ApiResponse<Dto.Task> checklist(@PathVariable Long taskId, @Valid @RequestBody Requests.ChecklistUpdate req) {
        return ApiResponse.ok(tasks.updateChecklist(taskId, req), "Checklist saved.");
    }

    @GetMapping("/{taskId}/comments")
    @PreAuthorize("@projectAccess.canAccessTask(#taskId)")
    public ApiResponse<List<Dto.Comment>> comments(@PathVariable Long taskId) {
        return ApiResponse.ok(comments.list(taskId));
    }

    /** Where this task is mentioned: other tasks' descriptions and comments, in your projects. */
    @GetMapping("/{taskId}/mentions")
    @PreAuthorize("@projectAccess.canAccessTask(#taskId)")
    public ApiResponse<List<Dto.TaskMention>> mentions(@PathVariable Long taskId) {
        return ApiResponse.ok(backlinks.mentionsOf(taskId));
    }

    @PostMapping("/{taskId}/comments")
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("@projectAccess.canAccessTask(#taskId)")
    public ApiResponse<Dto.Comment> comment(@PathVariable Long taskId, @Valid @RequestBody Requests.CommentBody req) {
        return ApiResponse.ok(comments.add(taskId, req.body()), "Comment added.");
    }

    @GetMapping("/{taskId}/submissions")
    @PreAuthorize("@projectAccess.canAccessTask(#taskId)")
    public ApiResponse<List<Dto.Submission>> submissions(@PathVariable Long taskId) {
        return ApiResponse.ok(submissions.list(taskId));
    }

    /** multipart/form-data: part "data" (JSON {notes, evidence}) and zero or more "files" parts. */
    @PostMapping(path = "/{taskId}/submissions", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("@projectAccess.canAccessTask(#taskId)")
    public ApiResponse<Dto.Submission> submit(@PathVariable Long taskId,
                                              @Valid @RequestPart("data") Requests.SubmissionData data,
                                              @RequestPart(value = "files", required = false) List<MultipartFile> files) {
        return ApiResponse.ok(submissions.submit(taskId, data, files), "Submitted for review.");
    }

    @GetMapping("/{taskId}/activity")
    @PreAuthorize("@projectAccess.canAccessTask(#taskId)")
    public ApiResponse<List<Dto.Activity>> activity(@PathVariable Long taskId) {
        return ApiResponse.ok(activity.taskActivity(taskId));
    }

    /** Make this task depend on another task of the same project (the blocker must finish first). */
    @PostMapping("/{taskId}/dependencies")
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("@projectAccess.canAccessTask(#taskId)")
    public ApiResponse<Dto.Dependency> addDependency(@PathVariable Long taskId, @Valid @RequestBody Requests.DependencyRequest req) {
        return ApiResponse.ok(dependencies.add(taskId, req.blockerTaskId()), "Dependency added.");
    }
}
