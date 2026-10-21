import type { Task } from '@/api/types';

const DAY_MS = 86_400_000;

export interface CycleStats {
  /** Approved tasks with a recorded start: what the numbers are measured from. */
  n: number;
  /** Median days from first start to approval. */
  median: number | null;
  /** The middle half: 25th and 75th percentiles, in days. */
  p25: number | null;
  p75: number | null;
  min: number | null;
  max: number | null;
  /** Every measurement, in days (for a distribution strip). */
  values: number[];
}

function q(sorted: number[], p: number): number {
  const pos = (sorted.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

const round1 = (x: number) => Math.round(x * 10) / 10;

/**
 * Cycle time with its sample size and spread, not a lone average: the median, the middle half and
 * the extremes of first start → approval, in calendar days, over approved tasks that have a
 * recorded start. With fewer than 3 there's nothing to summarise.
 */
export function cycleStats(tasks: readonly Pick<Task, 'status' | 'startedAt' | 'completedAt'>[]): CycleStats {
  const values = tasks
    .filter((t) => t.status === 'DONE' && t.startedAt && t.completedAt)
    .map((t) => Math.max(0, (Date.parse(t.completedAt!) - Date.parse(t.startedAt!)) / DAY_MS))
    .filter((d) => Number.isFinite(d))
    .sort((a, b) => a - b);
  const n = values.length;
  if (n < 3) return { n, median: null, p25: null, p75: null, min: null, max: null, values: values.map(round1) };
  return { n, median: round1(q(values, 0.5)), p25: round1(q(values, 0.25)), p75: round1(q(values, 0.75)), min: round1(values[0]), max: round1(values[n - 1]), values: values.map(round1) };
}

export interface ProgressMeasures {
  tasksDone: number;
  tasksTotal: number;
  /** Share of *estimated work* approved, only when enough tasks have estimates to mean something. */
  effortShare: number | null;
  /** Share of tasks with an estimate (0–1). */
  estimated: number;
}

/** At least this share of tasks must have an estimate before an effort-weighted progress is shown. */
export const EFFORT_COVERAGE = 0.7;

/**
 * Two different progress numbers, never mixed up: tasks approved (a count: a small task and a
 * big one count the same), and estimated work approved (weighted by estimates), shown only when
 * most tasks have estimates.
 */
export function progressMeasures(tasks: readonly Pick<Task, 'status' | 'estimateDays'>[]): ProgressMeasures {
  const total = tasks.length;
  const done = tasks.filter((t) => t.status === 'DONE').length;
  const withEstimate = tasks.filter((t) => t.estimateDays && t.estimateDays > 0);
  const estimated = total ? withEstimate.length / total : 0;
  let effortShare: number | null = null;
  if (total && estimated >= EFFORT_COVERAGE) {
    const sum = withEstimate.reduce((a, t) => a + t.estimateDays!, 0);
    const doneSum = withEstimate.filter((t) => t.status === 'DONE').reduce((a, t) => a + t.estimateDays!, 0);
    effortShare = sum ? doneSum / sum : null;
  }
  return { tasksDone: done, tasksTotal: total, effortShare, estimated };
}
