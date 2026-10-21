/**
 * Mission Control for the in-browser test API — the same rules and wording as the backend's
 * AttentionService (backend/src/main/java/dev/projectflow/service/AttentionService.java).
 * Every item names the rule that raised it and the records it refers to.
 */
import { differenceInCalendarDays, differenceInHours, format, parseISO } from 'date-fns';
import type { ApprovedItem, AttentionItem, Role, Severity } from '@/api/types';
import { STATUS_LABEL } from '@/lib/constants';
import { addDaysIso, todayIso } from '@/lib/dates';
import { atLeast, can } from '@/lib/permissions';
import type { MockDb, ProjectRow, SubmissionRow, TaskRow } from './schema';
import { isOverdue, projectHealth, roleOf, taskCounts, userSummary } from './views';

export const REVIEW_WAIT_DAYS = 2;
export const DUE_SOON_DAYS = 3;
export const MILESTONE_WINDOW_DAYS = 7;
export const OVERDUE_PER_PERSON = 2;
const APPROVED_WINDOW_DAYS = 14;
const MAX_ITEMS = 14;
const SEVERITY_RANK: Record<Severity, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };

export function ago(iso: string, now = new Date()): string {
  const when = parseISO(iso);
  const days = Math.floor((now.getTime() - when.getTime()) / 86_400_000);
  if (days <= 0) {
    const hours = differenceInHours(now, when);
    return hours <= 0 ? 'just now' : `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  }
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

export function relativeDay(date: string, today = todayIso()): string {
  const n = differenceInCalendarDays(parseISO(date), parseISO(today));
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  const d = format(parseISO(date), 'd MMM');
  return n > 0 ? `in ${n} days (${d})` : `${Math.abs(n)} days ago (${d})`;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function computeAttention(db: MockDb, userId: number): { attention: AttentionItem[]; recentlyApproved: ApprovedItem[] } {
  const today = todayIso();
  const now = new Date();
  const projectIds = new Set(db.memberships.filter((m) => m.userId === userId).map((m) => m.projectId));
  const projects = db.projects.filter((p) => projectIds.has(p.id));
  const tasks = db.tasks.filter((t) => projectIds.has(t.projectId));
  const projectOf = (t: TaskRow) => db.projects.find((p) => p.id === t.projectId)!;
  const keyOf = (t: TaskRow) => `${projectOf(t).key}-${t.number}`;
  const keys = (list: TaskRow[], max: number) => {
    const shown = list.slice(0, max).map(keyOf).join(', ');
    return list.length > max ? `${shown} and ${list.length - max} more` : shown;
  };
  const refs = (list: TaskRow[], max: number) => list.slice(0, max).map(keyOf);
  const userName = (id: number) => db.users.find((u) => u.id === id)?.name ?? 'Someone';
  const link = (t: TaskRow) => `/projects/${t.projectId}/tasks/${t.id}`;
  const item = (id: string, kind: AttentionItem['kind'], severity: Severity, title: string, reason: string, r: string[], href: string, p: ProjectRow, date: string | null): AttentionItem => ({
    id,
    kind,
    severity,
    title,
    reason,
    refs: r,
    link: href,
    projectId: p.id,
    projectName: p.name,
    projectColor: p.color,
    date,
  });

  const subs = db.submissions.filter((s) => tasks.some((t) => t.id === s.taskId));
  const reviewOf = (s: SubmissionRow) => db.reviews.find((r) => r.submissionId === s.id);
  const historyOf = (taskId: number) => subs.filter((s) => s.taskId === taskId).sort((a, b) => b.version - a.version);
  const items: AttentionItem[] = [];

  // 1. Reviews the user can make
  for (const s of subs) {
    const t = tasks.find((x) => x.id === s.taskId)!;
    if (s.status !== 'PENDING' || t.status !== 'IN_REVIEW') continue;
    if (!can.reviewSubmission(roleOf(db, t.projectId, userId), s.submittedById, userId)) continue;
    const waited = differenceInCalendarDays(now, parseISO(s.createdAt));
    const overdue = isOverdue(t, today);
    const criteria = db.submissionCriteria.filter((c) => c.submissionId === s.id).length;
    const reason =
      `${userName(s.submittedById)} submitted version ${s.version} ${ago(s.createdAt, now)}. ` +
      (criteria === 0 ? 'No acceptance criteria were set, so judge it from the notes and evidence.' : `${plural(criteria, 'acceptance criterion', 'acceptance criteria')} to check.`) +
      (overdue ? ` The task was due ${relativeDay(t.dueDate!, today)}.` : '');
    items.push(item(`review-${s.id}`, 'REVIEW_WAITING', waited >= REVIEW_WAIT_DAYS || overdue ? 'HIGH' : 'MEDIUM', `Review ${keyOf(t)}: ${t.title}`, reason, [keyOf(t)], `${link(t)}/review`, projectOf(t), t.dueDate));
  }

  const openBlockersOf = new Map<number, TaskRow[]>();
  const openBlockedBy = new Map<number, TaskRow[]>();
  for (const d of db.dependencies.filter((x) => projectIds.has(x.projectId))) {
    const blocker = tasks.find((t) => t.id === d.blockerTaskId);
    const blocked = tasks.find((t) => t.id === d.blockedTaskId);
    if (!blocker || !blocked || blocker.status === 'DONE' || blocked.status === 'DONE') continue;
    openBlockersOf.set(blocked.id, [...(openBlockersOf.get(blocked.id) ?? []), blocker]);
    openBlockedBy.set(blocker.id, [...(openBlockedBy.get(blocker.id) ?? []), blocked]);
  }

  // 2-5. The user's own work
  for (const t of tasks.filter((x) => x.assigneeId === userId && x.status !== 'DONE')) {
    const latest = historyOf(t.id)[0];
    const key = keyOf(t);
    const overdue = isOverdue(t, today);
    const dueNote = overdue ? ` It was due ${relativeDay(t.dueDate!, today)}.` : '';
    const p = projectOf(t);
    if (t.status === 'IN_PROGRESS' && latest?.status === 'CHANGES_REQUESTED') {
      const r = reviewOf(latest);
      const unmet = r ? r.results.filter((x) => !x.met).length : 0;
      const total = r ? r.results.length : 0;
      const detail = total > 0 ? `: ${unmet} of ${plural(total, 'criterion', 'criteria')} not met.` : '.';
      items.push(
        item(`changes-${t.id}`, 'CHANGES_REQUESTED', 'HIGH', `Changes requested on ${key}: ${t.title}`, `${r ? userName(r.reviewerId) : 'A reviewer'} requested changes on version ${latest.version}${r ? ` ${ago(r.createdAt, now)}` : ''}${detail}${dueNote}`, [key], link(t), p, t.dueDate),
      );
      continue;
    }
    const blockers = openBlockersOf.get(t.id) ?? [];
    const lateBlockers = blockers.filter((b) => isOverdue(b, today));
    const laterBlockers = blockers.filter((b) => !isOverdue(b, today) && b.dueDate && t.dueDate && b.dueDate >= t.dueDate);
    if (t.status !== 'IN_REVIEW' && (lateBlockers.length || laterBlockers.length)) {
      const b = lateBlockers[0] ?? laterBlockers[0];
      const owner = b.assigneeId ? userName(b.assigneeId) : 'unassigned';
      let why = lateBlockers.length
        ? `It depends on ${keyOf(b)} (${owner}), which was due ${relativeDay(b.dueDate!, today)} and is still ${STATUS_LABEL[b.status].toLowerCase()}.`
        : `It depends on ${keyOf(b)} (${owner}), due ${relativeDay(b.dueDate!, today)}, which is not before this task’s own due date (${format(parseISO(t.dueDate!), 'd MMM')}).`;
      if (blockers.length > 1) why += ` ${plural(blockers.length, 'unfinished blocker', 'unfinished blockers')} in total: ${keys(blockers, 4)}.`;
      items.push(item(`blocked-${t.id}`, 'BLOCKED', lateBlockers.length ? 'HIGH' : 'MEDIUM', `${key} is blocked: ${t.title}`, why + dueNote, [key, ...refs(blockers, 3)], link(t), p, t.dueDate));
      continue;
    }
    if (overdue && t.status !== 'IN_REVIEW') {
      items.push(item(`overdue-${t.id}`, 'OVERDUE', 'HIGH', `${key} is overdue: ${t.title}`, `Due ${relativeDay(t.dueDate!, today)} and still ${STATUS_LABEL[t.status].toLowerCase()}.`, [key], link(t), p, t.dueDate));
      continue;
    }
    if (t.status === 'TODO' && t.dueDate && t.dueDate <= addDaysIso(today, DUE_SOON_DAYS)) {
      items.push(item(`soon-${t.id}`, 'DUE_SOON', 'MEDIUM', `${key} is due soon: ${t.title}`, `Due ${relativeDay(t.dueDate, today)} and not started yet.`, [key], link(t), p, t.dueDate));
      continue;
    }
    if (t.status === 'IN_REVIEW' && latest?.status === 'PENDING' && differenceInCalendarDays(now, parseISO(latest.createdAt)) > REVIEW_WAIT_DAYS) {
      items.push(
        item(`waiting-${t.id}`, 'AWAITING_REVIEW', 'LOW', `${key} is waiting for a reviewer`, `You submitted version ${latest.version} ${ago(latest.createdAt, now)} and nobody has reviewed it yet.${dueNote}`, [key], `${link(t)}/review`, p, t.dueDate),
      );
    }
  }

  // 6-9. Projects the user manages
  const managedOverdue: TaskRow[] = [];
  for (const p of projects) {
    const role: Role | null = roleOf(db, p.id, userId);
    if (!atLeast(role, 'MANAGER') || p.status === 'ARCHIVED' || p.status === 'COMPLETED') continue;
    const list = tasks.filter((t) => t.projectId === p.id);
    const overdueTasks = list.filter((t) => isOverdue(t, today)).sort((a, b) => a.dueDate!.localeCompare(b.dueDate!));
    const h = projectHealth(p, taskCounts(list));
    if (h.health === 'AT_RISK' || h.health === 'OFF_TRACK') {
      const examples = overdueTasks.length ? ` Overdue: ${keys(overdueTasks, 3)}.` : '';
      items.push(item(`project-${p.id}`, 'PROJECT_RISK', h.health === 'OFF_TRACK' ? 'HIGH' : 'MEDIUM', `${p.name} is ${h.health === 'OFF_TRACK' ? 'off track' : 'at risk'}`, h.reasons.join(' ') + examples, refs(overdueTasks, 3), `/projects/${p.id}`, p, p.deadline));
    }
    for (const m of db.milestones.filter((x) => x.projectId === p.id && !x.completed && x.dueDate <= addDaysIso(today, MILESTONE_WINDOW_DAYS))) {
      const scoped = list.filter((t) => t.milestoneId === m.id);
      const open = scoped.filter((t) => t.status !== 'DONE');
      if (open.length === 0) continue;
      const late = m.dueDate < today;
      items.push(
        item(`milestone-${m.id}`, 'MILESTONE_RISK', late ? 'HIGH' : 'MEDIUM', `Milestone “${m.name}” ${late ? 'has passed' : 'is close'}`, `${open.length} of ${plural(scoped.length, 'task', 'tasks')} still open (${keys(open, 3)}); due ${relativeDay(m.dueDate, today)}.`, refs(open, 4), `/projects/${p.id}/milestones`, p, m.dueDate),
      );
    }
    managedOverdue.push(...overdueTasks);
    for (const late of overdueTasks) {
      const waiting = openBlockedBy.get(late.id) ?? [];
      if (!waiting.length) continue;
      const owner = late.assigneeId ? userName(late.assigneeId) : 'unassigned';
      items.push(
        item(`blocking-${late.id}`, 'BLOCKING', waiting.length >= 2 ? 'HIGH' : 'MEDIUM', `${keyOf(late)} is overdue and holding up ${plural(waiting.length, 'task', 'tasks')}`, `${keyOf(late)} (${owner}) was due ${relativeDay(late.dueDate!, today)} and blocks ${keys(waiting, 4)}.`, [keyOf(late), ...refs(waiting, 3)], link(late), p, late.dueDate),
      );
    }
    const unassigned = list
      .filter((t) => !t.assigneeId && t.status !== 'DONE' && t.dueDate && t.dueDate <= addDaysIso(today, MILESTONE_WINDOW_DAYS))
      .sort((a, b) => a.dueDate!.localeCompare(b.dueDate!));
    if (unassigned.length) {
      items.push(
        item(`unassigned-${p.id}`, 'UNASSIGNED', 'LOW', `${plural(unassigned.length, 'task has', 'tasks have')} no assignee in ${p.key}`, `${keys(unassigned, 4)} ${unassigned.length === 1 ? 'is' : 'are'} due within ${MILESTONE_WINDOW_DAYS} days.`, refs(unassigned, 4), `/projects/${p.id}/tasks?assignee=unassigned`, p, unassigned[0].dueDate),
      );
    }
  }

  // Workload: one person holding several overdue tasks across the projects the user manages.
  const byPerson = new Map<number, TaskRow[]>();
  for (const t of managedOverdue) if (t.assigneeId && t.assigneeId !== userId) byPerson.set(t.assigneeId, [...(byPerson.get(t.assigneeId) ?? []), t]);
  for (const [uid, theirs] of byPerson) {
    if (theirs.length < OVERDUE_PER_PERSON) continue;
    const where = [...new Set(theirs.map((t) => t.projectId))].map((id) => db.projects.find((p) => p.id === id)!);
    const open = tasks.filter((t) => t.assigneeId === uid && t.status !== 'DONE' && where.some((p) => p.id === t.projectId)).length;
    const scope = where.length === 1 ? `in ${where[0].key}` : `across ${where.length} projects (${where.map((p) => p.key).join(', ')})`;
    items.push(
      item(`workload-${uid}`, 'WORKLOAD', 'MEDIUM', `${userName(uid)} has ${theirs.length} overdue tasks ${scope}`, `Overdue: ${keys(theirs, 4)}. ${plural(open, 'open task', 'open tasks')} assigned to them in total. Consider re-planning or reassigning.`, refs(theirs, 4), `/projects/${where[0].id}/tasks?assignee=${uid}&due=overdue`, where[0], theirs[0].dueDate),
    );
  }

  items.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || (a.date ?? '9999').localeCompare(b.date ?? '9999') || a.id.localeCompare(b.id));

  const since = now.getTime() - APPROVED_WINDOW_DAYS * 86_400_000;
  const recentlyApproved: ApprovedItem[] = subs
    .filter((s) => s.status === 'APPROVED')
    .map((s) => ({ s, r: reviewOf(s) }))
    .filter((x): x is { s: SubmissionRow; r: NonNullable<ReturnType<typeof reviewOf>> } => !!x.r && parseISO(x.r.createdAt).getTime() > since)
    .sort((a, b) => b.r.createdAt.localeCompare(a.r.createdAt))
    .slice(0, 6)
    .map(({ s, r }) => {
      const t = tasks.find((x) => x.id === s.taskId)!;
      const p = projectOf(t);
      return {
        taskId: t.id,
        taskKey: keyOf(t),
        title: t.title,
        projectId: p.id,
        projectName: p.name,
        projectColor: p.color,
        approvedAt: r.createdAt,
        reviewer: userSummary(db.users.find((u) => u.id === r.reviewerId)!),
        submittedBy: userSummary(db.users.find((u) => u.id === s.submittedById)!),
        version: s.version,
        evidenceCount: db.evidence.filter((e) => e.submissionId === s.id).length,
        criteriaCount: db.submissionCriteria.filter((c) => c.submissionId === s.id).length,
        link: `${link(t)}/review`,
      };
    });

  return { attention: items.slice(0, MAX_ITEMS), recentlyApproved };
}

/** Quick search: same ranking as the backend's SearchService. */
export function rank(query: string, key: string, title: string): number {
  const q = query.toLowerCase();
  const k = key.toLowerCase();
  const t = title.toLowerCase();
  if (k === q) return 0;
  if (k && k.startsWith(q)) return 1;
  if (t.startsWith(q)) return 2;
  if (t.includes(` ${q}`)) return 3;
  if (t.includes(q) || k.includes(q)) return 4;
  return -1;
}
