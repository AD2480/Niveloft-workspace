import type { Priority, Task } from '@/api/types';
import type { ModelBlock, ProjectModel } from '@/three/projectModel';

/**
 * Niveloft's built-in model: small machine-learning models trained, in the browser, on one
 * project's own records. No AI service and no API key are involved, and nothing leaves the page.
 *
 * - Pace: how long each person's tasks really take compared with their estimates (a shrunk
 *   average of log ratios, so one odd task can't dominate; people with few finished tasks lean
 *   on the project's average).
 * - Lateness risk: a logistic regression that learns which task features went with finishing
 *   after the due date, from finished tasks (and ones already overdue). Its accuracy is measured
 *   on tasks it didn't train on (leave-one-out) and always reported with the answer.
 * - Search: TF-IDF over task titles, descriptions, criteria, keys and people, to find the
 *   records behind a free question.
 *
 * It answers from the records only; it can't reason like a chat model and says so.
 */

const PRIORITY_RANK: Record<Priority, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, URGENT: 3 };
/** Calendar days → working days (Mon–Fri), roughly. */
const WORKING = 5 / 7;
/** How strongly a person's pace is pulled towards the project average (in "virtual tasks"). */
const SHRINK = 2;

export interface Pace {
  /** Actual time ÷ estimate (1 = on estimate, 1.5 = half again as long). */
  ratio: number;
  /** Finished, estimated tasks it's based on. */
  n: number;
}

export interface RiskModel {
  weights: number[];
  means: number[];
  stds: number[];
  /** Tasks trained on, and how many of them were late. */
  n: number;
  positives: number;
  /** Share of held-out tasks predicted correctly (leave-one-out), or null when too few. */
  accuracy: number | null;
}

export interface Learned {
  pace: { overall: Pace; byPerson: Map<string, Pace> };
  risk: RiskModel | null;
  /** Finished tasks the model learned from. */
  finished: number;
  index: SearchIndex;
}

export const FEATURE_NAMES = ['its size (estimate)', 'its priority', 'the tasks it waits on', 'little time between start and due date', 'the assignee’s usual pace', 'being sent back for changes'];

// ------------------------------------------------------------------ helpers

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

function sentBack(b: ModelBlock): number {
  let n = 0;
  for (let i = 1; i < b.segments.length; i++) if (b.segments[i - 1].status === 'IN_REVIEW' && b.segments[i].status !== 'DONE') n++;
  return n;
}

