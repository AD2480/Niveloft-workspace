import type { Member, Role, Task } from '@/api/types';
import { statusAt, type ModelBlock, type ProjectModel } from '@/three/projectModel';

/*
 * Delivery forecasting: when open work is likely to be approved, from the records, with ranges.
 * Three questions are kept apart, because they have different answers:
 *   1. How much work is left for a person (effort)?
 *   2. When will their work be approved, given dependencies, other people's work and reviews?
 *   3. When will the whole project be approved?
 *
 * - Each task's working time is its estimate (or the project's typical estimate, flagged) times
 *   the person's learned pace: the log of actual ÷ estimate on their finished tasks, pulled
 *   towards the project's average when they have few. The spread of those ratios becomes the
 *   uncertainty, so a steady person gets a narrow band and an erratic one a wide band.
 * - Work time is measured from start to the final submission, so the time spent waiting for a
 *   review isn't counted twice: a review wait, learned from how long approved work sat in review,
 *   is added after each submission.
 * - Dependencies are respected: a task starts only after everything it waits on is approved.
 *   Each person does one task at a time, and while one task waits they pick up another that can
 *   start (in progress first, then by due date and priority).
 * - Open work nobody owns is simulated as if someone started it today, at the project's pace, and
 *   every result that depends on it says so.
 * - Many seeded runs give a range: p10 (optimistic), p50 (typical), p90 (cautious). The same
 *   records always give the same answer.
 *
 * It's a planning estimate from the records, not a commitment, and it's labelled that way.
 * People are never ranked: pace is only used to predict each person's own work.
 */

/** Calendar days → working days (Mon–Fri), roughly. */
const WORKING = 5 / 7;
const SHRINK = 2;
const DEFAULT_SIGMA = 0.35;
/** Estimates are rarely better than about ±20%, however steady the history looks. */
const MIN_SIGMA = 0.2;
const MAX_HORIZON_DAYS = 365;

export const ROLE_ORDER: (Role | null)[] = ['OWNER', 'MANAGER', 'MEMBER', 'VIEWER', null];
export const ROLE_GROUP_LABEL: Record<Role | 'NONE', string> = { OWNER: 'Owners', MANAGER: 'Managers', MEMBER: 'Members', VIEWER: 'Viewers', NONE: 'Not assigned' };

export interface Range {
  p10: number;
  p50: number;
  p90: number;
  /** The 85th percentile, for "85% likely by" (set on finishes; per-day series don't have it). */
  p85?: number;
}

export interface PersonForecast {
  name: string;
  userId: number | null;
  /** Their role in this project, or null for unassigned work (or someone no longer a member). */
  role: Role | null;
  total: number;
  approved: number;
  open: number;
  /** Cumulative approved tasks at the end of each day, from day 0 to today. */
  history: number[];
  /** Cumulative approved tasks from today to the horizon, as a range per day. */
  forecast: ({ day: number } & Range)[];
  /** The day all their open work is approved (model days), or null when nothing is open or it can't be predicted. */
  finish: Range | null;
  /** Chance all their open work is approved by the deadline, or null without a deadline. */
  pDeadline: number | null;
  /** Actual time ÷ estimate, learned from their finished tasks. */
  pace: { ratio: number; n: number; spread: number };
  /** Open work nobody owns (the "Unassigned" row): simulated as if someone started it today. */
  unpredictable: boolean;
  /** Working days of work left on their open tasks (estimates × pace), as a range. Null when nothing is open. */
  effort: Range | null;
  /** Open tasks of theirs with no estimate (the project's typical estimate was used). */
  unestimated: number;
  /** Working days, on average, they'd sit waiting for other work to be approved before they can continue. */
  waitingDays: number;
  /** The task (someone else's, or unowned) their work waits on most, if it holds them up in at least a quarter of the runs. */
  mainDependency: { taskId: number; key: string; owner: string | null; share: number; days: number } | null;
}

