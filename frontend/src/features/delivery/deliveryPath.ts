/**
 * The delivery outlook's facts, worked out from the records (no AI, no randomness): what holds a
 * milestone up, the sentence Flurry says about it, which milestone is most at risk, and where
 * things sit on the shared time scale both views use. Pure, so it's tested on its own.
 *
 * "What holds a milestone up" follows the dependencies: among the milestone's open work and the
 * open work it waits on (from anywhere in the project), the blocker is the task that holds the
 * milestone's work up and isn't itself waiting on anything. A review waiting for a decision comes
 * first (it's the quickest thing to move), then late work, then work in progress, then work not
 * started; then whichever holds up more. When nothing in the milestone waits on anything, it's the
 * open task likely to be approved last.
 */
import type { Dependency, Milestone, Task } from '@/api/types';
import { STATUS_LABEL } from '@/lib/constants';
import { parseLocalDate } from '@/lib/dates';

export type BlockerKind = 'review' | 'late' | 'in-progress' | 'not-started' | 'last';

export interface MilestoneBlocker {
  task: Task;
  kind: BlockerKind;
  /** Open tasks it holds up (directly or through other tasks): the milestone's own first, in key order. */
  holdsUp: Task[];
  /** How many of those belong to the milestone. */
  heldInMilestone: number;
  /** Days past its due date (0 when it isn't late). */
  lateDays: number;
  /** Whether it belongs to the milestone (or is work elsewhere the milestone waits on). */
  inMilestone: boolean;
  /** A short heading: "ONB-9 · In progress · 2 days late". */
  title: string;
  /** What Flurry says, one sentence and a question: "This review is holding up ONB-10. Open it?" */
  sentence: string;
}

const KIND_ORDER: Record<Exclude<BlockerKind, 'last'>, number> = { review: 0, late: 1, 'in-progress': 2, 'not-started': 3 };

const keyNumber = (key: string) => Number(/(\d+)$/.exec(key)?.[1] ?? 0);
const byKey = (a: Task, b: Task) => a.key.localeCompare(b.key, undefined, { numeric: true }) || keyNumber(a.key) - keyNumber(b.key);

/** Whole days `due` is before `today` (0 when it isn't past). */
export function daysLate(due: string | null, today: string): number {
  if (!due || due >= today) return 0;
  return Math.round((parseLocalDate(today).getTime() - parseLocalDate(due).getTime()) / 86_400_000);
}

const isOpen = (t: Task) => t.status !== 'DONE';

/** Successors and predecessors among open tasks only (approved work holds nothing up). */
function openGraph(tasks: readonly Task[], deps: readonly Dependency[]) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const next = new Map<number, number[]>();
  const prev = new Map<number, number[]>();
  for (const d of deps) {
    const a = byId.get(d.blocker.id);
    const b = byId.get(d.blocked.id);
    if (!a || !b || !isOpen(a) || !isOpen(b)) continue;
    next.set(a.id, [...(next.get(a.id) ?? []), b.id]);
    prev.set(b.id, [...(prev.get(b.id) ?? []), a.id]);
  }
  const walk = (start: number, edges: Map<number, number[]>) => {
    const seen = new Set<number>();
    const queue = [...(edges.get(start) ?? [])];
    while (queue.length) {
      const id = queue.shift()!;
      if (seen.has(id) || id === start) continue;
      seen.add(id);
      queue.push(...(edges.get(id) ?? []));
    }
    return seen;
  };
  return { byId, prev, downstream: (id: number) => walk(id, next), upstream: (id: number) => walk(id, prev) };
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

function kindOf(t: Task, late: number): Exclude<BlockerKind, 'last'> {
  if (t.status === 'IN_REVIEW') return 'review';
  if (late > 0) return 'late';
  return t.status === 'IN_PROGRESS' ? 'in-progress' : 'not-started';
}

export function blockerTitle(t: Task, late: number): string {
  return `${t.key}, ${STATUS_LABEL[t.status].toLowerCase()}${late > 0 ? `, ${late} ${plural(late, 'day', 'days')} late` : ''}`;
}

/**
 * What holds a milestone up, or null when its work is all approved (or it has none). `likely`
 * gives a task's likely approval date in words ("24 Oct"), for the "last to finish" sentence.
 */
