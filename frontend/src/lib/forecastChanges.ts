import type { ChangeLog, Dependency, FieldChange, Member, Milestone, Priority, StatusChange, Task, TaskStatus, UserSummary } from '@/api/types';
import { todayIso } from '@/lib/dates';
import { buildProjectModel, dayToIso } from '@/three/projectModel';
import { forecastProgress, type ProgressForecast } from './progressForecast';
import { workingDaysBetween } from './scheduler';

/*
 * Why the date moved: the forecast replayed as of an earlier moment, then brought forward one kind
 * of recorded change at a time, so each kind's effect on the likely finish is measured, not guessed.
 *
 *   then      the project as it stood (tasks that existed, their estimates, owners, dependencies
 *             and statuses then), forecast as of then
 *   scope     + tasks added since, and estimates, due dates and priorities as they are now
 *   blocked   + dependencies as they are now
 *   owners    + owners as they are now
 *   progress  + everything that happened since: time passing and the work recorded (= now)
 *
 * Each step's effect is the change in the likely (median) finish, in working days. The steps add up
 * to the whole move. The order matters a little: a change can matter more or less depending on what
 * came before it, so the split is a fair account of the records, not the only possible one.
 *
 * What it can't see: tasks deleted since (they can't be replayed, so they're in neither forecast),
 * changes nobody recorded (someone's time off), and owners whose names two members share.
 */

export type ChangeKind = 'scope' | 'blocked' | 'owners' | 'progress';

export interface ChangeFact {
  text: string;
  /** Task keys it names, for links. */
  keys: string[];
  /** A review that waited longer than usual. */
  review?: boolean;
}

export interface ChangeStep {
  kind: ChangeKind;
  /** Working days this moved the likely finish (positive: later). Null when it can't be measured. */
  days: number | null;
  facts: ChangeFact[];
}

export interface FinishView {
  likely: string;
  optimistic: string;
  cautious: string;
  /** Chance of meeting the deadline, 0–1, or null without one. */
  pDeadline: number | null;
}

export interface ReviewWait {
  taskId: number;
  key: string;
  /** Calendar days it waited (or has waited so far) in review within the period. */
  days: number;
  usual: number;
  pending: boolean;
  /** Open tasks that wait on it. */
  holdsUp: number;
}

export interface ForecastChange {
  /** The moment compared with (yyyy-MM-dd). */
  since: string;
  then: FinishView | null;
  now: FinishView | null;
  /** Working days the likely finish moved (positive: later), or null when either side has nothing open. */
  totalDays: number | null;
  steps: ChangeStep[];
  reviewWaits: ReviewWait[];
  notes: string[];
}

export interface ReplayInput {
  now: Date;
  since: Date;
  project: { startDate: string; deadline: string | null };
  tasks: readonly Task[];
  dependencies: readonly Dependency[];
  milestones: readonly Milestone[];
  history: readonly StatusChange[];
  members: readonly Member[];
  log: ChangeLog;
  runs?: number;
}

const DAY_MS = 86_400_000;
const ms = (iso: string) => new Date(iso).getTime();
const PRIORITIES: Priority[] = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];

interface Snapshot {
  now: Date;
  tasks: Task[];
  dependencies: Dependency[];
  history: StatusChange[];
}

// ------------------------------------------------------------------ the project as it stood

/** The earliest recorded change of a field after `t0` holds its value at `t0` (its old value). */
function firstAfter(log: ChangeLog, t0: number): Map<string, FieldChange> {
  const out = new Map<string, FieldChange>();
  const sorted = [...log.changes].filter((c) => ms(c.at) > t0).sort((a, b) => ms(a.at) - ms(b.at));
  for (const c of sorted) {
    if (c.field === 'dependency') continue;
    const k = `${c.taskId}:${c.field}`;
    if (!out.has(k)) out.set(k, c);
  }
  return out;
}

