/**
 * The Project Model: a pure description of a project in space and time, built from records.
 *
 * Axes
 * - x: time in days since `originIso` (local midnight). Fractional days come from instants.
 * - z: one lane per assignee (alphabetical, "Unassigned" last). Overlapping work inside a lane
 *   is packed into sub-rows so blocks never intersect.
 * - y: started work is a shallow block of one height (priority is shown as a badge, not as height,
 *   so an urgent task never hides the ones behind it or looks like more work); not-yet-started work
 *   is a low plate.
 *
 * Three time zones, never mixed:
 * - the past is drawn from what was recorded (created, status changes, approval);
 * - the present is the Today plane;
 * - the future is the deterministic scheduler's projection, always marked as an estimate.
 *
 * Nothing here touches three.js or the DOM, so it is unit-tested directly.
 */
import type { Dependency, Milestone, Priority, StatusChange, Task, TaskStatus } from '@/api/types';
import type { PlanOutcome } from '@/lib/scheduler';

export const DAY_MS = 86_400_000;

/** Local-midnight epoch ms for a yyyy-MM-dd date. */
export function dateMs(iso: string): number {
  return new Date(`${iso.slice(0, 10)}T00:00:00`).getTime();
}

/** Local yyyy-MM-dd for a day index relative to the origin. */
export function dayToIso(originMs: number, day: number): string {
  const d = new Date(originMs + Math.floor(day) * DAY_MS + DAY_MS / 2); // mid-day avoids DST edges
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const dd = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${dd}`;
}

export const PRIORITY_HEIGHT: Record<Priority, number> = { LOW: 0.4, MEDIUM: 0.4, HIGH: 0.4, URGENT: 0.4 };
export const PLATE_HEIGHT = 0.08;

export interface StatusSegment {
  /** Day the status began. */
  from: number;
  status: TaskStatus;
}

export interface ModelBlock {
  id: number;
  key: string;
  title: string;
  priority: Priority;
  assigneeName: string | null;
  lane: number;
  /** Sub-row inside the lane (0-based). */
  row: number;
  createdDay: number;
  startedDay: number | null;
  doneDay: number | null;
  dueDay: number | null;
  /** Recorded status history, oldest first; the first segment begins at creation. */
  segments: StatusSegment[];
  /**
   * The scheduler's projection for open work (an estimate), in days. `assumed` is true when the
   * task had no estimate and the scheduler used its default duration instead.
   */
  projected: { start: number; end: number; late: boolean; assumed: boolean } | null;
  /** Ids of tasks this one waits on. */
  blockedBy: number[];
  submissionCount: number;
  commentCount: number;
}

export interface ModelLane {
  label: string;
  /** z of the lane's first row, and the number of rows. */
  z: number;
  rows: number;
}

export interface ModelLink {
  blockerId: number;
  blockedId: number;
}

export interface ModelMilestone {
  name: string;
  day: number;
  completed: boolean;
}

export interface ProjectModel {
  originIso: string;
  originMs: number;
  /** Total span in days, from the origin to the last thing worth showing. */
  span: number;
  todayDay: number;
  deadlineDay: number | null;
  lanes: ModelLane[];
  blocks: ModelBlock[];
  links: ModelLink[];
  milestones: ModelMilestone[];
  /** Depth of all lanes together (z extent). */
  depth: number;
  /** End of the projection, if any open work was scheduled. */
  projectionEnd: number | null;
}

export interface ModelInput {
  now: Date;
  projectStart: string;
  deadline: string | null;
  tasks: readonly Task[];
  dependencies: readonly Dependency[];
  milestones: readonly Milestone[];
  history: readonly StatusChange[];
  projection: PlanOutcome | null;
}

export const ROW_DEPTH = 1.15;
export const LANE_GAP = 0.8;
const UNASSIGNED = 'Unassigned';

function instantDay(originMs: number, instant: string): number {
  return (new Date(instant).getTime() - originMs) / DAY_MS;
}

/** Whole days from the origin to a calendar date (rounded, so a daylight-saving change in between doesn't leave a fraction). */
function isoDay(originMs: number, iso: string): number {
  return Math.round((dateMs(iso) - originMs) / DAY_MS);
}

/**
 * Status segments from recorded history. Falls back to the task's own timestamps when a task has
 * no recorded changes (e.g. data created before history was kept).
 */
export function buildSegments(task: Task, events: readonly StatusChange[], originMs: number, nowDay: number): StatusSegment[] {
  const created = instantDay(originMs, task.createdAt);
  const own = events.filter((e) => e.taskId === task.id).sort((a, b) => a.at.localeCompare(b.at));
  const segments: StatusSegment[] = [];
  if (own.length > 0) {
    const first = own[0];
    segments.push({ from: created, status: first.from ?? first.to });
    for (const e of own) {
      const day = Math.max(created, instantDay(originMs, e.at));
      const last = segments[segments.length - 1];
      if (last.status === e.to) continue;
      if (Math.abs(last.from - day) < 1e-9) last.status = e.to;
      else segments.push({ from: day, status: e.to });
    }
    return segments;
  }
  segments.push({ from: created, status: 'TODO' });
  if (task.startedAt) segments.push({ from: Math.max(created, instantDay(originMs, task.startedAt)), status: 'IN_PROGRESS' });
  if (task.completedAt) segments.push({ from: Math.max(created, instantDay(originMs, task.completedAt)), status: 'DONE' });
  const last = segments[segments.length - 1];
  if (last.status !== task.status) segments.push({ from: Math.min(nowDay, Math.max(last.from, instantDay(originMs, task.updatedAt))), status: task.status });
  return segments;
}

/** Status of a block at `day`, or null if it didn't exist yet. */
export function statusAt(block: Pick<ModelBlock, 'segments' | 'createdDay'>, day: number): TaskStatus | null {
  if (day < block.createdDay) return null;
  let status: TaskStatus = block.segments[0]?.status ?? 'TODO';
  for (const s of block.segments) {
    if (s.from <= day) status = s.status;
    else break;
  }
  return status;
}

/** First day the block entered `status` at or before `day`, or null. */
export function firstEntered(block: Pick<ModelBlock, 'segments'>, status: TaskStatus, upTo = Infinity): number | null {
  for (const s of block.segments) if (s.status === status && s.from <= upTo) return s.from;
  return null;
}

/** Greedy interval packing: returns the row index for each interval (sorted by start). */
export function packRows(intervals: readonly { start: number; end: number }[]): number[] {
  const rowEnds: number[] = [];
  const order = intervals.map((iv, i) => ({ ...iv, i })).sort((a, b) => a.start - b.start || a.end - b.end || a.i - b.i);
  const rows = new Array<number>(intervals.length).fill(0);
  for (const iv of order) {
    let r = rowEnds.findIndex((end) => end <= iv.start - 0.25);
    if (r === -1) {
      r = rowEnds.length;
      rowEnds.push(iv.end);
    } else rowEnds[r] = iv.end;
    rows[iv.i] = r;
  }
  return rows;
}

/** Visual extent of a block (recorded and projected together), used for row packing and bounds. */
function extent(b: Omit<ModelBlock, 'lane' | 'row'>, todayDay: number): { start: number; end: number } {
  const start = b.startedDay ?? b.createdDay;
  let end = b.doneDay ?? Math.max(todayDay, start + 0.5);
  if (!b.startedDay && !b.doneDay) end = Math.max(start + 1, b.dueDay ?? start + 3);
  if (b.projected) end = Math.max(end, b.projected.end);
  return { start: Math.min(start, b.createdDay), end: Math.max(end, start + 0.5) };
}

export function buildProjectModel(input: ModelInput): ProjectModel {
  const nowMs = input.now.getTime();
  const earliestCreated = input.tasks.reduce((min, t) => Math.min(min, new Date(t.createdAt).getTime()), Number.POSITIVE_INFINITY);
  const startMs = Math.min(dateMs(input.projectStart), Number.isFinite(earliestCreated) ? earliestCreated : dateMs(input.projectStart), nowMs);
  const originMs = dateMs(dayToIso(startMs - 2 * DAY_MS, 0));
  const originIso = dayToIso(originMs, 0);
  const todayDay = (nowMs - originMs) / DAY_MS;

  const blockedBy = new Map<number, number[]>();
  for (const d of input.dependencies) blockedBy.set(d.blocked.id, [...(blockedBy.get(d.blocked.id) ?? []), d.blocker.id]);

  const partial = input.tasks.map((t) => {
    const createdDay = instantDay(originMs, t.createdAt);
    const segments = buildSegments(t, input.history, originMs, todayDay);
    const doneDay = t.status === 'DONE' ? (t.completedAt ? instantDay(originMs, t.completedAt) : firstEntered({ segments }, 'DONE')) : null;
    const startedDay = t.startedAt ? instantDay(originMs, t.startedAt) : firstEntered({ segments }, 'IN_PROGRESS');
    const sched = t.status !== 'DONE' ? input.projection?.scheduled.get(t.id) : undefined;
    const projected = sched
      ? { start: isoDay(originMs, sched.start), end: isoDay(originMs, sched.finish) + 1, late: (sched.slipDays ?? 0) > 0, assumed: sched.flags.includes('NO_ESTIMATE') }
      : null;
    return {
      id: t.id,
      key: t.key,
      title: t.title,
      priority: t.priority,
      assigneeName: t.assignee?.name ?? null,
      createdDay,
      startedDay: startedDay === null ? null : Math.max(createdDay, startedDay),
      doneDay,
      dueDay: t.dueDate ? isoDay(originMs, t.dueDate) : null,
      segments,
      projected,
      blockedBy: blockedBy.get(t.id) ?? [],
      submissionCount: t.submissionCount,
      commentCount: t.commentCount,
    };
  });

  // Lanes: people alphabetically, then unassigned work.
  const names = [...new Set(partial.map((b) => b.assigneeName ?? UNASSIGNED))].sort((a, b) =>
    a === UNASSIGNED ? 1 : b === UNASSIGNED ? -1 : a.localeCompare(b),
  );
  const lanes: ModelLane[] = [];
  const blocks: ModelBlock[] = [];
  let z = 0;
  names.forEach((label, laneIndex) => {
    const members = partial.filter((b) => (b.assigneeName ?? UNASSIGNED) === label);
    const rows = packRows(members.map((b) => extent(b, todayDay)));
    const rowCount = Math.max(1, ...rows.map((r) => r + 1));
    lanes.push({ label, z, rows: rowCount });
    members.forEach((b, i) => blocks.push({ ...b, lane: laneIndex, row: rows[i] }));
    z += rowCount * ROW_DEPTH + LANE_GAP;
  });
  const depth = Math.max(ROW_DEPTH, z - LANE_GAP);

  const ids = new Set(blocks.map((b) => b.id));
  const links = input.dependencies
    .filter((d) => ids.has(d.blocker.id) && ids.has(d.blocked.id))
    .map((d) => ({ blockerId: d.blocker.id, blockedId: d.blocked.id }));

  const milestones = input.milestones.map((m) => ({ name: m.name, day: isoDay(originMs, m.dueDate), completed: m.completed }));
  const deadlineDay = input.deadline ? isoDay(originMs, input.deadline) : null;

  let projectionEnd: number | null = null;
  for (const b of blocks) if (b.projected) projectionEnd = Math.max(projectionEnd ?? 0, b.projected.end);

  let last = todayDay + 5;
  for (const b of blocks) last = Math.max(last, extent(b, todayDay).end, b.dueDay ?? 0);
  for (const m of milestones) last = Math.max(last, m.day);
  if (deadlineDay !== null) last = Math.max(last, deadlineDay);
  const span = Math.ceil(last + 4);

  return { originIso, originMs, span, todayDay, deadlineDay, lanes, blocks, links, milestones, depth, projectionEnd };
}

/** z centre of a block. */
export function blockZ(model: ProjectModel, block: ModelBlock): number {
  const lane = model.lanes[block.lane];
  return lane.z + block.row * ROW_DEPTH + ROW_DEPTH / 2;
}

/**
 * What a block looks like at replay time `day`. Past and present come from records; beyond
 * today, open work follows the projection and is marked as an estimate.
 */
export interface BlockState {
  visible: boolean;
  status: TaskStatus | null;
  /** Solid (recorded) part in days, or null when there is none yet. */
  solid: { start: number; end: number; height: number } | null;
  /** Estimated part (projection) in days, or null. */
  ghost: { start: number; end: number; height: number; completedByNow: boolean } | null;
  overdue: boolean;
  /** True when the state at this time is an estimate (replay beyond today). */
  estimated: boolean;
}

export function blockStateAt(block: ModelBlock, day: number, todayDay: number, showProjection: boolean): BlockState {
  const recordedDay = Math.min(day, todayDay);
  const status = statusAt(block, recordedDay);
  if (status === null) {
    // Not created yet at this time.
    return { visible: false, status: null, solid: null, ghost: null, overdue: false, estimated: day > todayDay };
  }
  const height = PRIORITY_HEIGHT[block.priority];
  const startedBy = firstEntered(block, 'IN_PROGRESS', recordedDay) ?? (block.startedDay !== null && block.startedDay <= recordedDay ? block.startedDay : null);
  let solid: BlockState['solid'];
  if (status === 'TODO' && startedBy === null) {
    // Not started: a low plate across the window it was given (to its due date, or 3 days).
    const end = Math.max(block.createdDay + 1, block.dueDay ?? block.createdDay + 3);
    solid = { start: block.createdDay, end, height: PLATE_HEIGHT };
  } else {
    const start = startedBy ?? block.createdDay;
    const doneAt = firstEntered(block, 'DONE', recordedDay);
    const end = status === 'DONE' && doneAt !== null ? doneAt : recordedDay;
    solid = { start, end: Math.max(end, start + 0.35), height };
  }

  let ghost: BlockState['ghost'] = null;
  // Projections describe the future from today's records, so they are hidden while replaying the past.
  if (showProjection && block.projected && status !== 'DONE' && day >= todayDay - 0.5) {
    ghost = {
      start: block.projected.start,
      end: block.projected.end,
      height: status === 'TODO' ? PRIORITY_HEIGHT[block.priority] : height,
      completedByNow: day > todayDay && block.projected.end <= day,
    };
  }

  const done = status === 'DONE';
  const overdue = !done && block.dueDay !== null && block.dueDay + 1 <= recordedDay;
  return { visible: true, status, solid, ghost, overdue, estimated: day > todayDay };
}

/** Counts per status at `day` (for the replay readout). */
export function countsAt(model: ProjectModel, day: number): Record<TaskStatus, number> & { total: number } {
  const counts = { TODO: 0, IN_PROGRESS: 0, IN_REVIEW: 0, DONE: 0, total: 0 };
  const recorded = Math.min(day, model.todayDay);
  for (const b of model.blocks) {
    const s = statusAt(b, recorded);
    if (s === null) continue;
    counts.total++;
    if (day > model.todayDay && s !== 'DONE' && b.projected && b.projected.end <= day) counts.DONE++;
    else counts[s]++;
  }
  return counts;
}
