import type { Milestone, Priority, Role, Task, TaskStatus } from '@/api/types';
import type { ProgressForecast, Range } from '@/lib/progressForecast';
import { projectBlocker } from '@/lib/forecastText';
import { packRows, statusAt, type ProjectModel } from '@/three/projectModel';

/**
 * The work graph's data: one lane per person (or per milestone in the delivery view), calendar
 * time across, recorded work as solid blocks, planned work as outlines, and the forecast's
 * uncertainty as a thin band. Each role gets a default view that answers its own question:
 *
 * - My work (members): "What should I work on, and when am I likely to finish?"
 * - Reviews (reviewers): "Whose delivery am I blocking?"
 * - Team (owners, managers): "What threatens delivery, and what change would help?"
 * - Delivery (viewers, clients): "What is happening, and when should I expect delivery?"
 *
 * It only ever uses records the server already returned to this person.
 */
export type Lens = 'mine' | 'reviews' | 'team' | 'delivery';

export const LENS_LABEL: Record<Lens, string> = { mine: 'My work', reviews: 'Reviews', team: 'Team', delivery: 'Delivery' };
export const LENS_QUESTION: Record<Lens, string> = {
  mine: 'What should I work on, and when am I likely to finish?',
  reviews: 'Whose delivery am I blocking?',
  team: 'What threatens delivery, and what change would help?',
  delivery: 'What is happening, and when should I expect delivery?',
};

export function defaultLens(role: Role, hasOwnWork: boolean): Lens {
  if (role === 'VIEWER') return 'delivery';
  if (role === 'MEMBER') return hasOwnWork ? 'mine' : 'team';
  return 'team';
}

/** Which views a role can switch between (reviews only for people who can review). */
export function lensesFor(role: Role): Lens[] {
  if (role === 'VIEWER') return ['delivery', 'team'];
  if (role === 'MEMBER') return ['mine', 'team', 'delivery'];
  return ['team', 'reviews', 'mine', 'delivery'];
}

export interface GraphItem {
  id: number;
  key: string;
  title: string;
  status: TaskStatus;
  priority: Priority;
  owner: string | null;
  ownerId: number | null;
  lane: number;
  row: number;
  /** Recorded work: first start to approval (or today, if still open). */
  recorded: { start: number; end: number } | null;
  /** Planned by the scheduler from estimates (open work only). */
  planned: { start: number; end: number; late: boolean; assumed: boolean } | null;
  /** The forecast's range for when it's approved (open work only). */
  band: Range | null;
  dueDay: number | null;
  createdDay: number;
  blockedBy: number[];
  blocks: number[];
  /** Shown faintly: context rather than the point of this view. */
  muted: boolean;
  /** Why it's called out: the main blocker, or a review waiting on the viewer. */
  flag: 'blocker' | 'review' | null;
  milestoneId: number | null;
}

export interface GraphLane {
  id: string;
  label: string;
  /** A short line under the label ("3 open · likely done 8–11 Oct" is filled in by the view). */
  userId: number | null;
  rowStart: number;
  rows: number;
  /** In the delivery view: the milestone this lane stands for. */
  milestone?: { id: number | null; name: string; dueDay: number | null; completed: boolean; band: Range | null; span: { start: number; end: number } | null; open: number; total: number };
}

export interface GraphData {
  lens: Lens;
  lanes: GraphLane[];
  items: GraphItem[];
  rows: number;
  start: number;
  end: number;
  today: number;
  deadline: number | null;
  milestones: { name: string; day: number; completed: boolean }[];
}

export interface GraphInput {
  model: ProjectModel;
  forecast: ProgressForecast | null;
  tasks: readonly Task[];
  milestones: readonly Milestone[];
  lens: Lens;
  me: number | null;
}

const dayOf = (model: ProjectModel, iso: string) => (new Date(`${iso}T12:00:00`).getTime() - model.originMs) / 86_400_000;

