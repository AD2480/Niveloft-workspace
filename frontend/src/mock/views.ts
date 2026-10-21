/**
 * Row -> DTO mapping and derived values (task counts, progress, health,
 * analytics). Equivalent to the backend's mapper and service layer.
 */
import type {
  Activity,
  Attachment,
  Comment,
  Dependency,
  DependencyTask,
  Evidence,
  FlowPoint,
  Invitation,
  Member,
  Milestone,
  Notification,
  ProjectAnalytics,
  ProjectDetail,
  ProjectSummary,
  ReviewStats,
  Role,
  Submission,
  Task,
  TaskCounts,
  TaskStatus,
  TimeInStatus,
  TrendPoint,
  User,
  UserSummary,
  WorkloadRow,
} from '@/api/types';
import { PRIORITIES, TASK_STATUSES } from '@/lib/constants';
import { todayIso } from '@/lib/dates';
import { calculateHealth } from '@/lib/health';
import { startOfWeek, subWeeks, format, parseISO, differenceInCalendarDays, addDays } from 'date-fns';
import type {
  ActivityRow,
  AttachmentRow,
  CommentRow,
  DependencyRow,
  InvitationRow,
  MilestoneRow,
  MockDb,
  NotificationRow,
  ProjectRow,
  SubmissionRow,
  TaskRow,
  UserRow,
} from './schema';

export function userSummary(u: UserRow): UserSummary {
  return { id: u.id, name: u.name, email: u.email, avatarColor: u.avatarColor };
}

/** The test API's operator (OPERATOR_EMAILS on a real server): the sample owner may open Site health. */
export const MOCK_OPERATORS = new Set(['aarav@projectflow.dev']);

export function userDto(u: UserRow): User {
  return { ...userSummary(u), jobTitle: u.jobTitle, createdAt: u.createdAt, emailVerified: true, operator: MOCK_OPERATORS.has(u.email) };
}

function userById(db: MockDb, id: number): UserRow {
  const u = db.users.find((x) => x.id === id);
  if (!u) throw new Error(`User ${id} missing`);
  return u;
}

export const isOverdue = (t: TaskRow, today = todayIso()) => t.status !== 'DONE' && t.dueDate !== null && t.dueDate < today;

export function taskDto(db: MockDb, t: TaskRow): Task {
  const p = db.projects.find((x) => x.id === t.projectId)!;
  const milestone = t.milestoneId ? db.milestones.find((m) => m.id === t.milestoneId) : undefined;
  return {
    id: t.id,
    projectId: p.id,
    projectKey: p.key,
    projectName: p.name,
    projectColor: p.color,
    key: `${p.key}-${t.number}`,
    title: t.title,
    description: t.description,
    status: t.status,
    priority: t.priority,
    assignee: t.assigneeId ? userSummary(userById(db, t.assigneeId)) : null,
    reporter: userSummary(userById(db, t.reporterId)),
    dueDate: t.dueDate,
    milestoneId: milestone?.id ?? null,
    milestoneName: milestone?.name ?? null,
    position: t.position,
    commentCount: db.comments.filter((c) => c.taskId === t.id).length,
    submissionCount: db.submissions.filter((s) => s.taskId === t.id).length,
    overdue: isOverdue(t),
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    startedAt: t.startedAt,
    completedAt: t.completedAt,
    acceptanceCriteria: db.criteria
      .filter((c) => c.taskId === t.id)
      .sort((a, b) => a.position - b.position)
      .map((c) => ({ id: c.id, position: c.position, text: c.text })),
    checklist: db.checklistItems
      .filter((c) => c.taskId === t.id)
      .sort((a, b) => a.position - b.position)
      .map((c) => ({
        id: c.id,
        position: c.position,
        text: c.text,
        done: c.done,
        doneBy: c.doneById ? userSummary(userById(db, c.doneById)) : null,
        doneAt: c.doneAt,
      })),
    version: t.version,
    estimateDays: t.estimateDays,
  };
}