export interface GroupForecast {
  key: Role | 'ALL' | 'NONE';
  label: string;
  people: number;
  total: number;
  approved: number;
  open: number;
  finish: Range | null;
  pDeadline: number | null;
}

export interface ProgressForecast {
  startDay: number;
  todayDay: number;
  horizon: number;
  deadlineDay: number | null;
  people: PersonForecast[];
  roles: GroupForecast[];
  project: GroupForecast;
  runs: number;
  /** Median days approved work waited in review. */
  reviewLag: number;
  /** Finished tasks with an estimate (what pace was learned from). */
  learnedFrom: number;
  /** The project's pace: actual time ÷ estimate. */
  paceRatio: number;
  /** Open tasks without an assignee (simulated as if someone started them today). */
  unassignedOpen: number;
  /** Keys of those tasks, for "assumes someone picks up …". */
  unownedKeys: string[];
  /** Open tasks without an estimate (the typical estimate was used). */
  unestimatedOpen: number;
  /** The typical estimate used for them, in working days. */
  typicalEstimate: number;
  /** Each person's share of their time assumed from now on (1 = as in their recorded work). */
  shares: Record<number, number>;
  /** When each open task is likely to be approved (model days). */
  tasks: Record<number, Range>;
  /** Each open task's typical (median) working period in the simulations: when it starts and is submitted. */
  schedule: Record<number, { start: number; end: number }>;
  /** Working days of work left across all open tasks (estimates × pace), as a range. */
  effort: Range | null;
  /** When each milestone's open work is likely all approved (model days), by milestone id. */
  milestones: Record<number, Range>;
  /** The whole project's approved tasks at the end of each day, from day 0 to today. */
  projectHistory: number[];
  /** The whole project's approved tasks from today to the horizon, as a range per day (p10 optimistic: more approved). */
  projectSeries: ({ day: number } & Range)[];
  /** Total tasks in the project. */
  totalTasks: number;
}

// ------------------------------------------------------------------ random numbers

/** A small seeded generator (mulberry32), so the same records always give the same prediction. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normal(rand: () => number): number {
  const u = Math.max(rand(), 1e-12);
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function quantile(sorted: readonly number[], q: number): number {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

const rangeOf = (values: number[]): Range => {
  const s = [...values].sort((a, b) => a - b);
  return { p10: quantile(s, 0.1), p50: quantile(s, 0.5), p85: quantile(s, 0.85), p90: quantile(s, 0.9) };
};

const median = (xs: number[], fallback: number) => {
  if (!xs.length) return fallback;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

// ------------------------------------------------------------------ learning

/**
 * Working days a finished task took, from when it could really proceed (started, and everything
 * it waited on approved) to its final submission. Waiting for other work and for the review are
 * modelled separately, so they aren't counted twice. Falls back to start → approval when it never
 * went to review.
 */
export function workDays(b: Pick<ModelBlock, 'segments' | 'startedDay' | 'doneDay' | 'blockedBy'>, blocks?: ReadonlyMap<number, Pick<ModelBlock, 'doneDay'>>): number {
  let start = b.startedDay ?? 0;
  for (const id of blocks ? b.blockedBy : []) {
    const d = blocks!.get(id)?.doneDay;
    if (d !== null && d !== undefined && d > start) start = d;
  }
  const done = b.doneDay ?? start;
  const lastReview = [...b.segments].reverse().find((sg) => sg.status === 'IN_REVIEW' && sg.from <= done && sg.from >= start);
  return Math.max(0.25, ((lastReview ? lastReview.from : done) - start) * WORKING);
}