function person(name: string | null, id: number | null, members: readonly Member[]): UserSummary | null {
  if (name === null) return null;
  const m = id !== null ? members.find((x) => x.user.id === id) : undefined;
  if (m) return m.user;
  // Someone no longer in the project, or a name two members share: kept apart from everyone else.
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return { id: -1 - Math.abs(h % 1_000_000), name, email: '', avatarColor: '#888888' };
}

/** A task's status, start and approval as recorded at `t` (from its status history, or its own dates without one). */
export function statusAsOf(task: Task, history: readonly StatusChange[], t: number): Pick<Task, 'status' | 'startedAt' | 'completedAt'> {
  const own = history.filter((e) => e.taskId === task.id && ms(e.at) <= t).sort((a, b) => ms(a.at) - ms(b.at));
  const startedAt = task.startedAt && ms(task.startedAt) <= t ? task.startedAt : null;
  if (own.length) {
    const status = own[own.length - 1].to;
    const lastDone = [...own].reverse().find((e) => e.to === 'DONE');
    const completedAt = status === 'DONE' ? (task.completedAt && ms(task.completedAt) <= t ? task.completedAt : (lastDone?.at ?? null)) : null;
    const firstStart = own.find((e) => e.to === 'IN_PROGRESS')?.at ?? null;
    return { status, startedAt: startedAt ?? firstStart, completedAt };
  }
  const anyEvents = history.some((e) => e.taskId === task.id);
  if (anyEvents) return { status: 'TODO', startedAt: null, completedAt: null };
  if (task.completedAt && ms(task.completedAt) <= t) return { status: 'DONE', startedAt, completedAt: task.completedAt };
  if (startedAt) return { status: 'IN_PROGRESS', startedAt, completedAt: null };
  return { status: 'TODO', startedAt: null, completedAt: null };
}

function iso(t: number): string {
  return new Date(t).toISOString();
}

function dependency(blocked: Task, blocker: Task): Dependency {
  const small = (t: Task) => ({ id: t.id, key: t.key, title: t.title, status: t.status, dueDate: t.dueDate, assignee: t.assignee, overdue: false, startedAt: t.startedAt });
  return { id: -blocked.id * 100_000 - blocker.id, projectId: blocked.projectId, blocker: small(blocker), blocked: small(blocked), createdBy: blocked.reporter, createdAt: blocked.createdAt } as Dependency;
}

/** Dependencies as they were at `t0`: today's, with the ones added since taken out and the ones removed since put back. */
export function dependenciesAsOf(deps: readonly Dependency[], log: ChangeLog, t0: number, tasks: readonly Task[]): { deps: Dependency[]; lost: string[] } {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  let set = [...deps];
  const lost: string[] = [];
  const changes = log.changes.filter((c) => c.field === 'dependency' && ms(c.at) > t0).sort((a, b) => ms(b.at) - ms(a.at));
  for (const c of changes) {
    if (c.newValue !== null) {
      set = set.filter((d) => !(d.blocked.id === c.taskId && (d.blocker.id === c.blockerId || d.blocker.key === c.newValue)));
    } else if (c.oldValue !== null) {
      const blocked = byId.get(c.taskId);
      const blocker = c.blockerId !== null ? byId.get(c.blockerId) : undefined;
      if (blocked && blocker && !set.some((d) => d.blocked.id === blocked.id && d.blocker.id === blocker.id)) set.push(dependency(blocked, blocker));
      else if (!blocker) lost.push(`${c.taskKey} waited on ${c.oldValue}`);
    }
  }
  return { deps: set, lost };
}

// ------------------------------------------------------------------ forecasting a snapshot

function finishOf(s: Snapshot, input: ReplayInput): { view: FinishView | null; forecast: ProgressForecast | null } {
  if (!s.tasks.length) return { view: null, forecast: null };
  const model = buildProjectModel({
    now: s.now,
    projectStart: input.project.startDate,
    deadline: input.project.deadline,
    tasks: s.tasks,
    dependencies: s.dependencies,
    milestones: input.milestones,
    history: s.history,
    projection: null,
  });
  const forecast = forecastProgress({ model, tasks: s.tasks, members: input.members, runs: input.runs ?? 400 });
  const r = forecast.project.finish;
  if (!r) return { view: null, forecast };
  return {
    view: { likely: dayToIso(model.originMs, r.p50), optimistic: dayToIso(model.originMs, r.p10), cautious: dayToIso(model.originMs, r.p90), pDeadline: forecast.project.pDeadline },
    forecast,
  };
}

