package dev.projectflow.web;

import dev.projectflow.domain.Priority;
import dev.projectflow.domain.ProjectStatus;
import dev.projectflow.security.CurrentUser;
import dev.projectflow.service.*;
import dev.projectflow.web.dto.Dto;
import dev.projectflow.web.dto.Requests;
import jakarta.validation.Valid;
import java.nio.charset.StandardCharsets;
import java.util.List;
import org.springframework.http.CacheControl;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

/**
 * Project-scoped endpoints. Every route under {@code /api/projects/{projectId}} first
 * checks membership with {@code @projectAccess}; services then apply role-specific rules.
 */
@RestController
@RequestMapping("/api/projects")
public class ProjectController {

    private final ProjectService projects;
    private final MilestoneService milestones;
    private final TaskService tasks;
    private final ActivityService activity;
    private final InsightService insights;
    private final DependencyService dependencies;
    private final PlanService plans;
    private final TaskHistoryExport history;
    private final dev.projectflow.service.ForecastChangeService forecastChanges;
    private final dev.projectflow.ops.AuditLog audit;
    private final dev.projectflow.ops.OpsSwitches switches;

    public ProjectController(ProjectService projects, MilestoneService milestones, TaskService tasks, ActivityService activity, InsightService insights,
                             DependencyService dependencies, PlanService plans, TaskHistoryExport history, dev.projectflow.ops.AuditLog audit,
                             dev.projectflow.ops.OpsSwitches switches, dev.projectflow.service.ForecastChangeService forecastChanges) {
        this.forecastChanges = forecastChanges;
        this.audit = audit;
        this.switches = switches;
        this.dependencies = dependencies;
        this.plans = plans;
        this.history = history;
        this.projects = projects;
        this.milestones = milestones;
        this.tasks = tasks;
        this.activity = activity;
        this.insights = insights;
    }