export function milestoneBlocker(
  milestone: Pick<Milestone, 'id' | 'name'>,
  tasks: readonly Task[],
  deps: readonly Dependency[],
  opts: { today: string; likely?: (taskId: number) => string | null; likelyDay?: (taskId: number) => number | null },
): MilestoneBlocker | null {
  const own = tasks.filter((t) => t.milestoneId === milestone.id && isOpen(t));
  if (!own.length) return null;
  const g = openGraph(tasks, deps);
  const ownIds = new Set(own.map((t) => t.id));
  const candidates = new Set<number>(ownIds);
  for (const t of own) for (const id of g.upstream(t.id)) candidates.add(id);

  const scored = [...candidates]
    .map((id) => {
      const t = g.byId.get(id)!;
      const held = [...g.downstream(id)].map((x) => g.byId.get(x)!).sort(byKey);
      const heldInM = held.filter((x) => ownIds.has(x.id));
      const late = daysLate(t.dueDate, opts.today);
      const root = !(g.prev.get(id) ?? []).length;
      return { t, held: [...heldInM, ...held.filter((x) => !ownIds.has(x.id))], heldInM: heldInM.length, late, root, kind: kindOf(t, late) };
    })
    .filter((x) => x.heldInM > 0)
    .sort((a, b) => Number(b.root) - Number(a.root) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || b.heldInM - a.heldInM || b.late - a.late || byKey(a.t, b.t));

  const best = scored[0];
  if (best) {
    const { t, held, heldInM, late, kind } = best;
    const first = held[0].key;
    const more = heldInM > 1 ? ` and ${heldInM - 1} more` : '';
    const sentence =
      kind === 'review'
        ? `This review is holding up ${first}${more}. Open it?`
        : kind === 'late'
          ? `${t.key} is ${late} ${plural(late, 'day', 'days')} late and holding up ${first}${more}. Open it?`
          : kind === 'in-progress'
            ? `${t.key} is still in progress and holding up ${first}${more}. Open it?`
            : `${t.key} hasn’t started, and ${first}${more} ${heldInM > 1 ? 'wait' : 'waits'} on it. Open it?`;
    return { task: t, kind, holdsUp: held, heldInMilestone: heldInM, lateDays: late, inMilestone: ownIds.has(t.id), title: blockerTitle(t, late), sentence };
  }

  // Nothing in the milestone waits on anything: the open task likely to be approved last.
  const day = (t: Task) => opts.likelyDay?.(t.id) ?? (t.dueDate ? parseLocalDate(t.dueDate).getTime() / 86_400_000 : Infinity);
  const last = [...own].sort((a, b) => day(b) - day(a) || byKey(b, a))[0];
  const late = daysLate(last.dueDate, opts.today);
  const when = opts.likely?.(last.id);
  const sentence =
    last.status === 'IN_REVIEW'
      ? `Nothing in ${milestone.name} waits on other work. This review is the last thing open. Open it?`
      : `Nothing in ${milestone.name} waits on other work. ${last.key} is likely the last to be approved${when ? `, around ${when}` : ''}. Open it?`;
  return { task: last, kind: 'last', holdsUp: [], heldInMilestone: 0, lateDays: late, inMilestone: true, title: blockerTitle(last, late), sentence };
}

/**
 * The milestone most worth looking at first: the open one whose likely finish is furthest past its
 * due date (or, without forecasts, the next one due). Null when every milestone is complete.
 */
export function milestoneAtRisk<M extends Pick<Milestone, 'id' | 'dueDate' | 'completed'>>(milestones: readonly M[], likelyDay: (id: number) => number | null, dueDay: (iso: string) => number): M | null {
  const open = milestones.filter((m) => !m.completed);
  if (!open.length) return null;
  return [...open].sort((a, b) => {
    const sa = (likelyDay(a.id) ?? dueDay(a.dueDate)) - dueDay(a.dueDate);
    const sb = (likelyDay(b.id) ?? dueDay(b.dueDate)) - dueDay(b.dueDate);
    return sb - sa || a.dueDate.localeCompare(b.dueDate);
  })[0];
}

// ------------------------------------------------------------------------------------------ the shared scale

/** One time scale for both views: model day → x in pixels, inside `[pad, width - pad]`. */
export function timeScale(from: number, to: number, width: number, pad = 40): { x: (day: number) => number; day: (x: number) => number } {
  const span = Math.max(1, to - from);
  const w = Math.max(1, width - pad * 2);
  return { x: (d: number) => pad + ((d - from) / span) * w, day: (x: number) => from + ((x - pad) / w) * span };
}

/**
 * The route the Path view draws: a gentle meander across the width, the same every time for the
 * same width. Its height means nothing (the terrain is decoration); only x is time.
 */
export function routeY(x: number, width: number, height: number): number {
  const t = x / Math.max(1, width);
  return height * (0.6 - 0.22 * t) + Math.sin(t * Math.PI * 2.3 + 0.6) * height * 0.07;
}

/** Labels along the route: alternate above and below where they'd collide (≥ `gap` px apart on a side). */
export function labelSides(xs: readonly number[], gap = 150): ('above' | 'below')[] {
  const lastOn = { above: -Infinity, below: -Infinity };
  return xs.map((x) => {
    const side = x - lastOn.above >= gap ? 'above' : x - lastOn.below >= gap ? 'below' : lastOn.above <= lastOn.below ? 'above' : 'below';
    lastOn[side] = x;
    return side;
  });
}

export interface LabelBox {
  /** Where the label points (its marker), in px. */
  x: number;
  width: number;
  /** Lower goes first (gets the closest row). */
  priority: number;
}
export interface PlacedLabel {
  side: 'above' | 'below';
  /** 0: right next to the route; 1, 2: further out, with a leader line. */
  level: number;
  /** The label's left edge, kept inside the width. */
  left: number;
}

/**
 * Places labels along the route without overlaps: each takes the closest free row (above, below,
 * then further out), most important first. Labels stay inside `width`; if every row is taken, the
 * outermost row is shared.
 */
export function placeLabels(items: readonly LabelBox[], width: number, gap = 8, levels = 3): PlacedLabel[] {
  const rows: [number, number][][] = Array.from({ length: levels * 2 }, () => []);
  const order = items.map((_, i) => i).sort((a, b) => items[a].priority - items[b].priority || items[a].x - items[b].x);
  const out: PlacedLabel[] = new Array(items.length);
  for (const i of order) {
    const it = items[i];
    const left = Math.min(Math.max(4, it.x - it.width / 2), Math.max(4, width - it.width - 4));
    const right = left + it.width;
    let row = rows.findIndex((r) => r.every(([l, rr]) => right + gap <= l || left >= rr + gap));
    if (row < 0) row = rows.length - 1;
    rows[row].push([left, right]);
    out[i] = { side: row % 2 === 0 ? 'above' : 'below', level: Math.floor(row / 2), left };
  }
  return out;
}