/** Each person's pace (mean and spread of log actual ÷ estimate), shrunk towards the project's. */
export function learnPaceSpread(tasks: readonly Task[], blocks: ReadonlyMap<number, ModelBlock>) {
  const logs: { person: string; log: number }[] = [];
  for (const t of tasks) {
    const b = blocks.get(t.id);
    if (!b || t.status !== 'DONE' || b.startedDay === null || b.doneDay === null || !t.estimateDays || t.estimateDays <= 0) continue;
    const actual = workDays(b, blocks);
    logs.push({ person: t.assignee?.name ?? 'Unassigned', log: Math.log(Math.min(5, Math.max(0.2, actual / t.estimateDays))) });
  }
  const mean = logs.length ? logs.reduce((a, l) => a + l.log, 0) / logs.length : 0;
  const projectVar = logs.length > 1 ? logs.reduce((a, l) => a + (l.log - mean) ** 2, 0) / (logs.length - 1) : DEFAULT_SIGMA ** 2;
  const byPerson = new Map<string, { mu: number; sigma: number; n: number }>();
  const groups = new Map<string, number[]>();
  for (const l of logs) groups.set(l.person, [...(groups.get(l.person) ?? []), l.log]);
  for (const [person, ls] of groups) {
    const mu = (ls.reduce((a, v) => a + v, 0) + SHRINK * mean) / (ls.length + SHRINK);
    const ss = ls.reduce((a, v) => a + (v - mu) ** 2, 0);
    const sigma = Math.sqrt((ss + SHRINK * projectVar) / (ls.length + SHRINK));
    byPerson.set(person, { mu, sigma: Math.max(MIN_SIGMA, sigma), n: ls.length });
  }
  return { overall: { mu: mean, sigma: Math.max(MIN_SIGMA, Math.sqrt(projectVar)), n: logs.length }, byPerson };
}

/** How long approved tasks waited in review (days), from their status history. */
export function reviewLagOf(blocks: readonly ModelBlock[]): number {
  const waits: number[] = [];
  for (const b of blocks) {
    if (b.doneDay === null) continue;
    const review = [...b.segments].reverse().find((s) => s.status === 'IN_REVIEW' && s.from <= b.doneDay!);
    if (review) waits.push(b.doneDay - review.from);
  }
  return Math.min(10, Math.max(0.5, median(waits, 1)));
}

// ------------------------------------------------------------------ the forecast

export interface ForecastInput {
  model: ProjectModel;
  tasks: readonly Task[];
  members: readonly Member[];
  runs?: number;
  seed?: number;
  /**
   * What-if: a person's share of their time from now on, by user id (1 = as in their recorded
   * work, 0.5 = half as much). Work takes proportionally longer; the effort stays the same.
   */
  shares?: Record<number, number>;
  /**
   * What-if: a smaller scope, as new estimates for open tasks (working days, by task id). Only those
   * tasks' working time changes; every other draw stays the same, so the comparison is fair.
   */
  estimates?: Record<number, number>;
  /**
   * What-if: open tasks approved today (by task id), e.g. "if this review were decided today". Their
   * draws are still taken, so every other task's draws stay the same.
   */
  approveNow?: readonly number[];
  /**
   * What-if: the earliest a task can be approved, in days from today (by task id), e.g. "if this
   * review waits another week". Applied after its own work and review wait.
   */
  holds?: Record<number, number>;
}

const OPEN_ORDER = { IN_REVIEW: 0, IN_PROGRESS: 1, TODO: 2, DONE: 3 } as const;
const PRIORITY_ORDER = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 } as const;