    @GetMapping
    public ApiResponse<PageResponse<Dto.ProjectSummary>> list(@RequestParam(required = false) String search,
                                                              @RequestParam(required = false) ProjectStatus status,
                                                              @RequestParam(defaultValue = "0") int page,
                                                              @RequestParam(defaultValue = "12") int size) {
        return ApiResponse.ok(projects.list(CurrentUser.id(), search, status, page, size));
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public ApiResponse<Dto.ProjectDetail> create(@Valid @RequestBody Requests.ProjectRequest req) {
        return ApiResponse.ok(projects.create(CurrentUser.id(), req), "Project created.");
    }

    @GetMapping("/{projectId}")
    @PreAuthorize("@projectAccess.isMember(#projectId)")
    public ApiResponse<Dto.ProjectDetail> get(@PathVariable Long projectId) {
        return ApiResponse.ok(projects.get(projectId));
    }

    @PutMapping("/{projectId}")
    @PreAuthorize("@projectAccess.isMember(#projectId)")
    public ApiResponse<Dto.ProjectDetail> update(@PathVariable Long projectId, @Valid @RequestBody Requests.ProjectRequest req) {
        return ApiResponse.ok(projects.update(projectId, req), "Project updated.");
    }

    @DeleteMapping("/{projectId}")
    @PreAuthorize("@projectAccess.hasRole(#projectId, 'OWNER')")
    public ApiResponse<Void> delete(@PathVariable Long projectId) {
        projects.delete(projectId);
        return ApiResponse.ok(null, "Project deleted.");
    }

    @PostMapping("/{projectId}/leave")
    @PreAuthorize("@projectAccess.isMember(#projectId)")
    public ApiResponse<Void> leave(@PathVariable Long projectId) {
        projects.leave(projectId);
        return ApiResponse.ok(null, "You left the project.");
    }

    // ---------------------------------------------------------------- members

    @GetMapping("/{projectId}/members")
    @PreAuthorize("@projectAccess.isMember(#projectId)")
    public ApiResponse<List<Dto.Member>> members(@PathVariable Long projectId) {
        return ApiResponse.ok(projects.members(projectId));
    }

    @PutMapping("/{projectId}/members/{memberId}")
    @PreAuthorize("@projectAccess.hasRole(#projectId, 'MANAGER')")
    public ApiResponse<Dto.Member> changeRole(@PathVariable Long projectId, @PathVariable Long memberId, @Valid @RequestBody Requests.RoleChange req) {
        return ApiResponse.ok(projects.changeRole(projectId, memberId, req.role()), "Role updated.");
    }

    @DeleteMapping("/{projectId}/members/{memberId}")
    @PreAuthorize("@projectAccess.hasRole(#projectId, 'MANAGER')")
    public ApiResponse<Void> removeMember(@PathVariable Long projectId, @PathVariable Long memberId) {
        projects.removeMember(projectId, memberId);
        return ApiResponse.ok(null, "Member removed.");
    }

    // ------------------------------------------------------------ invitations

    @GetMapping("/{projectId}/invitations")
    @PreAuthorize("@projectAccess.isMember(#projectId)")
    public ApiResponse<List<Dto.Invitation>> invitations(@PathVariable Long projectId) {
        return ApiResponse.ok(projects.projectInvitations(projectId));
    }

    @PostMapping("/{projectId}/invitations")
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("@projectAccess.isMember(#projectId)")
    public ApiResponse<Dto.Invitation> invite(@PathVariable Long projectId, @Valid @RequestBody Requests.Invite req) {
        return ApiResponse.ok(projects.invite(projectId, req), "Invitation sent.");
    }

    @DeleteMapping("/{projectId}/invitations/{invitationId}")
    @PreAuthorize("@projectAccess.isMember(#projectId)")
    public ApiResponse<Void> revoke(@PathVariable Long projectId, @PathVariable Long invitationId) {
        projects.revoke(projectId, invitationId);
        return ApiResponse.ok(null, "Invitation revoked.");
    }

    // ------------------------------------------------------------- milestones

    @GetMapping("/{projectId}/milestones")
    @PreAuthorize("@projectAccess.isMember(#projectId)")
    public ApiResponse<List<Dto.Milestone>> milestones(@PathVariable Long projectId) {
        return ApiResponse.ok(milestones.list(projectId));
    }

    @PostMapping("/{projectId}/milestones")
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("@projectAccess.isMember(#projectId)")
    public ApiResponse<Dto.Milestone> createMilestone(@PathVariable Long projectId, @Valid @RequestBody Requests.MilestoneRequest req) {
        return ApiResponse.ok(milestones.create(projectId, req), "Milestone created.");
    }

    // ------------------------------------------------------------------ tasks

    @GetMapping("/{projectId}/tasks")
    @PreAuthorize("@projectAccess.isMember(#projectId)")
    public ApiResponse<PageResponse<Dto.Task>> tasks(@PathVariable Long projectId,
                                                     @RequestParam(required = false) String search,
                                                     @RequestParam(required = false) String status,
                                                     @RequestParam(required = false) Priority priority,
                                                     @RequestParam(required = false) String assignee,
                                                     @RequestParam(required = false) Long milestoneId,
                                                     @RequestParam(required = false) String due,
                                                     @RequestParam(defaultValue = "position") String sort,
                                                     @RequestParam(defaultValue = "asc") String direction,
                                                     @RequestParam(defaultValue = "0") int page,
                                                     @RequestParam(defaultValue = "20") int size) {
        return ApiResponse.ok(tasks.list(projectId, new TaskService.Query(search, status, priority, assignee, milestoneId, due, sort, direction, page, size)));
    }

    @PostMapping("/{projectId}/tasks")
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("@projectAccess.isMember(#projectId)")
    public ApiResponse<Dto.Task> createTask(@PathVariable Long projectId, @Valid @RequestBody Requests.TaskRequest req) {
        Dto.Task t = tasks.create(projectId, req);
        return ApiResponse.ok(t, t.key() + " created.");
    }

    // --------------------------------------------------------- activity/stats

    @GetMapping("/{projectId}/activity")
    @PreAuthorize("@projectAccess.isMember(#projectId)")
    public ApiResponse<PageResponse<Dto.Activity>> activity(@PathVariable Long projectId,
                                                            @RequestParam(defaultValue = "0") int page,
                                                            @RequestParam(defaultValue = "25") int size) {
        return ApiResponse.ok(activity.projectActivity(projectId, page, size));
    }

    @GetMapping("/{projectId}/analytics")
    @PreAuthorize("@projectAccess.isMember(#projectId)")
    public ApiResponse<Dto.ProjectAnalytics> analytics(@PathVariable Long projectId) {
        return ApiResponse.ok(insights.analytics(projectId));
    }

    /**
     * Estimates, due dates, priorities, owners and dependencies changed since a moment (at most 90
     * days back), and tasks deleted: what the Delivery page needs to replay its forecast as of then
     * and explain why the date moved.
     */
    @GetMapping("/{projectId}/changes")
    @PreAuthorize("@projectAccess.isMember(#projectId)")
    public ApiResponse<Dto.ChangeLog> changes(@PathVariable Long projectId, @RequestParam(required = false) java.time.Instant since) {
        return ApiResponse.ok(forecastChanges.since(projectId, since));
    }

    /** Recorded status changes, oldest first: the source for the 3D model's replay. */
    @GetMapping("/{projectId}/history")
    @PreAuthorize("@projectAccess.isMember(#projectId)")
    public ApiResponse<List<Dto.StatusChange>> history(@PathVariable Long projectId) {
        return ApiResponse.ok(insights.history(projectId));
    }

    /**
     * The task history as CSV for training a deadline forecast (the ml/ kit): dates, estimates,
     * priorities and counts, with people as p1, p2, … and nothing anyone wrote. Owners and managers.
     */
    @GetMapping(value = "/{projectId}/export/task-history.csv", produces = "text/csv")
    @PreAuthorize("@projectAccess.hasRole(#projectId, 'MANAGER')")
    public ResponseEntity<String> taskHistory(@PathVariable Long projectId) {
        switches.require("exports");
        TaskHistoryExport.Export e = history.export(projectId);
        audit.record(dev.projectflow.security.CurrentUser.id(), projectId, "project.exported", "task history", dev.projectflow.ops.AuditLog.OK,
                e.fileName());
        return ResponseEntity.ok()
                .contentType(new MediaType("text", "csv", StandardCharsets.UTF_8))
                .header(HttpHeaders.CONTENT_DISPOSITION, ContentDisposition.attachment().filename(e.fileName()).build().toString())
                .cacheControl(CacheControl.noStore())
                .body(e.csv());
    }

    /** Makes another member the owner; the current owner becomes a manager. Owner only. */
    @PostMapping("/{projectId}/transfer-ownership")
    public ApiResponse<Dto.Member> transferOwnership(@PathVariable Long projectId, @Valid @RequestBody Requests.TransferOwnership req) {
        return ApiResponse.ok(projects.transferOwnership(projectId, req.memberId()), "Ownership transferred.");
    }

    /** The project's audit log, newest first: owners and managers. */
    @GetMapping("/{projectId}/audit")
    @PreAuthorize("@projectAccess.hasRole(#projectId, 'MANAGER')")
    public ApiResponse<java.util.List<Dto.AuditEvent>> audit(@PathVariable Long projectId, @RequestParam(required = false) Long before,
                                                             @RequestParam(defaultValue = "50") int limit) {
        return ApiResponse.ok(audit.forProject(projectId, limit, before).stream()
                .map(e -> new Dto.AuditEvent(e.id(), e.at(), e.actorName() == null ? (e.actorId() == null ? "Niveloft" : "Unknown") : e.actorName(),
                        e.action(), e.target(), e.outcome(), e.detail()))
                .toList());
    }

    // ------------------------------------------------------------ dependencies

    @GetMapping("/{projectId}/dependencies")
    @PreAuthorize("@projectAccess.isMember(#projectId)")
    public ApiResponse<List<Dto.Dependency>> dependencies(@PathVariable Long projectId) {
        return ApiResponse.ok(dependencies.list(projectId));
    }

    /** Apply a previewed planning scenario atomically (managers only; stale scenarios are rejected). */
    @PostMapping("/{projectId}/plan/apply")
    @PreAuthorize("@projectAccess.isMember(#projectId)")
    public ApiResponse<Dto.PlanResult> applyPlan(@PathVariable Long projectId, @Valid @RequestBody Requests.PlanApply req) {
        Dto.PlanResult r = plans.apply(projectId, req);
        return ApiResponse.ok(r, r.changedTasks() == 0 ? "Nothing needed to change." : "Plan applied to " + r.changedTasks() + (r.changedTasks() == 1 ? " task." : " tasks."));
    }
}
