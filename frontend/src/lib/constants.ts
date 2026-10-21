import type { Health, Priority, ProjectStatus, Role, TaskStatus } from '@/api/types';

export const TASK_STATUSES: TaskStatus[] = ['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE'];
export const PRIORITIES: Priority[] = ['URGENT', 'HIGH', 'MEDIUM', 'LOW'];
export const ROLES: Role[] = ['OWNER', 'MANAGER', 'MEMBER', 'VIEWER'];
export const PROJECT_STATUSES: ProjectStatus[] = ['ACTIVE', 'ON_HOLD', 'COMPLETED', 'ARCHIVED'];

export const STATUS_LABEL: Record<TaskStatus, string> = {
  TODO: 'To do',
  IN_PROGRESS: 'In progress',
  IN_REVIEW: 'In review',
  DONE: 'Done',
};

/**
 * Chart/indicator colour for each status. CSS variables defined in index.css so
 * light and dark themes each use a palette validated for colour-blind separation.
 */
export const STATUS_COLOR: Record<TaskStatus, string> = {
  TODO: 'var(--status-todo)',
  IN_PROGRESS: 'var(--status-progress)',
  IN_REVIEW: 'var(--status-review)',
  DONE: 'var(--status-done)',
};

export const PRIORITY_LABEL: Record<Priority, string> = {
  URGENT: 'Urgent',
  HIGH: 'High',
  MEDIUM: 'Medium',
  LOW: 'Low',
};

export const PRIORITY_RANK: Record<Priority, number> = { URGENT: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };

export const ROLE_LABEL: Record<Role, string> = {
  OWNER: 'Owner',
  MANAGER: 'Manager',
  MEMBER: 'Member',
  VIEWER: 'Viewer',
};

export const ROLE_DESCRIPTION: Record<Role, string> = {
  OWNER: 'Full control, including deleting the project and managing managers.',
  MANAGER: 'Manages tasks, milestones and members; reviews submitted work.',
  MEMBER: 'Creates tasks, works on assigned tasks, submits work and comments.',
  VIEWER: 'Read-only access to the project.',
};

export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  ACTIVE: 'Active',
  ON_HOLD: 'On hold',
  COMPLETED: 'Completed',
  ARCHIVED: 'Archived',
};

export const HEALTH_LABEL: Record<Health, string> = {
  NOT_STARTED: 'Not started',
  ON_TRACK: 'On track',
  AT_RISK: 'At risk',
  OFF_TRACK: 'Off track',
  COMPLETED: 'Completed',
};

/** Colours users can pick for projects and avatars. */
export const PALETTE = [
  '#4f46e5',
  '#0ea5e9',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#ec4899',
  '#8b5cf6',
  '#14b8a6',
  '#f97316',
  '#64748b',
];