export function taskCounts(tasks: TaskRow[]): TaskCounts {
  const today = todayIso();
  return {
    total: tasks.length,
    todo: tasks.filter((t) => t.status === 'TODO').length,
    inProgress: tasks.filter((t) => t.status === 'IN_PROGRESS').length,
    inReview: tasks.filter((t) => t.status === 'IN_REVIEW').length,
    done: tasks.filter((t) => t.status === 'DONE').length,
    overdue: tasks.filter((t) => isOverdue(t, today)).length,
    overdueTodo: tasks.filter((t) => t.status === 'TODO' && isOverdue(t, today)).length,
    overdueInProgress: tasks.filter((t) => t.status === 'IN_PROGRESS' && isOverdue(t, today)).length,
    overdueInReview: tasks.filter((t) => t.status === 'IN_REVIEW' && isOverdue(t, today)).length,
  };
}

export function projectHealth(p: ProjectRow, counts: TaskCounts) {
  return calculateHealth({
    projectStatus: p.status,
    startDate: p.startDate,
    deadline: p.deadline,
    total: counts.total,
    done: counts.done,
    overdue: counts.overdue,
  });
}

export function roleOf(db: MockDb, projectId: number, userId: number): Role | null {
  return db.memberships.find((m) => m.projectId === projectId && m.userId === userId)?.role ?? null;
}

