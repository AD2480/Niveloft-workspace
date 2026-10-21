package dev.projectflow.ops;

import dev.projectflow.config.OpsProperties;
import dev.projectflow.domain.InvitationStatus;
import dev.projectflow.repository.InvitationRepository;
import dev.projectflow.repository.ProjectMemberRepository;
import dev.projectflow.repository.ProjectRepository;
import dev.projectflow.repository.StoredFileRepository;
import dev.projectflow.repository.TaskRepository;
import dev.projectflow.web.error.ApiException;
import dev.projectflow.web.error.ErrorCode;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

/**
 * How much one project or one person can hold. Generous for real use, but they stop a runaway
 * script (or a bug) from filling the database or the disk. Each limit says what it is.
 */
@Component
public class Quotas {

    private final OpsProperties.Limits limits;
    private final TaskRepository tasks;
    private final ProjectRepository projects;
    private final ProjectMemberRepository members;
    private final InvitationRepository invitations;
    private final StoredFileRepository files;

    public Quotas(OpsProperties ops, TaskRepository tasks, ProjectRepository projects, ProjectMemberRepository members, InvitationRepository invitations, StoredFileRepository files) {
        this.limits = ops.limitsOrDefault();
        this.tasks = tasks;
        this.projects = projects;
        this.members = members;
        this.invitations = invitations;
        this.files = files;
    }

    public void checkTaskRoom(Long projectId) {
        int max = limits.tasksPerProject();
        if (max > 0 && tasks.countByProjectId(projectId) >= max) {
            throw limit("This project has reached the limit of " + max + " tasks. Archive it and start a new one, or ask the server's operator to raise MAX_TASKS_PER_PROJECT.", null);
        }
    }

    public void checkProjectRoom(Long userId) {
        int max = limits.projectsPerUser();
        if (max > 0 && projects.countByOwnerId(userId) >= max) {
            throw limit("You own " + max + " projects, the most one person can. Delete or hand over one to create another.", null);
        }
    }

    public void checkMemberRoom(Long projectId) {
        int max = limits.membersPerProject();
        if (max > 0 && members.countByProjectId(projectId) + invitations.countByProjectIdAndStatus(projectId, InvitationStatus.PENDING) >= max) {
            throw limit("This project has reached the limit of " + max + " people (members and pending invitations).", "email");
        }
    }

    /** Throws if adding {@code incoming} bytes would take the project over its storage quota. */
    public void checkStorage(Long projectId, long incoming) {
        long max = limits.storageBytesPerProject();
        if (max > 0 && files.sumSizeByProjectId(projectId) + incoming > max) {
            throw limit("This project’s file storage is full (" + (max / 1024 / 1024) + " MB). Link to the files instead (a repository, a drive), or remove old evidence.", "files");
        }
    }

    private static ApiException limit(String message, String field) {
        return new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, ErrorCode.LIMIT_REACHED, message, field == null ? null : Map.of(field, message));
    }
}