const between = (a: FinishView | null, b: FinishView | null) => (a && b ? workingDaysBetween(a.likely, b.likely) : null);

function list(keys: string[], max = 4): string {
  const shown = keys.slice(0, max);
  const rest = keys.length - shown.length;
  const head = shown.length > 1 ? `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}` : (shown[0] ?? '');
  return rest > 0 ? `${shown.join(', ')} and ${rest} more` : head;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const daysWord = (n: number) => (n === 1 ? '1 day' : `${n} days`);

// ------------------------------------------------------------------ the explanation

export function explainForecastChange(input: ReplayInput): ForecastChange {
  const t0 = input.since.getTime();
  const t1 = input.now.getTime();
  const sinceIso = todayIso(input.since);
  const notes: string[] = [];
  const first = firstAfter(input.log, t0);
  const value = (task: Task, field: FieldChange['field']) => first.get(`${task.id}:${field}`);

  // Then: the tasks that existed, with their values and statuses then.
  const existed = input.tasks.filter((t) => ms(t.createdAt) <= t0);
  const added = input.tasks.filter((t) => ms(t.createdAt) > t0 && ms(t.createdAt) <= t1).sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }));
  const history0 = input.history.filter((e) => ms(e.at) <= t0);

  const owner0 = (t: Task): UserSummary | null => {
    const c = value(t, 'assignee');
    return c ? person(c.oldValue, c.oldUserId, input.members) : t.assignee;
  };
  const planned0 = (t: Task): Pick<Task, 'estimateDays' | 'dueDate' | 'priority'> => {
    const e = value(t, 'estimate');
    const d = value(t, 'dueDate');
    const p = value(t, 'priority');
    return {
      estimateDays: e ? (e.oldValue === null ? null : Number(e.oldValue) || null) : t.estimateDays,
      dueDate: d ? d.oldValue : t.dueDate,
      priority: p && PRIORITIES.includes(p.oldValue as Priority) ? (p.oldValue as Priority) : t.priority,
    };
  };
  const asThen = (t: Task): Task => ({ ...t, ...statusAsOf(t, input.history, t0), ...planned0(t), assignee: owner0(t), updatedAt: iso(Math.min(ms(t.updatedAt), t0)) });
  // A task added since, as if it had been added then, before anyone started it.
  const asNew = (t: Task, owner: UserSummary | null): Task => ({ ...t, status: 'TODO' as TaskStatus, startedAt: null, completedAt: null, createdAt: iso(t0 - 1), updatedAt: iso(t0 - 1), assignee: owner });

  const tasks0 = existed.map(asThen);
  const { deps: deps0, lost } = dependenciesAsOf(input.dependencies, input.log, t0, input.tasks);
  const ids0 = new Set(tasks0.map((t) => t.id));
  const S0: Snapshot = { now: input.since, tasks: tasks0, dependencies: deps0.filter((d) => ids0.has(d.blocked.id) && ids0.has(d.blocker.id)), history: history0 };

  // Scope and plan: tasks added since, and estimates, due dates and priorities as they are now.
  const tasksA = [
    ...tasks0.map((t) => {
      const cur = input.tasks.find((x) => x.id === t.id)!;
      return { ...t, estimateDays: cur.estimateDays, dueDate: cur.dueDate, priority: cur.priority };
    }),
    ...added.map((t) => asNew(t, owner0(t))),
  ];
  const idsA = new Set(tasksA.map((t) => t.id));
  const SA: Snapshot = { ...S0, tasks: tasksA };
  // Blocked work: dependencies as they are now.
  const SB: Snapshot = { ...SA, dependencies: input.dependencies.filter((d) => idsA.has(d.blocked.id) && idsA.has(d.blocker.id)) };
  // Owners: as they are now.
  const SC: Snapshot = { ...SB, tasks: SB.tasks.map((t) => ({ ...t, assignee: input.tasks.find((x) => x.id === t.id)!.assignee })) };
  // Now: everything that happened since.
  const S1: Snapshot = { now: input.now, tasks: [...input.tasks], dependencies: [...input.dependencies], history: [...input.history] };

  // ---- facts, from the records
  const scopeFacts: ChangeFact[] = [];
  if (added.length) {
    const est = added.reduce((a, t) => a + (t.estimateDays ?? 0), 0);
    const none = added.filter((t) => !t.estimateDays).length;
    scopeFacts.push({
      text: `${list(added.map((t) => t.key))} ${added.length === 1 ? 'was' : 'were'} added` + (est ? ` (${plural(est, 'working day', 'working days')} of estimates${none ? `, ${none} without one` : ''})` : none ? ' (no estimates yet)' : ''),
      keys: added.map((t) => t.key),
    });
  }
  const reestimated = input.tasks.filter((t) => {
    const c = value(t, 'estimate');
    return c && ms(t.createdAt) <= t0 && (c.oldValue === null ? null : Number(c.oldValue)) !== t.estimateDays;
  });
  for (const t of reestimated.slice(0, 4)) {
    const was = planned0(t).estimateDays;
    scopeFacts.push({ text: `${t.key} re-estimated from ${was ?? 'none'} to ${t.estimateDays ? plural(t.estimateDays, 'working day', 'working days') : 'none'}`, keys: [t.key] });
  }
  if (reestimated.length > 4) scopeFacts.push({ text: `${reestimated.length - 4} more re-estimated`, keys: [] });
  const dueMoved = input.tasks.filter((t) => ms(t.createdAt) <= t0 && value(t, 'dueDate') && planned0(t).dueDate !== t.dueDate);
  const reprioritised = input.tasks.filter((t) => ms(t.createdAt) <= t0 && value(t, 'priority') && planned0(t).priority !== t.priority);
  if (dueMoved.length || reprioritised.length) {
    const bits = [dueMoved.length ? plural(dueMoved.length, 'due date', 'due dates') : '', reprioritised.length ? plural(reprioritised.length, 'priority', 'priorities') : ''].filter(Boolean);
    scopeFacts.push({ text: `${bits.join(' and ')} changed`, keys: [...dueMoved, ...reprioritised].map((t) => t.key) });
  }
  const deleted = input.log.deleted.filter((d) => ms(d.at) > t0);
  if (deleted.length) notes.push(`${list(deleted.map((d) => d.key))} ${deleted.length === 1 ? 'was' : 'were'} deleted since then, so ${deleted.length === 1 ? 'it’s' : 'they’re'} in neither forecast.`);

  const blockedFacts: ChangeFact[] = [];
  const now = new Set(input.dependencies.map((d) => `${d.blocked.id}>${d.blocker.id}`));
  const then = new Set(S0.dependencies.map((d) => `${d.blocked.id}>${d.blocker.id}`));
  const keyOf = new Map(input.tasks.map((t) => [t.id, t.key]));
  const newDeps = input.dependencies.filter((d) => !then.has(`${d.blocked.id}>${d.blocker.id}`));
  const goneDeps = S0.dependencies.filter((d) => !now.has(`${d.blocked.id}>${d.blocker.id}`));
  for (const d of newDeps.slice(0, 4)) blockedFacts.push({ text: `${d.blocked.key} now waits on ${d.blocker.key}`, keys: [d.blocked.key, d.blocker.key] });
  for (const d of goneDeps.slice(0, 3)) blockedFacts.push({ text: `${keyOf.get(d.blocked.id) ?? d.blocked.key} no longer waits on ${keyOf.get(d.blocker.id) ?? d.blocker.key}`, keys: [d.blocked.key, d.blocker.key] });
  if (newDeps.length + goneDeps.length > 7) blockedFacts.push({ text: `${newDeps.length + goneDeps.length - 7} more dependency changes`, keys: [] });
  if (lost.length) notes.push(`A dependency on a task deleted since can’t be replayed (${lost.slice(0, 2).join('; ')}).`);

  const ownerFacts: ChangeFact[] = [];
  const moved = input.tasks.filter((t) => ms(t.createdAt) <= t1 && value(t, 'assignee') !== undefined && (owner0(t)?.id ?? null) !== (t.assignee?.id ?? null));
  for (const t of moved.slice(0, 5)) {
    const was = owner0(t);
    const isNew = ms(t.createdAt) > t0;
    ownerFacts.push({
      text: !t.assignee ? `${t.key} lost its owner${was ? ` (${was.name})` : ''}` : !was ? (isNew ? `${t.key} went to ${t.assignee.name}` : `${t.key} was picked up by ${t.assignee.name}`) : `${t.key} moved from ${was.name} to ${t.assignee.name}`,
      keys: [t.key],
    });
  }
  if (moved.length > 5) ownerFacts.push({ text: `${moved.length - 5} more owner changes`, keys: [] });
  if (input.log.changes.some((c) => c.field === 'assignee' && ms(c.at) > t0 && ((c.oldValue !== null && c.oldUserId === null) || (c.newValue !== null && c.newUserId === null)))) {
    notes.push('An owner who has left the project, or whose name another member shares, is treated as a separate person.');
  }

  // ---- forecasts: only the steps with changes are recomputed (the same input gives the same answer)
  const f0 = finishOf(S0, input);
  const fA = added.length || reestimated.length || dueMoved.length || reprioritised.length ? finishOf(SA, input) : f0;
  const fB = newDeps.length || goneDeps.length ? finishOf(SB, input) : fA;
  const fC = moved.length ? finishOf(SC, input) : fB;
  const f1 = finishOf(S1, input);

  // ---- progress since then, from the status history
  const events = input.history.filter((e) => ms(e.at) > t0 && ms(e.at) <= t1);
  const progressFacts: ChangeFact[] = [];
  const passed = workingDaysBetween(sinceIso, todayIso(input.now));
  progressFacts.push({ text: `${plural(Math.max(0, passed), 'working day', 'working days')} passed`, keys: [] });
  const byKind = (to: TaskStatus, from?: TaskStatus) => [...new Set(events.filter((e) => e.to === to && (from === undefined || e.from === from)).map((e) => keyOf.get(e.taskId)).filter((k): k is string => !!k))];
  const approved = byKind('DONE');
  const sentBack = byKind('IN_PROGRESS', 'IN_REVIEW');
  const submitted = byKind('IN_REVIEW');
  const started = byKind('IN_PROGRESS', 'TODO');
  if (approved.length) progressFacts.push({ text: `${list(approved)} ${approved.length === 1 ? 'was' : 'were'} approved`, keys: approved });
  if (submitted.length) progressFacts.push({ text: `${list(submitted)} went to review`, keys: submitted });
  if (sentBack.length) progressFacts.push({ text: `${list(sentBack)} ${sentBack.length === 1 ? 'was' : 'were'} sent back for changes`, keys: sentBack });
  if (started.length) progressFacts.push({ text: `${list(started)} started`, keys: started });
  if (!approved.length && !submitted.length && !started.length && !sentBack.length) progressFacts.push({ text: 'No task changed status', keys: [] });

  // Reviews that waited longer than usual within the period (finished or still waiting).
  const usual = f1.forecast?.reviewLag ?? f0.forecast?.reviewLag ?? 1;
  const waits: ReviewWait[] = [];
  const openIds = new Set(input.tasks.filter((t) => t.status !== 'DONE').map((t) => t.id));
  const waitingOn = (id: number) => input.dependencies.filter((d) => d.blocker.id === id && openIds.has(d.blocked.id)).length;
  for (const t of input.tasks) {
    const own = input.history.filter((e) => e.taskId === t.id).sort((a, b) => ms(a.at) - ms(b.at));
    own.forEach((e, i) => {
      if (e.to !== 'IN_REVIEW') return;
      const enter = ms(e.at);
      const exit = own[i + 1] ? ms(own[i + 1].at) : t1;
      if (exit <= t0 || enter > t1) return;
      const days = (Math.min(exit, t1) - enter) / DAY_MS;
      if (days > usual + 1 && days > usual * 1.5) waits.push({ taskId: t.id, key: t.key, days: Math.round(days), usual: Math.round(usual * 10) / 10, pending: !own[i + 1], holdsUp: waitingOn(t.id) });
    });
  }
  waits.sort((a, b) => Number(b.pending) - Number(a.pending) || b.holdsUp - a.holdsUp || b.days - a.days);
  for (const w of waits.slice(0, 4)) {
    progressFacts.push({
      text: `${w.key} ${w.pending ? 'has waited' : 'waited'} ${daysWord(w.days)} for review (usually about ${daysWord(Math.max(1, Math.round(w.usual)))})` + (w.holdsUp ? `; ${plural(w.holdsUp, 'open task waits', 'open tasks wait')} on it` : ''),
      keys: [w.key],
      review: true,
    });
  }

  if (input.log.truncated) notes.push('There were more recorded changes than one replay reads, so this is approximate.');
  const steps: ChangeStep[] = [
    { kind: 'scope', days: scopeFacts.length ? between(f0.view, fA.view) : 0, facts: scopeFacts },
    { kind: 'blocked', days: blockedFacts.length ? between(fA.view, fB.view) : 0, facts: blockedFacts },
    { kind: 'owners', days: ownerFacts.length ? between(fB.view, fC.view) : 0, facts: ownerFacts },
    { kind: 'progress', days: between(fC.view, f1.view), facts: progressFacts },
  ];
  return { since: sinceIso, then: f0.view, now: f1.view, totalDays: between(f0.view, f1.view), steps, reviewWaits: waits, notes };
}