function median(values: number[], fallback: number): number {
  if (!values.length) return fallback;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// ------------------------------------------------------------------ pace

export function learnPace(tasks: readonly Task[], blocks: readonly ModelBlock[]): { overall: Pace; byPerson: Map<string, Pace> } {
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const logs: { person: string; log: number }[] = [];
  for (const t of tasks) {
    const b = byId.get(t.id);
    if (!b || t.status !== 'DONE' || b.startedDay === null || b.doneDay === null || !t.estimateDays || t.estimateDays <= 0) continue;
    const actual = Math.max(0.25, (b.doneDay - b.startedDay) * WORKING);
    logs.push({ person: t.assignee?.name ?? 'Unassigned', log: Math.log(clamp(actual / t.estimateDays, 0.2, 5)) });
  }
  const mean = logs.length ? logs.reduce((a, l) => a + l.log, 0) / logs.length : 0;
  const byPerson = new Map<string, Pace>();
  const groups = new Map<string, number[]>();
  for (const l of logs) groups.set(l.person, [...(groups.get(l.person) ?? []), l.log]);
  for (const [person, ls] of groups) {
    const shrunk = (ls.reduce((a, v) => a + v, 0) + SHRINK * mean) / (ls.length + SHRINK);
    byPerson.set(person, { ratio: Math.exp(shrunk), n: ls.length });
  }
  return { overall: { ratio: Math.exp(mean), n: logs.length }, byPerson };
}

export function paceOf(learned: Pick<Learned, 'pace'>, person: string | null | undefined): Pace {
  return (person && learned.pace.byPerson.get(person)) || { ratio: learned.pace.overall.ratio, n: 0 };
}

// ------------------------------------------------------------------ lateness risk

/** The features the risk model looks at, for any task (raw, before standardising). */
export function riskFeatures(t: Task, b: ModelBlock, pace: Pace, typicalEstimate: number): number[] {
  const estimate = t.estimateDays && t.estimateDays > 0 ? t.estimateDays : typicalEstimate;
  const start = b.startedDay ?? b.createdDay;
  const slack = b.dueDay === null ? 3 : clamp((b.dueDay - start) / (estimate / WORKING), 0, 5);
  return [Math.log1p(estimate), PRIORITY_RANK[t.priority], b.blockedBy.length, -slack, Math.log(pace.ratio), sentBack(b)];
}

interface Row {
  x: number[];
  y: number;
}

function standardise(rows: Row[]): { means: number[]; stds: number[] } {
  const k = rows[0].x.length;
  const means = Array.from({ length: k }, (_, i) => rows.reduce((a, r) => a + r.x[i], 0) / rows.length);
  const stds = means.map((m, i) => Math.sqrt(rows.reduce((a, r) => a + (r.x[i] - m) ** 2, 0) / rows.length) || 1);
  return { means, stds };
}

/** L2-regularised logistic regression by gradient descent (small data, strong prior towards "no effect"). */
function fit(rows: Row[], means: number[], stds: number[], lambda = 1, iterations = 600, rate = 0.15): number[] {
  const k = means.length;
  const w = new Array(k + 1).fill(0);
  const z = rows.map((r) => [1, ...r.x.map((v, i) => (v - means[i]) / stds[i])]);
  for (let it = 0; it < iterations; it++) {
    const grad = new Array(k + 1).fill(0);
    for (let n = 0; n < rows.length; n++) {
      const p = sigmoid(w.reduce((a, wi, i) => a + wi * z[n][i], 0));
      for (let i = 0; i <= k; i++) grad[i] += (p - rows[n].y) * z[n][i];
    }
    for (let i = 0; i <= k; i++) w[i] -= rate * (grad[i] / rows.length + (i === 0 ? 0 : (lambda * w[i]) / rows.length));
  }
  return w;
}

function score(w: number[], x: number[], means: number[], stds: number[]): number {
  return sigmoid(w[0] + x.reduce((a, v, i) => a + w[i + 1] * ((v - means[i]) / stds[i]), 0));
}

export function trainRisk(rows: Row[]): RiskModel | null {
  const positives = rows.filter((r) => r.y === 1).length;
  // Nothing to learn from without enough examples of both outcomes.
  if (rows.length < 6 || positives === 0 || positives === rows.length) return null;
  const { means, stds } = standardise(rows);
  const weights = fit(rows, means, stds);
  let accuracy: number | null = null;
  if (rows.length >= 8) {
    let right = 0;
    for (let i = 0; i < rows.length; i++) {
      const rest = rows.filter((_, j) => j !== i);
      const s = standardise(rest);
      const w = fit(rest, s.means, s.stds);
      if ((score(w, rows[i].x, s.means, s.stds) >= 0.5 ? 1 : 0) === rows[i].y) right++;
    }
    accuracy = right / rows.length;
  }
  return { weights, means, stds, n: rows.length, positives, accuracy };
}

// ------------------------------------------------------------------ search (TF-IDF)

const STOP = new Set(
  'a an and are as at be by can do does for from has have how i in is it its me my of on or our so that the their them there this to up us was we what when where which who why will with you your about into than then there these those task tasks project'.split(
    ' ',
  ),
);

export function tokens(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+(?:-[0-9]+)?/g) ?? []).filter((w) => w.length > 1 && !STOP.has(w));
}

export interface SearchIndex {
  docs: { id: number; vec: Map<string, number>; norm: number; text: string }[];
  idf: Map<string, number>;
}

export function buildIndex(tasks: readonly Task[]): SearchIndex {
  const raw = tasks.map((t) => {
    const text = [t.key, t.title, t.title, t.description ?? '', ...t.acceptanceCriteria.map((c) => c.text), t.assignee?.name ?? '', t.milestoneName ?? ''].join(' ');
    return { id: t.id, words: tokens(text), text: [t.title, t.description ?? ''].join(' — ') };
  });
  const df = new Map<string, number>();
  for (const d of raw) for (const w of new Set(d.words)) df.set(w, (df.get(w) ?? 0) + 1);
  const idf = new Map<string, number>();
  for (const [w, n] of df) idf.set(w, Math.log((raw.length + 1) / (n + 1)) + 1);
  const docs = raw.map((d) => {
    const tf = new Map<string, number>();
    for (const w of d.words) tf.set(w, (tf.get(w) ?? 0) + 1);
    const vec = new Map<string, number>();
    for (const [w, n] of tf) vec.set(w, n * (idf.get(w) ?? 0));
    const norm = Math.sqrt([...vec.values()].reduce((a, v) => a + v * v, 0)) || 1;
    return { id: d.id, vec, norm, text: d.text };
  });
  return { docs, idf };
}

