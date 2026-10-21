/**
 * Deterministic planning simulation.
 *
 * Given open tasks, their estimates (working days), assignees, finish-to-start dependencies
 * and a "today", it projects a start and finish date for every open task. Same input, same
 * output: no randomness, no clock reads (today is a parameter), stable tie-breaks.
 *
 * Rules
 * - Working days are Monday–Friday. A person's days off (scenario only) are also skipped for them.
 * - One task at a time per person. Unassigned tasks have no person constraint (flagged).
 * - A task starts the working day after all its unfinished blockers finish.
 * - Remaining work: To Do → the estimate; In Progress → estimate minus working days already
 *   spent (at least 1); In Review → 0 (awaiting approval, finishes today).
 * - No estimate → 1 working day is assumed and the task is flagged, never silently.
 * - Order: in-progress work first, then higher priority, earlier due date, then key.
 *
 * Everything the simulation outputs is an estimate and must be labelled as one.
 */
import type { Priority, TaskStatus } from '@/api/types';

export const DEFAULT_ESTIMATE = 1;

// ---------------------------------------------------------------- dates

const DAY_MS = 86_400_000;
const toUtc = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
const fromUtc = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function addDays(iso: string, n: number): string {
  return fromUtc(toUtc(iso) + n * DAY_MS);
}

export function isWeekday(iso: string): boolean {
  const d = new Date(toUtc(iso)).getUTCDay();
  return d !== 0 && d !== 6;
}

type WorkingDay = (iso: string) => boolean;

/** The same day if it's a working day, otherwise the next one. */
export function nextWorkingDay(iso: string, working: WorkingDay = isWeekday): string {
  let d = iso;
  for (let i = 0; i < 3660 && !working(d); i++) d = addDays(d, 1);
  return d;
}

/** Finish date of `n` working days of work starting on `start` (inclusive). n ≥ 1. */
export function addWorkingDays(start: string, n: number, working: WorkingDay = isWeekday): string {
  let d = nextWorkingDay(start, working);
  for (let left = n - 1; left > 0; left--) d = nextWorkingDay(addDays(d, 1), working);
  return d;
}

/** Working days from `a` to `b`: positive if b is later (a exclusive, b inclusive), negative if earlier, 0 if same. */
export function workingDaysBetween(a: string, b: string): number {
  if (a === b) return 0;
  const [lo, hi, sign] = a < b ? [a, b, 1] : [b, a, -1];
  let n = 0;
  for (let d = addDays(lo, 1); d <= hi; d = addDays(d, 1)) if (isWeekday(d)) n++;
  return sign * n;
}

// ---------------------------------------------------------------- model

export interface PlanTask {
  id: number;
  key: string;
  title: string;
  status: TaskStatus;
  priority: Priority;
  assigneeId: number | null;
  dueDate: string | null;
  estimateDays: number | null;
  /** yyyy-MM-dd of first start, if started. */
  startedOn: string | null;
  milestoneId: number | null;
}

export interface PlanDependency {
  blockerId: number;
  blockedId: number;
}

export interface TimeOff {
  userId: number;
  from: string;
  to: string;
}

export interface PlanInput {
  today: string;
  tasks: PlanTask[];
  dependencies: PlanDependency[];
  timeOff?: TimeOff[];
}

export type PlanFlag = 'NO_ESTIMATE' | 'UNASSIGNED' | 'LATE' | 'NO_DUE_DATE' | 'WAITING_ON_BLOCKER' | 'AWAITING_REVIEW';

export interface ScheduledTask {
  taskId: number;
  start: string;
  finish: string;
  /** Working days of work still to do, as used by the simulation. */
  remainingDays: number;
  /** The estimate used (the task's own, or the assumed default). */
  estimateUsed: number;
  /** Working days late versus the due date (positive = late), or null without a due date. */
  slipDays: number | null;
  flags: PlanFlag[];
  /** The blocker whose finish decided this task's start, if any. */
  drivenBy: number | null;
}

