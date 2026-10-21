import type { Member, Role, Task, UserSummary } from '@/api/types';
import { can } from '@/lib/permissions';
import { forecastProgress, type ProgressForecast } from '@/lib/progressForecast';
import { workingDaysBetween } from '@/lib/scheduler';
import { dayToIso, type ProjectModel } from '@/three/projectModel';
import type { MilestoneBlocker } from './deliveryPath';

/*
 * The blocker journey's arithmetic: what a blocker costs the project, and what each response would
 * do to the forecast, computed with the same forecast as the page (same records, same random draws;
 * only the response changes). Nothing here changes anything: a response is applied only when the
 * person confirms it, through the normal endpoints and their permission checks.
 */

export type ResponseKind = 'review-now' | 'ask-review' | 'cut-scope' | 'reassign' | 'take-it' | 'ask-owner';

export type ResponseAction =
  | { type: 'estimate'; taskId: number; from: number | null; days: number }
  | { type: 'assign'; taskId: number; from: UserSummary | null; user: UserSummary }
  | { type: 'comment'; taskId: number; text: string }
  | { type: 'open'; to: string };

export interface RecoveryOption {
  id: string;
  kind: ResponseKind;
  title: string;
  /** What confirming does, in a sentence. */
  detail: string;
  /** The forecast with this response; null when it doesn't change the forecast (a message). */
  forecast: ProgressForecast | null;
  action: ResponseAction;
  /** Why this person can't confirm it, or null. */
  blockedReason: string | null;
}

export interface BlockerImpact {
  /** Working days the blocker costs the likely finish: now against done (or decided) today. */
  costDays: number;
  /** The forecast if it were done or decided today. */
  ifDone: ProgressForecast;
  /** For a review: the forecast if it waits about another week (5 working days) first. */
  ifWaits: ProgressForecast | null;
  /** Working days a further week's wait would add. */
  waitDays: number | null;
}

/** Working days from one model day to another (positive: later). */
export function workingDelta(model: Pick<ProjectModel, 'originMs'>, from: number, to: number): number {
  return workingDaysBetween(dayToIso(model.originMs, from), dayToIso(model.originMs, to));
}

const likely = (f: ProgressForecast) => f.project.finish?.p50 ?? null;

/** What the blocker costs: the forecast with it done (or its review decided) today, and for a review, with another week's wait. */
export function blockerImpact(model: ProjectModel, tasks: readonly Task[], members: readonly Member[], f: ProgressForecast, blocker: Pick<MilestoneBlocker, 'task'>): BlockerImpact {
  const ifDone = forecastProgress({ model, tasks, members, approveNow: [blocker.task.id] });
  const now = likely(f);
  const done = likely(ifDone);
  const costDays = now !== null && done !== null ? Math.max(0, workingDelta(model, done, now)) : 0;
  let ifWaits: ProgressForecast | null = null;
  let waitDays: number | null = null;
  if (blocker.task.status === 'IN_REVIEW') {
    ifWaits = forecastProgress({ model, tasks, members, holds: { [blocker.task.id]: 7 } });
    const w = likely(ifWaits);
    waitDays = now !== null && w !== null ? Math.max(0, workingDelta(model, now, w)) : null;
  }
  return { costDays, ifDone, ifWaits, waitDays };
}

const names = (keys: string[]) => (keys.length <= 2 ? keys.join(' and ') : `${keys.slice(0, 2).join(', ')} and ${keys.length - 2} more`);

export interface RecoveryContext {
  projectId: number;
  model: ProjectModel;
  tasks: readonly Task[];
  members: readonly Member[];
  forecast: ProgressForecast;
  blocker: Pick<MilestoneBlocker, 'task' | 'kind' | 'holdsUp'>;
  impact: BlockerImpact;
  me: { id: number; role: Role | null };
  /** Who submitted the work under review (a reviewer can't approve their own), when it's in review. */
  submitterId: number | null;
  /** When it went to review, as text ("Tue 14 Oct"), for the message. */
  inReviewSince: string | null;
}

/**
 * The responses worth comparing for this blocker, each with its forecast. A review: decide it now,
 * or ask a reviewer. Work: cut its scope, move it to someone with room, take it, or ask its owner
 * what would help. Assigning and re-estimating are the person's own changes, made only when they
 * confirm; Flurry never does either by itself.
 */