/** The local midnight `days` ago, as a moment. */
export function daysAgo(days: number, now: Date = new Date()): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - days);
  return d;
}

/** One line for Flurry and the page: "Likely finish moved 5 working days later since 13 Oct, mostly from scope." */
export function changeHeadline(c: ForecastChange, dateText: (iso: string) => string): string {
  if (!c.then && !c.now) return `Nothing was open on ${dateText(c.since)} or now.`;
  if (!c.then) return `Nothing was open on ${dateText(c.since)}; now the likely finish is ${dateText(c.now!.likely)}.`;
  if (!c.now) return `Everything open on ${dateText(c.since)} has been approved.`;
  const d = c.totalDays ?? 0;
  if (d === 0) return `The likely finish is ${dateText(c.now.likely)}, the same as on ${dateText(c.since)}.`;
  const main = [...c.steps].filter((s) => s.days !== null && Math.sign(s.days) === Math.sign(d)).sort((a, b) => Math.abs(b.days!) - Math.abs(a.days!))[0];
  const why = main ? `, mostly ${STEP_REASON[main.kind]}` : '';
  return `The likely finish moved from ${dateText(c.then.likely)} to ${dateText(c.now.likely)}: ${Math.abs(d)} working ${Math.abs(d) === 1 ? 'day' : 'days'} ${d > 0 ? 'later' : 'earlier'} than on ${dateText(c.since)}${why}.`;
}

export const STEP_LABEL: Record<ChangeKind, string> = {
  scope: 'Scope and plan',
  blocked: 'Blocked work',
  owners: 'Owners',
  progress: 'Progress and waiting',
};

const STEP_REASON: Record<ChangeKind, string> = {
  scope: 'from scope and estimates',
  blocked: 'from new dependencies',
  owners: 'from owner changes',
  progress: 'from how the work went since',
};