export function projectSummary(db: MockDb, p: ProjectRow, viewerId: number): ProjectSummary {
  const tasks = db.tasks.filter((t) => t.projectId === p.id);
  const counts = taskCounts(tasks);
  const h = projectHealth(p, counts);
  return {
    id: p.id,
    key: p.key,
    name: p.name,
    description: p.description,
    color: p.color,
    status: p.status,
    startDate: p.startDate,
    deadline: p.deadline,
    owner: userSummary(userById(db, p.ownerId)),
    myRole: roleOf(db, p.id, viewerId) ?? 'VIEWER',
    memberCount: db.memberships.filter((m) => m.projectId === p.id).length,
    taskCounts: counts,
    progress: h.progress,
    health: h.health,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

const ROLE_ORDER: Record<Role, number> = { OWNER: 0, MANAGER: 1, MEMBER: 2, VIEWER: 3 };

export function membersOf(db: MockDb, projectId: number): Member[] {
  return db.memberships
    .filter((m) => m.projectId === projectId)
    .map((m) => {
      const u = userById(db, m.userId);
      return {
        id: m.id,
        user: { ...userSummary(u), jobTitle: u.jobTitle },
        role: m.role,
        joinedAt: m.joinedAt,
        openTaskCount: db.tasks.filter((t) => t.projectId === projectId && t.assigneeId === u.id && t.status !== 'DONE').length,
      };
    })
    .sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.user.name.localeCompare(b.user.name));
}

export function projectDetail(db: MockDb, p: ProjectRow, viewerId: number): ProjectDetail {
  const summary = projectSummary(db, p, viewerId);
  const h = projectHealth(p, summary.taskCounts);
  return { ...summary, healthReasons: h.reasons, expectedProgress: h.expectedProgress, members: membersOf(db, p.id), version: p.version };
}

export function milestoneDto(db: MockDb, m: MilestoneRow): Milestone {
  const tasks = db.tasks.filter((t) => t.milestoneId === m.id);
  const done = tasks.filter((t) => t.status === 'DONE').length;
  return {
    id: m.id,
    projectId: m.projectId,
    name: m.name,
    description: m.description,
    dueDate: m.dueDate,
    completed: m.completed,
    completedAt: m.completedAt,
    taskCount: tasks.length,
    doneCount: done,
    progress: tasks.length === 0 ? (m.completed ? 100 : 0) : Math.round((done / tasks.length) * 100),
    createdAt: m.createdAt,
  };
}

export function commentDto(db: MockDb, c: CommentRow): Comment {
  return { id: c.id, taskId: c.taskId, author: userSummary(userById(db, c.authorId)), body: c.body, createdAt: c.createdAt, updatedAt: c.updatedAt };
}

export function dependencyTaskDto(db: MockDb, t: TaskRow): DependencyTask {
  const p = db.projects.find((x) => x.id === t.projectId)!;
  return {
    id: t.id,
    key: `${p.key}-${t.number}`,
    title: t.title,
    status: t.status,
    dueDate: t.dueDate,
    assignee: t.assigneeId ? userSummary(userById(db, t.assigneeId)) : null,
    overdue: isOverdue(t),
    startedAt: t.startedAt,
    completedAt: t.completedAt,
    milestoneId: t.milestoneId,
  };
}

export function dependencyDto(db: MockDb, d: DependencyRow): Dependency {
  return {
    id: d.id,
    projectId: d.projectId,
    blocker: dependencyTaskDto(db, db.tasks.find((t) => t.id === d.blockerTaskId)!),
    blocked: dependencyTaskDto(db, db.tasks.find((t) => t.id === d.blockedTaskId)!),
    createdBy: userSummary(userById(db, d.createdById)),
    createdAt: d.createdAt,
  };
}

export function attachmentDto(a: AttachmentRow): Attachment {
  // The test API keeps small files as data URLs; the real backend serves /api/files/{id} to members only.
  return { id: a.id, fileName: a.fileName, size: a.size, contentType: a.contentType, url: a.dataUrl ?? '' };
}

export function submissionDto(db: MockDb, s: SubmissionRow): Submission {
  const review = db.reviews.find((r) => r.submissionId === s.id);
  const criteria = db.submissionCriteria.filter((c) => c.submissionId === s.id).sort((a, b) => a.position - b.position);
  const evidence: Evidence[] = db.evidence
    .filter((e) => e.submissionId === s.id)
    .sort((a, b) => a.position - b.position)
    .map((e) => {
      const file = e.attachmentId ? db.attachments.find((a) => a.id === e.attachmentId) : undefined;
      return { id: e.id, kind: e.kind, label: e.label, url: e.url, file: file ? attachmentDto(file) : null };
    });
  return {
    id: s.id,
    taskId: s.taskId,
    version: s.version,
    submittedBy: userSummary(userById(db, s.submittedById)),
    notes: s.notes,
    status: s.status,
    createdAt: s.createdAt,
    criteria: criteria.map((c) => ({ id: c.id, criterionId: c.criterionId, position: c.position, text: c.text })),
    evidence,
    review: review
      ? {
          id: review.id,
          reviewer: userSummary(userById(db, review.reviewerId)),
          decision: review.decision,
          feedback: review.feedback,
          createdAt: review.createdAt,
          results: review.results.map((r) => ({
            submissionCriterionId: r.submissionCriterionId,
            text: criteria.find((c) => c.id === r.submissionCriterionId)?.text ?? '',
            met: r.met,
            note: r.note,
          })),
        }
      : null,
  };
}

export function invitationDto(db: MockDb, i: InvitationRow): Invitation {
  const p = db.projects.find((x) => x.id === i.projectId)!;
  return {
    id: i.id,
    projectId: p.id,
    projectName: p.name,
    projectColor: p.color,
    email: i.email,
    role: i.role,
    status: i.status,
    invitedBy: userSummary(userById(db, i.invitedById)),
    createdAt: i.createdAt,
    respondedAt: i.respondedAt,
  };
}

export function notificationDto(db: MockDb, n: NotificationRow): Notification {
  const actor = n.actorId ? db.users.find((u) => u.id === n.actorId) : undefined;
  return {
    id: n.id,
    type: n.type,
    title: n.title,
    message: n.message,
    link: n.link,
    read: n.read,
    actor: actor ? userSummary(actor) : null,
    invitationId: n.invitationId,
    createdAt: n.createdAt,
  };
}

export function activityDto(db: MockDb, a: ActivityRow): Activity {
  const p = db.projects.find((x) => x.id === a.projectId);
  const t = a.taskId ? db.tasks.find((x) => x.id === a.taskId) : undefined;
  return {
    id: a.id,
    projectId: a.projectId,
    projectName: p?.name ?? 'Deleted project',
    taskId: t ? t.id : null,
    taskKey: t && p ? `${p.key}-${t.number}` : null,
    actor: userSummary(userById(db, a.actorId)),
    type: a.type,
    message: a.message,
    field: a.field ?? null,
    oldValue: a.oldValue ?? null,
    newValue: a.newValue ?? null,
    createdAt: a.createdAt,
  };
}

/** Weekly created/completed counts for the last `weeks` ISO weeks (oldest first). */
export function completionTrend(tasks: TaskRow[], weeks = 8, now = new Date()): TrendPoint[] {
  const current = startOfWeek(now, { weekStartsOn: 1 });
  const points: TrendPoint[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const start = subWeeks(current, i);
    const end = addDays(start, 7);
    const inWeek = (iso: string | null) => {
      if (!iso) return false;
      const d = parseISO(iso);
      return d >= start && d < end;
    };
    points.push({
      weekStart: format(start, 'yyyy-MM-dd'),
      created: tasks.filter((t) => inWeek(t.createdAt)).length,
      completed: tasks.filter((t) => inWeek(t.completedAt)).length,
    });
  }
  return points;
}

const byDue = (a: TaskRow, b: TaskRow) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || a.id - b.id;

export function projectAnalytics(db: MockDb, p: ProjectRow): ProjectAnalytics {
  const tasks = db.tasks.filter((t) => t.projectId === p.id);
  const counts = taskCounts(tasks);
  const h = projectHealth(p, counts);
  const today = todayIso();
  const in14 = todayIso(addDays(new Date(), 14));

  const workload: WorkloadRow[] = db.memberships
    .filter((m) => m.projectId === p.id && m.role !== 'VIEWER')
    .map((m) => {
      const mine = tasks.filter((t) => t.assigneeId === m.userId);
      const c = taskCounts(mine);
      return {
        user: userSummary(userById(db, m.userId)),
        todo: c.todo,
        inProgress: c.inProgress,
        inReview: c.inReview,
        done: c.done,
        overdue: c.overdue,
        open: c.total - c.done,
      };
    })
    .sort((a, b) => a.user.name.localeCompare(b.user.name)); // alphabetical: workload is shown, people are not ranked

  // Cycle time: first entry into In Progress → approval (same definition as the backend).
  const cycled = tasks.filter((t) => t.status === 'DONE' && t.completedAt && t.startedAt);
  const averageCycleDays =
    cycled.length === 0
      ? null
      : Math.round((cycled.reduce((sum, t) => sum + Math.max(0, differenceInCalendarDays(parseISO(t.completedAt!), parseISO(t.startedAt!))), 0) / cycled.length) * 10) / 10;

  // First-time approval: share of reviewed tasks whose first submission was approved.
  let reviewedTasks = 0;
  let firstTime = 0;
  for (const t of tasks) {
    const first = db.submissions.filter((s) => s.taskId === t.id).sort((a, b) => a.version - b.version)[0];
    if (!first || first.status === 'PENDING') continue;
    reviewedTasks += 1;
    if (first.status === 'APPROVED') firstTime += 1;
  }
  const approvalRate = reviewedTasks === 0 ? null : Math.round((firstTime / reviewedTasks) * 100);

  return {
    projectId: p.id,
    progress: h.progress,
    expectedProgress: h.expectedProgress,
    health: h.health,
    healthReasons: h.reasons,
    taskCounts: counts,
    statusDistribution: TASK_STATUSES.map((status: TaskStatus) => ({ status, count: tasks.filter((t) => t.status === status).length })),
    priorityDistribution: PRIORITIES.map((priority) => ({ priority, count: tasks.filter((t) => t.priority === priority && t.status !== 'DONE').length })),
    workload,
    completionTrend: completionTrend(tasks),
    overdueTasks: tasks.filter((t) => isOverdue(t, today)).sort(byDue).map((t) => taskDto(db, t)),
    upcomingDeadlines: tasks
      .filter((t) => t.status !== 'DONE' && t.dueDate !== null && t.dueDate >= today && t.dueDate <= in14)
      .sort(byDue)
      .map((t) => taskDto(db, t)),
    milestones: db.milestones.filter((m) => m.projectId === p.id).sort((a, b) => a.dueDate.localeCompare(b.dueDate)).map((m) => milestoneDto(db, m)),
    averageCycleDays,
    approvalRate,
    ...eventAnalytics(db, p.id, tasks),
  };
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const v = [...values].sort((a, b) => a - b);
  const n = v.length;
  const m = n % 2 ? v[(n - 1) / 2] : (v[n / 2 - 1] + v[n / 2]) / 2;
  return Math.round(m * 10) / 10;
}

/** Flow, review and time-in-status figures — same definitions as the backend's InsightService. */
export function eventAnalytics(db: MockDb, projectId: number, tasks: TaskRow[], now = new Date()) {
  const events = db.statusEvents.filter((e) => e.projectId === projectId).sort((a, b) => a.at.localeCompare(b.at) || a.id - b.id);
  const byTask = new Map<number, typeof events>();
  for (const e of events) byTask.set(e.taskId, [...(byTask.get(e.taskId) ?? []), e]);

  const flow: FlowPoint[] = [];
  for (let i = 27; i >= 0; i--) {
    const d = addDays(new Date(now.getFullYear(), now.getMonth(), now.getDate()), -i);
    const end = addDays(d, 1).toISOString();
    const c: Record<TaskStatus, number> = { TODO: 0, IN_PROGRESS: 0, IN_REVIEW: 0, DONE: 0 };
    for (const t of tasks) {
      if (t.createdAt >= end) continue;
      let s: TaskStatus = 'TODO';
      for (const e of byTask.get(t.id) ?? []) {
        if (e.at < end) s = e.to;
        else break;
      }
      c[s] += 1;
    }
    flow.push({ date: format(d, 'yyyy-MM-dd'), todo: c.TODO, inProgress: c.IN_PROGRESS, inReview: c.IN_REVIEW, done: c.DONE });
  }

  const taskIds = new Set(tasks.map((t) => t.id));
  const subs = db.submissions.filter((s) => taskIds.has(s.taskId));
  const hours: number[] = [];
  let reviewed = 0;
  let changes = 0;
  for (const s of subs) {
    const r = db.reviews.find((x) => x.submissionId === s.id);
    if (!r) continue;
    reviewed += 1;
    hours.push((parseISO(r.createdAt).getTime() - parseISO(s.createdAt).getTime()) / 3_600_000);
    if (r.decision === 'CHANGES_REQUESTED') changes += 1;
  }
  const rounds = [...taskIds].map((id) => subs.filter((s) => s.taskId === id)).filter((l) => l.some((s) => s.status === 'APPROVED')).map((l) => l.length);
  const reviewStats: ReviewStats = {
    submissions: subs.length,
    reviewed,
    pending: subs.filter((s) => s.status === 'PENDING').length,
    medianHoursToReview: median(hours),
    reworkRate: reviewed ? Math.round((changes / reviewed) * 100) : null,
    roundsToApproval: rounds.length ? Math.round((rounds.reduce((a, b) => a + b, 0) / rounds.length) * 10) / 10 : null,
  };

  const spans: Partial<Record<TaskStatus, number[]>> = {};
  for (const list of byTask.values()) {
    for (let i = 0; i + 1 < list.length; i++) {
      (spans[list[i].to] ??= []).push((parseISO(list[i + 1].at).getTime() - parseISO(list[i].at).getTime()) / 86_400_000);
    }
  }
  const timeInStatus: TimeInStatus[] = (['IN_PROGRESS', 'IN_REVIEW'] as const).map((status) => ({ status, medianDays: median(spans[status] ?? []), samples: spans[status]?.length ?? 0 }));
  return { flow, reviewStats, timeInStatus };
}