export function buildGraph({ model, forecast, tasks, milestones, lens, me }: GraphInput): GraphData {
  const today = model.todayDay;
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const blocksOf = new Map<number, number[]>();
  for (const b of model.blocks) for (const pred of b.blockedBy) blocksOf.set(pred, [...(blocksOf.get(pred) ?? []), b.id]);
  const blocker = forecast ? projectBlocker(forecast) : null;

  const base: GraphItem[] = model.blocks
    .filter((b) => byId.has(b.id))
    .map((b) => {
      const t = byId.get(b.id)!;
      const status = statusAt(b, today) ?? t.status;
      const open = status !== 'DONE';
      return {
        id: b.id,
        key: b.key,
        title: b.title,
        status,
        priority: b.priority,
        owner: t.assignee?.name ?? null,
        ownerId: t.assignee?.id ?? null,
        lane: 0,
        row: 0,
        recorded: b.startedDay !== null ? { start: b.startedDay, end: b.doneDay ?? today } : null,
        // Planned: the forecast's typical working period (so it lines up with the range after it);
        // the scheduler's plan from raw estimates only when there's no forecast.
        planned: open ? plannedOf(b, forecast, today) : null,
        band: open ? (forecast?.tasks[b.id] ?? null) : null,
        dueDay: b.dueDay,
        createdDay: b.createdDay,
        blockedBy: b.blockedBy,
        blocks: blocksOf.get(b.id) ?? [],
        muted: false,
        flag: blocker?.taskId === b.id ? 'blocker' : null,
        milestoneId: t.milestoneId,
      } satisfies GraphItem;
    });

  const milestoneMarks = model.milestones.map((m) => ({ name: m.name, day: m.day, completed: m.completed }));
  const extent = (it: GraphItem) => {
    const start = Math.min(it.recorded?.start ?? Infinity, it.planned?.start ?? Infinity, it.dueDay ?? Infinity, Math.max(it.createdDay, today - 60));
    const end = Math.max(it.recorded?.end ?? -Infinity, it.planned?.end ?? -Infinity, it.band?.p90 ?? -Infinity, start + 0.6);
    return { start, end };
  };

  if (lens === 'delivery') {
    const order = [...milestones].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    const groups: { id: number | null; name: string; dueDay: number | null; completed: boolean }[] = order.map((m) => ({ id: m.id, name: m.name, dueDay: dayOf(model, m.dueDate), completed: m.completed }));
    if (base.some((it) => it.milestoneId === null || !order.some((m) => m.id === it.milestoneId))) groups.push({ id: null, name: 'Other work', dueDay: null, completed: false });
    const lanes: GraphLane[] = groups.map((g, i) => {
      const mine = base.filter((it) => (g.id === null ? it.milestoneId === null || !order.some((m) => m.id === it.milestoneId) : it.milestoneId === g.id));
      const open = mine.filter((it) => it.status !== 'DONE');
      const recordedStarts = mine.map((it) => it.recorded?.start).filter((d): d is number => d !== undefined);
      const done = mine.filter((it) => it.status === 'DONE').map((it) => it.recorded?.end ?? today);
      const span = recordedStarts.length ? { start: Math.min(...recordedStarts), end: open.length ? today : Math.max(...done, Math.min(...recordedStarts) + 0.5) } : null;
      const band = g.id !== null ? (forecast?.milestones[g.id] ?? null) : open.length && forecast ? rangeOfMany(open.map((it) => it.band).filter((r): r is Range => !!r)) : null;
      return {
        id: `m${g.id ?? 'none'}`,
        label: g.name,
        userId: null,
        rowStart: i,
        rows: 1,
        milestone: { ...g, band: open.length ? band : null, span, open: open.length, total: mine.length },
      };
    });
    const allDays = lanes.flatMap((l) => [l.milestone!.span?.start, l.milestone!.span?.end, l.milestone!.band?.p90, l.milestone!.dueDay]).filter((d): d is number => typeof d === 'number');
    return {
      lens,
      lanes,
      items: [],
      rows: lanes.length,
      start: Math.floor(Math.min(today - 7, ...allDays) - 2),
      end: Math.ceil(Math.max(today + 7, model.deadlineDay ?? 0, ...allDays) + 3),
      today,
      deadline: model.deadlineDay,
      milestones: milestoneMarks,
    };
  }

  // Which items this view shows, and which it shows faintly.
  let items = base;
  if (lens === 'mine') {
    const mine = new Set(base.filter((it) => it.ownerId === me).map((it) => it.id));
    const waitsOn = new Set<number>();
    for (const it of base) if (mine.has(it.id) && it.status !== 'DONE') for (const p of it.blockedBy) if (!mine.has(p)) waitsOn.add(p);
    items = base.filter((it) => mine.has(it.id) || waitsOn.has(it.id)).map((it) => ({ ...it, muted: !mine.has(it.id) }));
  } else if (lens === 'reviews') {
    const inReview = new Set(base.filter((it) => it.status === 'IN_REVIEW').map((it) => it.id));
    const held = new Set<number>();
    for (const it of base) if (it.status !== 'DONE' && it.blockedBy.some((p) => inReview.has(p))) held.add(it.id);
    items = base.map((it) => ({ ...it, muted: !inReview.has(it.id) && !held.has(it.id), flag: inReview.has(it.id) ? 'review' : it.flag }));
  }

  // Lanes: people, in the model's order; in "my work" you come first.
  const laneKey = (it: GraphItem) => (it.ownerId !== null ? `u${it.ownerId}` : 'none');
  const names = new Map<string, { label: string; userId: number | null }>();
  for (const it of items) names.set(laneKey(it), { label: it.owner ?? 'Unassigned', userId: it.ownerId });
  const modelOrder = model.lanes.map((l) => l.label);
  const keys = [...names.keys()].sort((a, b) => {
    if (lens === 'mine') {
      if (a === `u${me}`) return -1;
      if (b === `u${me}`) return 1;
    }
    if (a === 'none') return 1;
    if (b === 'none') return -1;
    const ia = modelOrder.indexOf(names.get(a)!.label);
    const ib = modelOrder.indexOf(names.get(b)!.label);
    return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib) || names.get(a)!.label.localeCompare(names.get(b)!.label);
  });
  const lanes: GraphLane[] = [];
  let row = 0;
  const placed: GraphItem[] = [];
  keys.forEach((k, li) => {
    const inLane = items.filter((it) => laneKey(it) === k);
    const rowsOf = packRows(inLane.map(extent));
    const count = Math.max(1, ...rowsOf.map((r) => r + 1));
    lanes.push({ id: k, label: lens === 'mine' && k === `u${me}` ? 'You' : names.get(k)!.label, userId: names.get(k)!.userId, rowStart: row, rows: count });
    inLane.forEach((it, i) => placed.push({ ...it, lane: li, row: row + rowsOf[i] }));
    row += count;
  });

  const spans = placed.map(extent);
  const start = Math.floor(Math.min(today - 7, ...spans.map((s) => s.start)) - 1);
  const end = Math.ceil(Math.max(today + 7, model.deadlineDay ?? 0, ...spans.map((s) => s.end)) + 2);
  return { lens, lanes, items: placed, rows: row, start, end, today, deadline: model.deadlineDay, milestones: milestoneMarks };
}