export function forecastProgress({ model, tasks, members, runs = 400, seed = 7, shares = {}, estimates = {}, approveNow = [], holds = {} }: ForecastInput): ProgressForecast {
  const blocks = new Map(model.blocks.map((b) => [b.id, b]));
  const today = model.todayDay;
  const todayWhole = Math.floor(today);
  const roleById = new Map(members.map((m) => [m.user.id, m.role]));
  const pace = learnPaceSpread(tasks, blocks);
  const typical = median(tasks.map((t) => t.estimateDays ?? 0).filter((e) => e > 0), 2);
  const lag = reviewLagOf(model.blocks);
  const deadline = model.deadlineDay;

  // People: everyone with assigned tasks, plus members without any (so every role shows up).
  interface Person {
    key: string;
    name: string;
    userId: number | null;
    role: Role | null;
    tasks: { task: Task; block: ModelBlock }[];
  }
  const people = new Map<string, Person>();
  for (const m of members) people.set(`u${m.user.id}`, { key: `u${m.user.id}`, name: m.user.name, userId: m.user.id, role: m.role, tasks: [] });
  for (const t of tasks) {
    const b = blocks.get(t.id);
    if (!b) continue;
    const key = t.assignee ? `u${t.assignee.id}` : 'none';
    if (!people.has(key)) people.set(key, { key, name: t.assignee?.name ?? 'Unassigned', userId: t.assignee?.id ?? null, role: t.assignee ? (roleById.get(t.assignee.id) ?? null) : null, tasks: [] });
    people.get(key)!.tasks.push({ task: t, block: b });
  }

  const startDay = Math.max(0, Math.floor(Math.min(today, ...model.blocks.map((b) => b.createdDay))));
  const isDone = (b: ModelBlock) => statusAt(b, today) === 'DONE';
  const list = [...people.values()];
  const personIndex = new Map(list.map((p, i) => [p.key, i]));

  // The open work, and what each open task waits on (only other open tasks; approved ones don't hold anything up).
  interface Open {
    task: Task;
    block: ModelBlock;
    person: number;
    /** Unowned tasks each get a lane of their own, starting today. */
    lane: string;
    status: 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW';
    preds: number[];
    rank: [number, string, number, number];
  }
  const openList: Open[] = [];
  for (const p of list) {
    for (const { task, block } of p.tasks) {
      if (isDone(block)) continue;
      const status = (statusAt(block, today) ?? 'TODO') as Open['status'];
      openList.push({
        task,
        block,
        person: personIndex.get(p.key)!,
        lane: p.userId ? p.key : `none:${task.id}`,
        status,
        preds: [],
        rank: [OPEN_ORDER[status], task.dueDate ?? '9999-12-31', PRIORITY_ORDER[task.priority] ?? 2, block.id],
      });
    }
  }
  const openIndex = new Map(openList.map((o, i) => [o.block.id, i]));
  for (const o of openList) o.preds = o.block.blockedBy.map((id) => openIndex.get(id)).filter((i): i is number => i !== undefined && i !== openIndex.get(o.block.id));
  const byRank = (a: Open, b: Open) => a.rank[0] - b.rank[0] || a.rank[1].localeCompare(b.rank[1]) || a.rank[2] - b.rank[2] || a.rank[3] - b.rank[3];
  const effectiveRuns = openList.length > 300 ? Math.min(runs, 100) : runs;
  const shareOf = (userId: number | null) => {
    const v = userId !== null ? shares[userId] : undefined;
    return v !== undefined && Number.isFinite(v) ? Math.min(1, Math.max(0.1, v)) : 1;
  };

  // Simulate: every run schedules all open work (one task at a time per person, dependencies first).
  const rand = seeded(seed);
  /** finishTimes[p][run] = sorted approval days of that person's open tasks in that run. */
  const finishTimes: number[][][] = list.map(() => []);
  const effortRuns: number[][] = list.map(() => []);
  const waitRuns: number[][] = list.map(() => []);
  /** blame[p] = task index → { runs it held p up, total idle days }. */
  const blame: Map<number, { runs: number; days: number }>[] = list.map(() => new Map());
  const taskApproved: number[][] = openList.map(() => []);
  const taskStart: number[][] = openList.map(() => []);
  const taskEnd: number[][] = openList.map(() => []);
  const totalEffortRuns: number[] = [];
  const milestoneIds = [...new Set(openList.map((o) => o.task.milestoneId).filter((m): m is number => m !== null))];
  const milestoneRuns = new Map<number, number[]>(milestoneIds.map((m) => [m, []]));
  for (let r = 0; r < effectiveRuns; r++) {
    const approvedAt: number[] = new Array(openList.length).fill(NaN);
    const free = new Map<string, number>();
    const effort = new Array(list.length).fill(0);
    const idle = new Array(list.length).fill(0);
    const heldBy: Map<number, number>[] = list.map(() => new Map());
    // Draw every task's working time and review wait first, in a fixed order, so a what-if (less
    // time for someone) changes only what it should: the same draws, scheduled differently.
    // Each run also redraws each person's pace a little: with few finished tasks the pace itself is
    // uncertain, and that uncertainty affects all of their tasks together.
    const paceShift = list.map((p) => {
      const pc = (p.userId ? pace.byPerson.get(p.name) : undefined) ?? pace.overall;
      return (pc.sigma / Math.sqrt(pc.n + SHRINK)) * normal(rand);
    });
    const workOf = openList.map((o) => {
      const p = list[o.person];
      const pc = (p.userId ? pace.byPerson.get(p.name) : undefined) ?? pace.overall;
      const est = estimates[o.task.id] ?? o.task.estimateDays;
      const base = est && est > 0 ? est : typical;
      const work = base * Math.exp(pc.mu + paceShift[o.person] + pc.sigma * normal(rand)); // working days
      return o.status === 'IN_PROGRESS' && o.block.startedDay !== null ? Math.max(0.25 * base, work - (today - o.block.startedDay) * WORKING) : work;
    });
    const waitOf = openList.map(() => lag * Math.exp(0.4 * normal(rand)));
    totalEffortRuns.push(workOf.reduce((a, w, i) => a + (openList[i].status === 'IN_REVIEW' ? 0 : w), 0));
    const remaining = new Set<number>();
    const holdOf = (i: number) => {
      const h = holds[openList[i].task.id];
      return h !== undefined && Number.isFinite(h) && h > 0 ? today + h : -Infinity;
    };
    openList.forEach((o, i) => {
      if (approveNow.includes(o.task.id)) approvedAt[i] = today; // what-if: decided today
      else if (o.status === 'IN_REVIEW') approvedAt[i] = Math.max(today + waitOf[i], holdOf(i)); // only the review is left
      else remaining.add(i);
    });
    while (remaining.size) {
      // The task that can start soonest; ties go to the person's own order (in progress, due date, priority).
      let best = -1;
      let bestStart = Infinity;
      let bestReady = 0;
      for (const i of remaining) {
        const o = openList[i];
        let ready = today;
        let known = true;
        for (const pi of o.preds) {
          if (Number.isNaN(approvedAt[pi])) {
            known = false;
            break;
          }
          ready = Math.max(ready, approvedAt[pi]);
        }
        if (!known) continue;
        const start = Math.max(free.get(o.lane) ?? today, ready);
        if (start < bestStart - 1e-9 || (Math.abs(start - bestStart) <= 1e-9 && best >= 0 && byRank(o, openList[best]) < 0)) {
          best = i;
          bestStart = start;
          bestReady = ready;
        }
      }
      if (best < 0) {
        // A dependency loop: ignore the dependencies of the first task in order, so the run can finish.
        best = [...remaining].sort((a, b) => byRank(openList[a], openList[b]))[0];
        openList[best].preds = [];
        continue;
      }
      const o = openList[best];
      const p = list[o.person];
      const work = workOf[best];
      const freeAt = free.get(o.lane) ?? today;
      if (p.userId !== null) {
        effort[o.person] += work;
        if (bestReady > freeAt + 1e-9) {
          // Nothing else of theirs could start: they wait for the latest thing this task depends on.
          const waitDays = (bestReady - freeAt) * WORKING;
          idle[o.person] += waitDays;
          const culprit = o.preds.reduce((m, pi) => (approvedAt[pi] > approvedAt[m] ? pi : m), o.preds[0]);
          // Waiting on the review of their own work isn't a dependency on someone else.
          if (openList[culprit].person !== o.person) heldBy[o.person].set(culprit, (heldBy[o.person].get(culprit) ?? 0) + waitDays);
        }
      }
      const end = bestStart + work / WORKING / shareOf(p.userId);
      free.set(o.lane, end);
      taskStart[best].push(o.status === 'IN_PROGRESS' ? Math.max(today, bestStart) : bestStart);
      taskEnd[best].push(end);
      approvedAt[best] = Math.max(end + waitOf[best], holdOf(best));
      remaining.delete(best);
    }
    approvedAt.forEach((d, i) => taskApproved[i].push(d));
    for (const m of milestoneIds) {
      let last = today;
      openList.forEach((o, i) => {
        if (o.task.milestoneId === m) last = Math.max(last, approvedAt[i]);
      });
      milestoneRuns.get(m)!.push(last);
    }
    list.forEach((_, pi) => {
      const mine = openList.map((o, i) => (o.person === pi ? approvedAt[i] : NaN)).filter((d) => !Number.isNaN(d));
      finishTimes[pi].push(mine.sort((a, b) => a - b));
      effortRuns[pi].push(effort[pi]);
      waitRuns[pi].push(idle[pi]);
      for (const [ti, days] of heldBy[pi]) {
        const cur = blame[pi].get(ti) ?? { runs: 0, days: 0 };
        blame[pi].set(ti, { runs: cur.runs + 1, days: cur.days + days });
      }
    });
  }
  runs = effectiveRuns;

  // Horizon: the cautious finish of the slowest person, at least a week past today, within a year.
  const lastFinishes = finishTimes.flatMap((runsOf) => runsOf.map((d) => (d.length ? d[d.length - 1] : today)));
  const cautious = lastFinishes.length ? quantile([...lastFinishes].sort((a, b) => a - b), 0.9) : today;
  const horizon = Math.ceil(Math.min(today + MAX_HORIZON_DAYS, Math.max(today + 7, cautious + 2, deadline !== null ? deadline + 2 : 0)));

  const countBy = (sorted: number[], day: number) => {
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid] <= day) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };

  const mainDependencyOf = (pi: number): PersonForecast['mainDependency'] => {
    let best: PersonForecast['mainDependency'] = null;
    for (const [ti, v] of blame[pi]) {
      const share = v.runs / runs;
      if (share < 0.25) continue;
      const days = v.days / runs;
      if (!best || days > best.days) {
        const o = openList[ti];
        best = { taskId: o.block.id, key: o.task.key, owner: o.task.assignee?.name ?? null, share, days };
      }
    }
    return best;
  };

  const out: PersonForecast[] = list.map((p, pi) => {
    const approved = p.tasks.filter((x) => isDone(x.block)).length;
    const open = p.tasks.length - approved;
    const history: number[] = [];
    for (let d = 0; d <= todayWhole; d++) history.push(p.tasks.filter((x) => statusAt(x.block, Math.min(d + 0.999, today)) === 'DONE').length);
    const runsOf = finishTimes[pi];
    // Unowned work is simulated too (as if someone started it today), and flagged as such.
    const predictable = open > 0;
    const forecast: PersonForecast['forecast'] = [];
    for (let d = todayWhole; d <= horizon; d++) {
      if (!predictable) {
        forecast.push({ day: d, p10: approved, p50: approved, p90: approved });
        continue;
      }
      const counts = runsOf.map((done) => approved + countBy(done, d + 1)).sort((a, b) => a - b);
      // More approved = better, so the optimistic p10 is the high count.
      forecast.push({ day: d, p10: quantile(counts, 0.9), p50: quantile(counts, 0.5), p90: quantile(counts, 0.1) });
    }
    const ends = predictable ? runsOf.map((done) => done[done.length - 1]) : [];
    const pc = (p.userId ? pace.byPerson.get(p.name) : undefined) ?? pace.overall;
    return {
      name: p.name,
      userId: p.userId,
      role: p.role,
      total: p.tasks.length,
      approved,
      open,
      history,
      forecast,
      finish: predictable ? rangeOf(ends) : null,
      pDeadline: predictable && deadline !== null ? ends.filter((e) => e <= deadline + 1).length / ends.length : null,
      pace: { ratio: Math.exp(pc.mu), n: pace.byPerson.get(p.name)?.n ?? 0, spread: pc.sigma },
      unpredictable: !p.userId && open > 0,
      effort: predictable && p.userId ? rangeOf(effortRuns[pi]) : null,
      unestimated: p.tasks.filter((x) => !isDone(x.block) && !(x.task.estimateDays && x.task.estimateDays > 0)).length,
      waitingDays: waitRuns[pi].length ? waitRuns[pi].reduce((a, v) => a + v, 0) / waitRuns[pi].length : 0,
      mainDependency: mainDependencyOf(pi),
    };
  });

  // Groups: a group is finished when its slowest person is, run by run.
  const group = (key: GroupForecast['key'], label: string, members: number[]): GroupForecast => {
    const ppl = members.map((i) => out[i]);
    const predictable = members.filter((i) => out[i].finish);
    let finish: Range | null = null;
    let pDeadline: number | null = null;
    if (predictable.length) {
      const ends = Array.from({ length: runs }, (_, r) => Math.max(...predictable.map((i) => finishTimes[i][r][finishTimes[i][r].length - 1] ?? today)));
      finish = rangeOf(ends);
      pDeadline = deadline !== null ? ends.filter((e) => e <= deadline + 1).length / runs : null;
    }
    return {
      key,
      label,
      people: ppl.filter((p) => p.userId !== null).length,
      total: ppl.reduce((a, p) => a + p.total, 0),
      approved: ppl.reduce((a, p) => a + p.approved, 0),
      open: ppl.reduce((a, p) => a + p.open, 0),
      finish,
      pDeadline,
    };
  };
  const roles: GroupForecast[] = [];
  for (const role of ROLE_ORDER) {
    const idx = out.map((p, i) => (p.role === role ? i : -1)).filter((i) => i >= 0);
    if (!idx.length) continue;
    const key = role ?? 'NONE';
    roles.push(group(key, ROLE_GROUP_LABEL[key], idx));
  }
  const unassignedOpen = out.filter((p) => p.unpredictable).reduce((a, p) => a + p.open, 0);
  const sortedPeople = out
    .map((p, i) => ({ p, i }))
    .sort((a, b) => ROLE_ORDER.indexOf(a.p.role) - ROLE_ORDER.indexOf(b.p.role) || a.p.name.localeCompare(b.p.name));
  // The whole project, run by run: approved now, plus open tasks approved by each day.
  const approvedNow = out.reduce((a, p) => a + p.approved, 0);
  const projectHistory: number[] = [];
  for (let d = 0; d <= todayWhole; d++) projectHistory.push(out.reduce((a, p) => a + (p.history[d] ?? 0), 0));
  const runSorted = Array.from({ length: runs }, (_, r) => taskApproved.map((days) => days[r]).sort((a, b) => a - b));
  const projectSeries: ProgressForecast['projectSeries'] = [];
  for (let d = todayWhole; d <= horizon; d++) {
    const counts = runSorted.map((done) => approvedNow + countBy(done, d + 1)).sort((a, b) => a - b);
    projectSeries.push({ day: d, p10: quantile(counts, 0.9), p50: quantile(counts, 0.5), p90: quantile(counts, 0.1) });
  }

  return {
    startDay,
    todayDay: today,
    horizon,
    deadlineDay: deadline,
    people: sortedPeople.map((x) => x.p),
    roles,
    project: group('ALL', 'Everyone', out.map((_, i) => i)),
    runs,
    reviewLag: lag,
    learnedFrom: pace.overall.n,
    paceRatio: Math.exp(pace.overall.mu),
    unassignedOpen,
    unownedKeys: openList.filter((o) => !list[o.person].userId).map((o) => o.task.key),
    unestimatedOpen: openList.filter((o) => !(o.task.estimateDays && o.task.estimateDays > 0)).length,
    typicalEstimate: typical,
    shares: Object.fromEntries(Object.keys(shares).map((k) => [k, shareOf(Number(k))])),
    tasks: Object.fromEntries(openList.map((o, i) => [o.block.id, rangeOf(taskApproved[i])])),
    schedule: Object.fromEntries(
      openList.flatMap((o, i) => (taskStart[i].length ? [[o.block.id, { start: rangeOf(taskStart[i]).p50, end: rangeOf(taskEnd[i]).p50 }] as const] : [])),
    ),
    effort: openList.length ? rangeOf(totalEffortRuns) : null,
    milestones: Object.fromEntries([...milestoneRuns].map(([m, v]) => [m, rangeOf(v)])),
    projectHistory,
    projectSeries,
    totalTasks: tasks.length,
  };
}

