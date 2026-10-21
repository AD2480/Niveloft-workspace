import type { Role, TaskStatus } from '@/api/types';

/**
 * Project permission rules.
 *
 * This module is the single source of truth for the UI (to show/hide actions)
 * and for the mock API (to reject forbidden requests). The Spring Boot backend
 * enforces the same matrix in its `ProjectPermissionService`.
 *
 * | Action                               | Owner | Manager | Member            | Viewer |
 * |--------------------------------------|:-----:|:-------:|:-----------------:|:------:|
 * | View project, tasks, activity        |  ✓    |   ✓     |   ✓               |  ✓     |
 * | Edit project details / status        |  ✓    |   ✓     |                   |        |
 * | Delete project                       |  ✓    |         |                   |        |
 * | Invite / manage Members & Viewers    |  ✓    |   ✓     |                   |        |
 * | Invite / manage Managers             |  ✓    |         |                   |        |
 * | Manage milestones                    |  ✓    |   ✓     |                   |        |
 * | Create tasks                         |  ✓    |   ✓     |   ✓               |        |
 * | Edit any task / assign anyone        |  ✓    |   ✓     |                   |        |
 * | Edit own tasks (assignee/reporter)   |  ✓    |   ✓     |   ✓               |        |
 * | Delete tasks                         |  ✓    |   ✓     | own, while To Do  |        |
 * | Move To Do ⇄ In Progress             |  ✓    |   ✓     | assignee          |        |
 * | Submit work for review               | assignee only (any role except Viewer) |
 * | Approve / request changes            |  ✓    |   ✓     |  (never own work) |        |
 * | Reopen a Done task                   |  ✓    |   ✓     |                   |        |
 * | Comment                              |  ✓    |   ✓     |   ✓               |        |
 */

export const ROLE_RANK: Record<Role, number> = { VIEWER: 0, MEMBER: 1, MANAGER: 2, OWNER: 3 };

export const atLeast = (role: Role | null | undefined, min: Role): boolean =>
  role != null && ROLE_RANK[role] >= ROLE_RANK[min];

export interface TaskLike {
  status: TaskStatus;
  assigneeId: number | null;
  reporterId: number;
}

export const can = {
  editProject: (role: Role | null | undefined) => atLeast(role, 'MANAGER'),
  deleteProject: (role: Role | null | undefined) => role === 'OWNER',
  manageMembers: (role: Role | null | undefined) => atLeast(role, 'MANAGER'),
  manageMilestones: (role: Role | null | undefined) => atLeast(role, 'MANAGER'),
  createTask: (role: Role | null | undefined) => atLeast(role, 'MEMBER'),
  comment: (role: Role | null | undefined) => atLeast(role, 'MEMBER'),
  review: (role: Role | null | undefined) => atLeast(role, 'MANAGER'),
  leaveProject: (role: Role | null | undefined) => role != null && role !== 'OWNER',

  /** Roles the actor may grant when inviting or changing a member's role. */
  assignableRoles(role: Role | null | undefined): Role[] {
    if (role === 'OWNER') return ['MANAGER', 'MEMBER', 'VIEWER'];
    if (role === 'MANAGER') return ['MEMBER', 'VIEWER'];
    return [];
  },

  /** Whether the actor may change the role of, or remove, a member holding `targetRole`. */
  manageMember(actorRole: Role | null | undefined, targetRole: Role, isSelf: boolean): boolean {
    if (isSelf || targetRole === 'OWNER') return false;
    if (actorRole === 'OWNER') return true;
    if (actorRole === 'MANAGER') return targetRole === 'MEMBER' || targetRole === 'VIEWER';
    return false;
  },

  /** Edit title, description, priority, due date, milestone. */
  editTask(role: Role | null | undefined, task: TaskLike, userId: number): boolean {
    if (atLeast(role, 'MANAGER')) return true;
    return role === 'MEMBER' && (task.assigneeId === userId || task.reporterId === userId);
  },

  /**
   * Change the assignee to `newAssigneeId`. Managers may assign anyone;
   * members may only take an unassigned task themselves or unassign themselves.
   */
  assignTask(role: Role | null | undefined, task: TaskLike, userId: number, newAssigneeId: number | null): boolean {
    if (atLeast(role, 'MANAGER')) return true;
    if (role !== 'MEMBER') return false;
    if (task.assigneeId === null) return newAssigneeId === userId || newAssigneeId === null;
    if (task.assigneeId === userId) return newAssigneeId === null || newAssigneeId === userId;
    return false;
  },

  deleteTask(role: Role | null | undefined, task: TaskLike, userId: number): boolean {
    if (atLeast(role, 'MANAGER')) return true;
    return role === 'MEMBER' && task.reporterId === userId && task.status === 'TODO';
  },

  /**
   * Manual status changes. IN_REVIEW is only reachable by submitting work, and
   * DONE only by an approved review — so those are never valid targets here,
   * except that managers may reopen a DONE task back to IN_PROGRESS / TODO.
   */
  changeStatus(role: Role | null | undefined, task: TaskLike, userId: number, to: TaskStatus): boolean {
    if (to === task.status) return true;
    if (to === 'IN_REVIEW' || to === 'DONE') return false;
    if (task.status === 'IN_REVIEW') return false;
    if (task.status === 'DONE') return atLeast(role, 'MANAGER');
    if (atLeast(role, 'MANAGER')) return true;
    return role === 'MEMBER' && task.assigneeId === userId;
  },

  /** Only the assignee submits, and only while the task is being worked on. */
  submitWork(role: Role | null | undefined, task: TaskLike, userId: number): boolean {
    return (
      atLeast(role, 'MEMBER') &&
      task.assigneeId === userId &&
      (task.status === 'TODO' || task.status === 'IN_PROGRESS')
    );
  },

  /** Reviewers must be Manager+ and cannot approve their own submission. */
  reviewSubmission(role: Role | null | undefined, submittedById: number, userId: number): boolean {
    return atLeast(role, 'MANAGER') && submittedById !== userId;
  },
};

/** Why a status transition is not allowed (for friendly UI messages). */
export function statusChangeBlockedReason(from: TaskStatus, to: TaskStatus): string | null {
  if (from === to) return null;
  if (to === 'IN_REVIEW') return 'Submit your work for review to move a task to In review.';
  if (to === 'DONE') return 'Tasks become Done when a reviewer approves the submission.';
  if (from === 'IN_REVIEW') return 'This task is awaiting review. A reviewer must approve it or request changes.';
  return null;
}