function plannedOf(b: ProjectModel['blocks'][number], forecast: ProgressForecast | null, today: number): GraphItem['planned'] {
  const sim = forecast?.schedule[b.id];
  const late = b.dueDay !== null && !!forecast?.tasks[b.id] && forecast.tasks[b.id].p50 > b.dueDay + 1;
  if (sim) return { start: Math.max(today, sim.start), end: Math.max(today + 0.3, sim.end), late, assumed: !!b.projected?.assumed };
  if (b.projected) return { start: Math.max(today, b.projected.start), end: Math.max(today + 0.3, b.projected.end), late: b.projected.late, assumed: b.projected.assumed };
  return null;
}

/** A rough combined range for work outside any milestone: the latest of its tasks' ranges. */
function rangeOfMany(rs: Range[]): Range | null {
  if (!rs.length) return null;
  return { p10: Math.max(...rs.map((r) => r.p10)), p50: Math.max(...rs.map((r) => r.p50)), p90: Math.max(...rs.map((r) => r.p90)) };
}

/** Everything upstream and downstream of a task (what it waits on, and what waits on it). */
export function chainOf(items: readonly GraphItem[], id: number): Set<number> {
  const byId = new Map(items.map((it) => [it.id, it]));
  const out = new Set<number>([id]);
  const walk = (start: number, next: (it: GraphItem) => number[]) => {
    const stack = [start];
    while (stack.length) {
      const cur = byId.get(stack.pop()!);
      if (!cur) continue;
      for (const n of next(cur)) {
        if (!out.has(n)) {
          out.add(n);
          stack.push(n);
        }
      }
    }
  };
  walk(id, (it) => it.blockedBy);
  walk(id, (it) => it.blocks);
  return out;
}