export function search(index: SearchIndex, query: string, k = 5): { id: number; score: number }[] {
  const q = new Map<string, number>();
  for (const w of tokens(query)) q.set(w, (q.get(w) ?? 0) + (index.idf.get(w) ?? 0));
  const qn = Math.sqrt([...q.values()].reduce((a, v) => a + v * v, 0));
  if (!qn) return [];
  return index.docs
    .map((d) => {
      let dot = 0;
      for (const [w, v] of q) dot += v * (d.vec.get(w) ?? 0);
      return { id: d.id, score: dot / (qn * d.norm) };
    })
    .filter((r) => r.score > 0.08)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

// ------------------------------------------------------------------ training and prediction

export function learn(tasks: readonly Task[], model: ProjectModel): Learned {
  const blocks = new Map(model.blocks.map((b) => [b.id, b]));
  const pace = learnPace(tasks, model.blocks);
  const typical = median(tasks.map((t) => t.estimateDays ?? 0).filter((e) => e > 0), 2);
  const rows: Row[] = [];
  for (const t of tasks) {
    const b = blocks.get(t.id);
    if (!b || b.dueDay === null) continue;
    let y: number | null = null;
    if (t.status === 'DONE' && b.doneDay !== null) y = b.doneDay > b.dueDay + 0.5 ? 1 : 0;
    else if (t.status !== 'DONE' && model.todayDay > b.dueDay + 0.5) y = 1; // already overdue: the outcome is known
    if (y === null) continue;
    rows.push({ x: riskFeatures(t, b, paceOf({ pace }, t.assignee?.name), typical), y });
  }
  return { pace, risk: trainRisk(rows), finished: tasks.filter((t) => t.status === 'DONE').length, index: buildIndex(tasks) };
}

export interface TaskPrediction {
  /** Estimated day (model days) the task finishes, from the person's learned pace. */
  finishDay: number | null;
  /** Probability it finishes after its due date, or null without a risk model or due date. */
  pLate: number | null;
  /** What pushes the risk up (+) or down (−), strongest first. */
  factors: { name: string; effect: number }[];
  pace: Pace;
}

export function predict(learned: Learned, task: Task, block: ModelBlock, todayDay: number, typicalEstimate = 2): TaskPrediction {
  const pace = paceOf(learned, task.assignee?.name);
  let finishDay: number | null = null;
  if (task.status !== 'DONE') {
    const estimate = task.estimateDays && task.estimateDays > 0 ? task.estimateDays : typicalEstimate;
    const elapsed = block.startedDay === null ? 0 : Math.max(0, (todayDay - block.startedDay) * WORKING);
    const remaining = Math.max(0.5, estimate * pace.ratio - elapsed);
    finishDay = Math.max(todayDay, block.startedDay ?? todayDay) + remaining / WORKING;
  }
  if (!learned.risk || block.dueDay === null || task.status === 'DONE') return { finishDay, pLate: null, factors: [], pace };
  const x = riskFeatures(task, block, pace, typicalEstimate);
  const { weights, means, stds } = learned.risk;
  const pLate = score(weights, x, means, stds);
  const factors = x
    .map((v, i) => ({ name: FEATURE_NAMES[i], effect: weights[i + 1] * ((v - means[i]) / stds[i]) }))
    .filter((f) => Math.abs(f.effect) > 0.15)
    .sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect))
    .slice(0, 3);
  return { finishDay, pLate, factors, pace };
}

/** One line on what the model learned from and how well it did, for every answer. */
export function basis(learned: Learned): string {
  const parts = [`Learned from ${learned.finished} finished ${learned.finished === 1 ? 'task' : 'tasks'} in this project`];
  if (learned.pace.overall.n) parts.push(`pace from ${learned.pace.overall.n} with estimates`);
  if (learned.risk) {
    parts.push(
      learned.risk.accuracy === null
        ? `lateness from ${learned.risk.n} tasks (too few to measure its accuracy)`
        : `lateness from ${learned.risk.n} tasks, right about ${Math.round(learned.risk.accuracy * 100)}% of the time on tasks it didn’t see`,
    );
  } else parts.push('not enough finished tasks with due dates yet to learn lateness');
  return `${parts.join('; ')}.`;
}
