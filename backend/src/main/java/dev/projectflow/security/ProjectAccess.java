package dev.projectflow.security;

import dev.projectflow.domain.Project;
import dev.projectflow.domain.Role;
import dev.projectflow.domain.Task;
import dev.projectflow.repository.ProjectMemberRepository;
import dev.projectflow.repository.ProjectRepository;
import dev.projectflow.repository.TaskRepository;
import dev.projectflow.web.error.ApiException;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * Resolves the current user's role in a project. Used two ways:
 * <ul>
 *   <li>in controllers: {@code @PreAuthorize("@projectAccess.isMember(#projectId)")}</li>
 *   <li>in services: {@code access.require(projectId)} for role-specific rules and messages.</li>
 * </ul>
 * Missing projects are reported as 404 before membership is checked, so ids can't be probed.
 */
@Component("projectAccess")
public class ProjectAccess {

    private final ProjectRepository projects;
    private final ProjectMemberRepository members;
    private final TaskRepository tasks;

    public ProjectAccess(ProjectRepository projects, ProjectMemberRepository members, TaskRepository tasks) {
        this.projects = projects;
        this.members = members;
        this.tasks = tasks;
    }

    /** The current user's access to one project. */
    public record Access(Project project, Role role, Long userId) {}

    /** Access plus the task it was resolved from. */
    public record TaskAccess(Task task, Project project, Role role, Long userId) {}

    @Transactional(readOnly = true)
    public Access require(Long projectId) {
        Long userId = CurrentUser.id();
        Project project = projects.findById(projectId).orElseThrow(() -> ApiException.notFound("Project not found."));
        Role role = members.findByProjectIdAndUserId(projectId, userId)
                .map(m -> m.getRole())
                .orElseThrow(() -> ApiException.forbidden("You are not a member of this project."));
        return new Access(project, role, userId);
    }

    @Transactional(readOnly = true)
    public TaskAccess requireTask(Long taskId) {
        Task task = tasks.findById(taskId).orElseThrow(() -> ApiException.notFound("Task not found."));
        Access a = require(task.getProject().getId());
        return new TaskAccess(task, a.project(), a.role(), a.userId());
    }

    /** For @PreAuthorize: true for any member; throws 404 for unknown projects and 403 for non-members. */
    public boolean isMember(Long projectId) {
        require(projectId);
        return true;
    }

    /** For @PreAuthorize: membership of the task's project. */
    public boolean canAccessTask(Long taskId) {
        requireTask(taskId);
        return true;
    }

    /** For @PreAuthorize: at least the given role (OWNER, MANAGER, MEMBER, VIEWER). */
    public boolean hasRole(Long projectId, String minRole) {
        return require(projectId).role().atLeast(Role.valueOf(minRole));
    }
}
