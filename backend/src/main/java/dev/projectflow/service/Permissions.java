package dev.projectflow.service;

import dev.projectflow.domain.Role;
import dev.projectflow.domain.Task;
import dev.projectflow.domain.TaskStatus;
import java.util.List;
import java.util.Objects;

/**
 * Project permission rules — the Java twin of {@code frontend/src/lib/permissions.ts}.
 * The UI uses its copy to show or hide actions; this copy is the one that is enforced.
 */
public final class Permissions {

    private Permissions() {}

    public static boolean atLeast(Role role, Role min) {
        return role != null && role.atLeast(min);
    }

    public static boolean editProject(Role r) { return atLeast(r, Role.MANAGER); }
    public static boolean deleteProject(Role r) { return r == Role.OWNER; }
    public static boolean manageMembers(Role r) { return atLeast(r, Role.MANAGER); }
    public static boolean manageMilestones(Role r) { return atLeast(r, Role.MANAGER); }
    public static boolean createTask(Role r) { return atLeast(r, Role.MEMBER); }
    public static boolean comment(Role r) { return atLeast(r, Role.MEMBER); }
    public static boolean leaveProject(Role r) { return r != null && r != Role.OWNER; }

    public static List<Role> assignableRoles(Role r) {
        if (r == Role.OWNER) return List.of(Role.MANAGER, Role.MEMBER, Role.VIEWER);
        if (r == Role.MANAGER) return List.of(Role.MEMBER, Role.VIEWER);
        return List.of();
    }

    public static boolean manageMember(Role actor, Role target, boolean isSelf) {
        if (isSelf || target == Role.OWNER) return false;
        if (actor == Role.OWNER) return true;
        if (actor == Role.MANAGER) return target == Role.MEMBER || target == Role.VIEWER;
        return false;
    }

    private static Long assigneeId(Task t) {
        return t.getAssignee() == null ? null : t.getAssignee().getId();
    }

    public static boolean editTask(Role r, Task t, Long userId) {
        if (atLeast(r, Role.MANAGER)) return true;
        return r == Role.MEMBER && (Objects.equals(assigneeId(t), userId) || Objects.equals(t.getReporter().getId(), userId));
    }

    public static boolean assignTask(Role r, Task t, Long userId, Long newAssigneeId) {
        if (atLeast(r, Role.MANAGER)) return true;
        if (r != Role.MEMBER) return false;
        Long current = assigneeId(t);
        if (current == null) return newAssigneeId == null || Objects.equals(newAssigneeId, userId);
        if (Objects.equals(current, userId)) return newAssigneeId == null || Objects.equals(newAssigneeId, userId);
        return false;
    }

    public static boolean deleteTask(Role r, Task t, Long userId) {
        if (atLeast(r, Role.MANAGER)) return true;
        return r == Role.MEMBER && Objects.equals(t.getReporter().getId(), userId) && t.getStatus() == TaskStatus.TODO;
    }

    /** Manual status changes. IN_REVIEW and DONE are never reachable this way. */
    public static boolean changeStatus(Role r, Task t, Long userId, TaskStatus to) {
        if (to == t.getStatus()) return true;
        if (to == TaskStatus.IN_REVIEW || to == TaskStatus.DONE) return false;
        if (t.getStatus() == TaskStatus.IN_REVIEW) return false;
        if (t.getStatus() == TaskStatus.DONE) return atLeast(r, Role.MANAGER);
        if (atLeast(r, Role.MANAGER)) return true;
        return r == Role.MEMBER && Objects.equals(assigneeId(t), userId);
    }

    /** Checklist items can be ticked by whoever can edit the task. */
    public static boolean tickChecklist(Role r, Task t, Long userId) {
        return editTask(r, t, userId);
    }

    public static boolean submitWork(Role r, Task t, Long userId) {
        return atLeast(r, Role.MEMBER)
                && Objects.equals(assigneeId(t), userId)
                && (t.getStatus() == TaskStatus.TODO || t.getStatus() == TaskStatus.IN_PROGRESS);
    }

    public static boolean reviewSubmission(Role r, Long submittedById, Long userId) {
        return atLeast(r, Role.MANAGER) && !Objects.equals(submittedById, userId);
    }

    public static String statusChangeBlockedReason(TaskStatus from, TaskStatus to) {
        if (from == to) return null;
        if (to == TaskStatus.IN_REVIEW) return "Submit your work for review to move a task to In review.";
        if (to == TaskStatus.DONE) return "Tasks become Done when a reviewer approves the submission.";
        if (from == TaskStatus.IN_REVIEW) return "This task is awaiting review. A reviewer must approve it or request changes.";
        return null;
    }
}