export interface PlanOutcome {
  today: string;
  scheduled: Map<number, ScheduledTask>;
  /** Latest projected finish across open tasks, or null if nothing is open. */
  finish: string | null;
  late: number[];
  assumed: number[];
}

const PRIORITY_RANK: Record<Priority, number> = { URGENT: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
const STATUS_RANK: Record<TaskStatus, number> = { IN_REVIEW: 0, IN_PROGRESS: 1, TODO: 2, DONE: 3 };
const keyOrder = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

function compare(a: PlanTask, b: PlanTask): number {
  return (
    STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
    PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority] ||
    (a.dueDate ?? '9999-12-31').localeCompare(b.dueDate ?? '9999-12-31') ||
    keyOrder(a.key, b.key)
  );
}

/** Run the simulation. Pure: the result depends only on `input`. */
export function schedule(input: PlanInput): PlanOutcome {
  const today = nextWorkingDay(input.today);
  const open = input.tasks.filter((t) => t.status !== 'DONE');
  const openIds = new Set(open.map((t) => t.id));
  const deps = input.dependencies.filter((d) => openIds.has(d.blockerId) && openIds.has(d.blockedId) && d.blockerId !== d.blockedId);

  const daysOff = new Map<number, Set<string>>();
  for (const off of input.timeOff ?? []) {
    const set = daysOff.get(off.userId) ?? new Set<string>();
    for (let d = off.from; d <= off.to; d = addDays(d, 1)) set.add(d);
    daysOff.set(off.userId, set);
  }
  const calendarFor = (userId: number | null): WorkingDay => {
    const off = userId === null ? undefined : daysOff.get(userId);
    return off ? (d) => isWeekday(d) && !off.has(d) : isWeekday;
  };

  const preds = new Map<number, number[]>();
  const succs = new Map<number, number[]>();
  for (const d of deps) {
    preds.set(d.blockedId, [...(preds.get(d.blockedId) ?? []), d.blockerId]);
    succs.set(d.blockerId, [...(succs.get(d.blockerId) ?? []), d.blockedId]);
  }
  const indeg = new Map(open.map((t) => [t.id, preds.get(t.id)?.length ?? 0]));
  const byId = new Map(open.map((t) => [t.id, t]));
  const ready = open.filter((t) => indeg.get(t.id) === 0);
  const freeFrom = new Map<number, string>();
  const scheduled = new Map<number, ScheduledTask>();

  const place = (t: PlanTask) => {
    const flags: PlanFlag[] = [];
    const cal = calendarFor(t.assigneeId);
    const estimateUsed = t.estimateDays ?? DEFAULT_ESTIMATE;
    if (t.estimateDays === null) flags.push('NO_ESTIMATE');
    if (t.assigneeId === null) flags.push('UNASSIGNED');
    if (t.dueDate === null) flags.push('NO_DUE_DATE');

    let earliest = today;
    let drivenBy: number | null = null;
    for (const b of preds.get(t.id) ?? []) {
      const s = scheduled.get(b);
      if (!s) continue;
      const after = nextWorkingDay(addDays(s.finish, 1));
      if (after > earliest) {
        earliest = after;
        drivenBy = b;
      }
    }
    if (drivenBy !== null) flags.push('WAITING_ON_BLOCKER');

    let start: string;
    let finish: string;
    let remainingDays: number;
    if (t.status === 'IN_REVIEW') {
      flags.push('AWAITING_REVIEW');
      remainingDays = 0;
      start = finish = earliest;
    } else {
      const spent = t.status === 'IN_PROGRESS' && t.startedOn ? Math.max(0, workingDaysBetween(t.startedOn, input.today)) : 0;
      remainingDays = Math.max(1, estimateUsed - spent);
      if (t.assigneeId !== null) {
        const free = freeFrom.get(t.assigneeId);
        if (free && free > earliest) {
          earliest = free;
          if (drivenBy !== null && flags.includes('WAITING_ON_BLOCKER')) {
            // The person, not the blocker, is now the limiting factor.
            drivenBy = null;
            flags.splice(flags.indexOf('WAITING_ON_BLOCKER'), 1);
          }
        }
      }
      start = nextWorkingDay(earliest, cal);
      finish = addWorkingDays(start, remainingDays, cal);
      if (t.assigneeId !== null) freeFrom.set(t.assigneeId, addDays(finish, 1));
    }
    const slipDays = t.dueDate ? workingDaysBetween(t.dueDate, finish) : null;
    if (slipDays !== null && slipDays > 0) flags.push('LATE');
    scheduled.set(t.id, { taskId: t.id, start, finish, remainingDays, estimateUsed, slipDays, flags, drivenBy });
  };

  while (ready.length) {
    ready.sort(compare);
    const t = ready.shift()!;
    place(t);
    for (const n of succs.get(t.id) ?? []) {
      indeg.set(n, (indeg.get(n) ?? 1) - 1);
      if (indeg.get(n) === 0) ready.push(byId.get(n)!);
    }
  }
  // Defensive: anything left is in a cycle (the server rejects cycles). Place it without its blockers.
  for (const t of open.filter((x) => !scheduled.has(x.id)).sort(compare)) place(t);

  const finishes = [...scheduled.values()].map((s) => s.finish).sort();
  return {
    today: input.today,
    scheduled,
    finish: finishes.at(-1) ?? null,
    late: [...scheduled.values()].filter((s) => s.flags.includes('LATE')).map((s) => s.taskId),
    assumed: [...scheduled.values()].filter((s) => s.flags.includes('NO_ESTIMATE')).map((s) => s.taskId),
  };
}