// ------------------------------------------------------------------ how good are the ranges?

export interface RangeCheck {
  /** Finished tasks it could check (with an estimate, a start and an approval). */
  n: number;
  /** How many took a time inside the 80% range predicted for them. */
  inside: number;
  /** inside ÷ n, or null when there are too few to say (under 5). */
  coverage: number | null;
  /** Median of |actual − typical prediction|, in working days, or null with too few. */
  medianErrorDays: number | null;
}

const Z80 = 1.2816;

/**
 * Checks the ranges the forecast is built from against what actually happened: each finished
 * task's working time is predicted from every *other* finished task (leave one out), exactly as an
 * open task would be, and we count how often the actual time fell inside the predicted 80% range.
 * About 80% means the ranges are honest; much less means they're too narrow.
 */
export function checkRanges(tasks: readonly Task[], model: ProjectModel): RangeCheck {
  const blocks = new Map(model.blocks.map((b) => [b.id, b]));
  const checkable = tasks
    .filter((t) => {
      const b = blocks.get(t.id);
      return t.status === 'DONE' && !!t.estimateDays && t.estimateDays > 0 && !!b && b.startedDay !== null && b.doneDay !== null;
    })
    .slice(-200);
  let inside = 0;
  const errors: number[] = [];
  for (const t of checkable) {
    const others = checkable.filter((x) => x.id !== t.id);
    const pace = learnPaceSpread(others, blocks);
    const pc = pace.byPerson.get(t.assignee?.name ?? 'Unassigned') ?? pace.overall;
    const est = t.estimateDays!;
    const actual = workDays(blocks.get(t.id)!, blocks);
    const lo = est * Math.exp(pc.mu - Z80 * pc.sigma);
    const hi = est * Math.exp(pc.mu + Z80 * pc.sigma);
    if (actual >= lo && actual <= hi) inside++;
    errors.push(Math.abs(actual - est * Math.exp(pc.mu)));
  }
  const n = checkable.length;
  return { n, inside, coverage: n >= 5 ? inside / n : null, medianErrorDays: n >= 5 ? median(errors, 0) : null };
}

/** How much history the forecast has to learn from, in words for the page. */
export function dataQuality(learnedFrom: number): { level: 'none' | 'limited' | 'fair'; label: string } {
  if (learnedFrom === 0) return { level: 'none', label: 'No history yet: every task is assumed to take its estimate, so treat the dates as rough.' };
  if (learnedFrom < 8) return { level: 'limited', label: `Limited history: learned from ${learnedFrom} finished ${learnedFrom === 1 ? 'task' : 'tasks'} with estimates, so the ranges are wide.` };
  return { level: 'fair', label: `Learned from ${learnedFrom} finished tasks with estimates.` };
}