export function recoveryOptions(c: RecoveryContext): RecoveryOption[] {
  const t = c.blocker.task;
  const out: RecoveryOption[] = [];
  const like = { status: t.status, assigneeId: t.assignee?.id ?? null, reporterId: t.reporter.id };
  const held = c.blocker.holdsUp.map((x) => x.key);
  const commentBlocked = can.comment(c.me.role) ? null : 'Only members can write comments.';

  if (t.status === 'IN_REVIEW') {
    const mayReview = c.submitterId !== null && can.reviewSubmission(c.me.role, c.submitterId, c.me.id);
    out.push({
      id: 'review-now',
      kind: 'review-now',
      title: 'Decide the review today',
      detail: 'Opens the review workspace. The decision is yours to make there.',
      forecast: c.impact.ifDone,
      action: { type: 'open', to: `/projects/${c.projectId}/tasks/${t.id}/review` },
      blockedReason: mayReview ? null : c.submitterId === c.me.id ? 'You submitted this work, so someone else has to review it.' : 'Only owners and managers review work.',
    });
    const reviewers = c.members.filter((m) => (m.role === 'OWNER' || m.role === 'MANAGER') && m.user.id !== c.submitterId && m.user.id !== c.me.id);
    if (reviewers.length) {
      const who = reviewers.slice(0, 3).map((m) => `@${m.user.name}`).join(' ');
      out.push({
        id: 'ask-review',
        kind: 'ask-review',
        title: reviewers.length === 1 ? `Ask ${reviewers[0].user.name} for the review` : 'Ask a reviewer',
        detail: 'Posts a comment on the task that mentions them, so they’re notified.',
        forecast: null,
        action: {
          type: 'comment',
          taskId: t.id,
          text: `${who} ${t.key} has been waiting for a review${c.inReviewSince ? ` since ${c.inReviewSince}` : ''}${held.length ? `, and ${names(held)} ${held.length === 1 ? 'waits' : 'wait'} on it` : ''}. Could one of you review it?`,
        },
        blockedReason: commentBlocked,
      });
    }
    return out;
  }

  // Work that isn't in review yet.
  const est = t.estimateDays ?? null;
  if ((t.status === 'TODO' || t.status === 'IN_PROGRESS') && est !== null && est >= 2) {
    for (const k of [0.75, 0.5]) {
      const days = Math.max(1, Math.round(est * k));
      if (days >= est) continue;
      out.push({
        id: `cut-${Math.round(k * 100)}`,
        kind: 'cut-scope',
        title: `Cut ${t.key} to ${days} working ${days === 1 ? 'day' : 'days'}`,
        detail: `Changes its estimate from ${est} to ${days} working days. Agree what’s left out first: the estimate only records it.`,
        forecast: forecastProgress({ model: c.model, tasks: c.tasks, members: c.members, estimates: { [t.id]: days } }),
        action: { type: 'estimate', taskId: t.id, from: est, days },
        blockedReason: can.editTask(c.me.role, like, c.me.id) ? null : 'Only managers, or the task’s owner or creator, can change its estimate.',
      });
    }
  }

  // Someone with room: members who can own work, by when their own open work is likely done.
  const freeAt = new Map(c.forecast.people.filter((p) => p.userId !== null).map((p) => [p.userId!, p.finish?.p50 ?? -Infinity]));
  const candidates = c.members
    .filter((m) => m.role !== 'VIEWER' && m.user.id !== t.assignee?.id)
    .sort((a, b) => (freeAt.get(a.user.id) ?? -Infinity) - (freeAt.get(b.user.id) ?? -Infinity) || a.user.name.localeCompare(b.user.name))
    .slice(0, 2);
  for (const m of candidates) {
    const self = m.user.id === c.me.id;
    const tasks = c.tasks.map((x) => (x.id === t.id ? { ...x, assignee: m.user } : x));
    out.push({
      id: `${self && !t.assignee ? 'take' : 'assign'}-${m.user.id}`,
      kind: self && !t.assignee ? 'take-it' : 'reassign',
      title: self && !t.assignee ? `Take ${t.key} yourself` : `Move ${t.key} to ${m.user.name}`,
      detail: self && !t.assignee ? 'Makes you its owner.' : `Makes ${m.user.name} its owner${t.assignee ? ` instead of ${t.assignee.name}` : ''}. Talk to them first: the forecast can’t see their other plans.`,
      forecast: forecastProgress({ model: c.model, tasks, members: c.members }),
      action: { type: 'assign', taskId: t.id, from: t.assignee, user: m.user },
      blockedReason: can.assignTask(c.me.role, like, c.me.id, m.user.id) ? null : 'Only owners and managers can give work to someone else.',
    });
  }

  if (t.assignee && t.assignee.id !== c.me.id) {
    out.push({
      id: 'ask-owner',
      kind: 'ask-owner',
      title: `Ask ${t.assignee.name} what would help`,
      detail: 'Posts a comment on the task that mentions them, asking for what the records don’t show.',
      forecast: null,
      action: {
        type: 'comment',
        taskId: t.id,
        text: `@${t.assignee.name} ${t.key} ${held.length ? `is holding up ${names(held)}` : 'is the last open work here'}. What would help it finish sooner, and is anything in the way that isn’t recorded?`,
      },
      blockedReason: commentBlocked,
    });
  }
  return out;
}

/** An option's effect against the current forecast, in working days of the likely finish (negative: sooner). */
export function optionDelta(model: Pick<ProjectModel, 'originMs'>, now: ProgressForecast, o: Pick<RecoveryOption, 'forecast'>): number | null {
  if (!o.forecast) return null;
  const a = likely(now);
  const b = likely(o.forecast);
  return a !== null && b !== null ? workingDelta(model, a, b) : null;
}