// ---------------------------------------------------------------- scenarios

export type Tweak =
  | { kind: 'reassign'; taskId: number; assigneeId: number | null }
  | { kind: 'estimate'; taskId: number; days: number }
  | { kind: 'timeOff'; userId: number; from: string; to: string };

/** Apply scenario tweaks to a baseline input (returns a new input; the baseline is untouched). */
export function applyTweaks(base: PlanInput, tweaks: readonly Tweak[]): PlanInput {
  const tasks = base.tasks.map((t) => ({ ...t }));
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const timeOff = [...(base.timeOff ?? [])];
  for (const tw of tweaks) {
    if (tw.kind === 'reassign') {
      const t = byId.get(tw.taskId);
      if (t) t.assigneeId = tw.assigneeId;
    } else if (tw.kind === 'estimate') {
      const t = byId.get(tw.taskId);
      if (t) t.estimateDays = tw.days;
    } else {
      timeOff.push({ userId: tw.userId, from: tw.from <= tw.to ? tw.from : tw.to, to: tw.from <= tw.to ? tw.to : tw.from });
    }
  }
  return { ...base, tasks, timeOff };
}

export interface Comparison {
  moved: { taskId: number; from: string; to: string; delta: number }[];
  newlyLate: number[];
  noLongerLate: number[];
  finishDelta: number | null;
}

/** What changes between two outcomes, in working days (positive = later). */
export function compareOutcomes(base: PlanOutcome, next: PlanOutcome): Comparison {
  const moved: Comparison['moved'] = [];
  for (const [id, s] of next.scheduled) {
    const b = base.scheduled.get(id);
    if (b && b.finish !== s.finish) moved.push({ taskId: id, from: b.finish, to: s.finish, delta: workingDaysBetween(b.finish, s.finish) });
  }
  moved.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.taskId - b.taskId);
  const baseLate = new Set(base.late);
  const nextLate = new Set(next.late);
  return {
    moved,
    newlyLate: next.late.filter((id) => !baseLate.has(id)),
    noLongerLate: base.late.filter((id) => !nextLate.has(id)),
    finishDelta: base.finish && next.finish ? workingDaysBetween(base.finish, next.finish) : null,
  };
}
