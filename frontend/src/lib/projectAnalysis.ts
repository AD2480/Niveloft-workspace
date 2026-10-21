/**
 * History and forecast analysis of a project model, computed (not generated) from its records.
 *
 * Everything here is deterministic and labelled by where it comes from:
 * - `recorded`: counted from what happened (status changes, due dates, submissions);
 * - `estimate`: from the scheduler's projection of open work, which is never a commitment.
 *
 * The same model drives the 3D view, so the numbers always agree with what's on screen.
 */
import type { AiForecast, TaskStatus } from '@/api/types';
import { DEFAULT_ESTIMATE } from '@/lib/scheduler';
import { countsAt, dayToIso, statusAt, type ModelBlock, type ProjectModel } from '@/three/projectModel';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "14 Oct" for a yyyy-MM-dd date. */
export function shortDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// ------------------------------------------------------------------------------------ series

export interface SeriesPoint {
  day: number;
  /** Tasks that existed by then (recorded; flat beyond today, since future tasks are unknown). */
  scope: number;
  counts: Record<TaskStatus, number>;
  /** True beyond today: the counts come from the projection. */
  estimate: boolean;
}

/** Task counts per status from `start` to `end`, sampled often enough for a smooth chart. */
export function historySeries(model: ProjectModel, start: number, end: number, maxPoints = 320): SeriesPoint[] {
  const span = Math.max(0.5, end - start);
  const step = Math.max(0.25, span / maxPoints);
  const days: number[] = [];
  for (let d = start; d < end; d += step) days.push(d);
  days.push(end);
  // Always include today exactly, so the recorded and estimated parts meet there.
  if (model.todayDay > start && model.todayDay < end && !days.includes(model.todayDay)) {
    days.push(model.todayDay);
    days.sort((a, b) => a - b);
  }
  return days.map((day) => {
    const c = countsAt(model, day);
    return { day, scope: c.total, counts: { TODO: c.TODO, IN_PROGRESS: c.IN_PROGRESS, IN_REVIEW: c.IN_REVIEW, DONE: c.DONE }, estimate: day > model.todayDay + 1e-9 };
  });
}

// ---------------------------------------------------------------------------------- analysis

export type FactSource = 'recorded' | 'estimate';
export type FactTone = 'neutral' | 'good' | 'warning' | 'danger';

export interface AnalysisFact {
  id: string;
  source: FactSource;
  tone: FactTone;
  title: string;
  detail: string;
  /** Tasks the fact is about, so the UI can link or highlight them. */
  taskIds: number[];
}

export interface ProjectAnalysis {
  todayIso: string;
  total: number;
  approved: number;
  inReview: number;
  inProgress: number;
  notStarted: number;
  approvedLast7: number;
  approvedPrevious7: number;
  /** yyyy-MM-dd of the last projected finish, or null when nothing is open. */
  forecastFinish: string | null;
  deadline: string | null;
  /** Calendar days between the estimated finish and the deadline (positive = before it). */
  slackDays: number | null;
  /** Open tasks the forecast had to assume a duration for, because nobody estimated them. */
  assumedCount: number;
  facts: AnalysisFact[];
}

const isOpenToday = (model: ProjectModel, b: ModelBlock) => {
  const s = statusAt(b, model.todayDay);
  return s !== null && s !== 'DONE';
};

export function analyzeProject(model: ProjectModel): ProjectAnalysis {
  const today = model.todayDay;
  const todayIso = dayToIso(model.originMs, today);
  const c = countsAt(model, today);
  const facts: AnalysisFact[] = [];

  // Forecast against the deadline (estimate) ---------------------------------------------
  const open = model.blocks.filter((b) => isOpenToday(model, b));
  const forecastFinish = model.projectionEnd !== null && open.length > 0 ? dayToIso(model.originMs, model.projectionEnd - 1) : null;
  const deadline = model.deadlineDay !== null ? dayToIso(model.originMs, model.deadlineDay) : null;
  const slackDays = forecastFinish && model.deadlineDay !== null && model.projectionEnd !== null ? Math.round(model.deadlineDay - (model.projectionEnd - 1)) : null;
  // Unestimated work makes the forecast a guess: say so, and never call it "on track".
  const assumed = open.filter((b) => b.projected?.assumed);
  const assumedNote = assumed.length
    ? ` It assumes ${plural(DEFAULT_ESTIMATE, 'working day')} for each of the ${plural(assumed.length, 'open task')} without an estimate.`
    : '';
  if (open.length === 0 && c.total > 0) {
    facts.push({ id: 'finish', source: 'recorded', tone: 'good', title: 'Nothing is open', detail: `All ${plural(c.total, 'task')} are approved.`, taskIds: [] });
  } else if (open.length === 0) {
    facts.push({ id: 'finish', source: 'recorded', tone: 'neutral', title: 'No tasks yet', detail: 'There is nothing to forecast until the project has tasks.', taskIds: [] });
  } else if (forecastFinish) {
    const when = shortDate(forecastFinish);
    let detail: string;
    let tone: FactTone = 'neutral';
    if (slackDays === null) detail = `If every task takes exactly its estimate, open work is planned to finish on ${when}. The project has no deadline to compare it with.`;
    else if (slackDays >= 0) {
      detail = `If every task takes exactly its estimate: ${plural(slackDays, 'day')} before the ${shortDate(deadline!)} deadline. The delivery forecast adds how long work has really taken.`;
      tone = slackDays <= 3 ? 'warning' : assumed.length ? 'neutral' : 'good';
    } else {
      detail = `If every task takes exactly its estimate: ${plural(-slackDays, 'day')} after the ${shortDate(deadline!)} deadline.`;
      tone = 'danger';
    }
    facts.push({ id: 'finish', source: 'estimate', tone, title: `Planned finish ${when}`, detail: detail + assumedNote, taskIds: [] });
  } else {
    facts.push({ id: 'finish', source: 'estimate', tone: 'neutral', title: 'No forecast', detail: 'The scheduler couldn’t place the open work, so there is no planned finish.', taskIds: [] });
  }
  if (assumed.length) {
    facts.push({
      id: 'assumed',
      source: 'estimate',
      tone: 'warning',
      title: `${plural(assumed.length, 'open task')} ${assumed.length === 1 ? 'has' : 'have'} no estimate`,
      detail: `${assumed
        .slice(0, 8)
        .map((b) => b.key)
        .join(', ')}${assumed.length > 8 ? ` and ${assumed.length - 8} more` : ''}. Add estimates and the forecast above becomes meaningful.`,
      taskIds: assumed.map((b) => b.id),
    });
  }

  // Progress and pace (recorded) ------------------------------------------------------------
  const doneIn = (from: number, to: number) => model.blocks.filter((b) => b.doneDay !== null && b.doneDay > from && b.doneDay <= to).length;
  const approvedLast7 = doneIn(today - 7, today);
  const approvedPrevious7 = doneIn(today - 14, today - 7);
  const pct = c.total ? Math.round((c.DONE / c.total) * 100) : 0;
  // Only compare with an earlier week the records actually cover; "no records" isn't "zero".
  const firstRecord = model.blocks.length ? Math.min(...model.blocks.map((b) => b.createdDay)) : today;
  const pace =
    firstRecord > today - 7
      ? `${plural(approvedLast7, 'approval')} since the first task was created on ${shortDate(dayToIso(model.originMs, firstRecord))}.`
      : firstRecord > today - 14
        ? `${plural(approvedLast7, 'approval')} in the last 7 days. The records start on ${shortDate(dayToIso(model.originMs, firstRecord))}, so there’s no full week before to compare.`
        : `${plural(approvedLast7, 'approval')} in the last 7 days and ${approvedPrevious7} in the 7 days before.`;
  facts.push({
    id: 'progress',
    source: 'recorded',
    tone: 'neutral',
    title: `${c.DONE} of ${plural(c.total, 'task')} approved (${pct}%)`,
    detail: pace,
    taskIds: [],
  });

  // Overdue work, and what it holds up (recorded) --------------------------------------------
  const overdue = open
    .filter((b) => b.dueDay !== null && b.dueDay + 1 <= today)
    .map((b) => ({ b, days: Math.floor(today) - b.dueDay! }))
    .sort((a, z) => z.days - a.days);
  for (const { b, days } of overdue.slice(0, 3)) {
    const holds = model.links
      .filter((l) => l.blockerId === b.id)
      .map((l) => model.blocks.find((x) => x.id === l.blockedId))
      .filter((x): x is ModelBlock => !!x && isOpenToday(model, x));
    facts.push({
      id: `overdue-${b.id}`,
      source: 'recorded',
      tone: 'danger',
      title: `${b.key} is ${plural(days, 'day')} overdue`,
      detail: `${b.title} (${b.assigneeName ?? 'unassigned'}).${holds.length ? ` It holds up ${holds.map((x) => x.key).join(', ')}.` : ''}`,
      taskIds: [b.id, ...holds.map((x) => x.id)],
    });
  }
  if (overdue.length > 3) {
    facts.push({ id: 'overdue-more', source: 'recorded', tone: 'danger', title: `${overdue.length - 3} more overdue`, detail: overdue.slice(3).map((o) => o.b.key).join(', '), taskIds: overdue.slice(3).map((o) => o.b.id) });
  }

  // Work estimated to miss its own due date (estimate) ------------------------------------------
  const late = open.filter((b) => b.projected?.late && !overdue.some((o) => o.b.id === b.id));
  if (late.length) {
    facts.push({
      id: 'late',
      source: 'estimate',
      tone: 'warning',
      title: `${plural(late.length, 'task')} planned to finish after ${late.length === 1 ? 'its' : 'their'} due date`,
      detail: late.map((b) => `${b.key} (due ${shortDate(dayToIso(model.originMs, b.dueDay!))})`).join(', '),
      taskIds: late.map((b) => b.id),
    });
  }

  // Waiting for a reviewer (recorded) ----------------------------------------------------------
  const waiting = open
    .filter((b) => statusAt(b, today) === 'IN_REVIEW')
    .map((b) => {
      const entered = [...b.segments].reverse().find((s) => s.status === 'IN_REVIEW' && s.from <= today)?.from ?? today;
      return { b, days: Math.max(0, Math.floor(today - entered)) };
    })
    .sort((a, z) => z.days - a.days);
  if (waiting.length) {
    facts.push({
      id: 'review',
      source: 'recorded',
      tone: waiting[0].days >= 3 ? 'warning' : 'neutral',
      title: `${plural(waiting.length, 'submission')} waiting for review`,
      detail: waiting.map(({ b, days }) => `${b.key} ${days === 0 ? 'since today' : `for ${plural(days, 'day')}`}`).join(', '),
      taskIds: waiting.map((w) => w.b.id),
    });
  }

  // Rework: more than one review round (recorded) ------------------------------------------------
  const rework = model.blocks.filter((b) => b.submissionCount > 1);
  if (rework.length) {
    facts.push({
      id: 'rework',
      source: 'recorded',
      tone: 'neutral',
      title: `${plural(rework.length, 'task')} needed more than one review round`,
      detail: rework.map((b) => `${b.key} (${b.submissionCount} submissions)`).join(', '),
      taskIds: rework.map((b) => b.id),
    });
  }

  // Open work per person: a recorded count, then the estimate of when each lane clears ---------
  // Listed alphabetically (unassigned last): it describes the spread, it doesn't rank people.
  const byPerson = new Map<string, ModelBlock[]>();
  for (const b of open) byPerson.set(b.assigneeName ?? 'Unassigned', [...(byPerson.get(b.assigneeName ?? 'Unassigned') ?? []), b]);
  const people = [...byPerson.entries()].sort((a, z) => (a[0] === 'Unassigned' ? 1 : z[0] === 'Unassigned' ? -1 : a[0].localeCompare(z[0])));
  const first = (n: string) => (n === 'Unassigned' ? 'Unassigned' : n.split(' ')[0]);
  if (people.length) {
    const sizes = people.filter(([n]) => n !== 'Unassigned').map(([, l]) => l.length);
    const uneven = sizes.length > 1 && Math.max(...sizes) >= 3 && Math.max(...sizes) >= 2 * Math.min(...sizes);
    facts.push({
      id: 'load',
      source: 'recorded',
      tone: uneven ? 'warning' : 'neutral',
      title: 'Open tasks per person',
      detail: people.map(([n, l]) => `${first(n)} ${l.length}`).join(', ') + (uneven ? '. The largest share is at least twice the smallest.' : '.'),
      taskIds: [],
    });
    const clears = people
      .map(([n, l]) => ({ n, end: Math.max(...l.map((b) => b.projected?.end ?? Number.NEGATIVE_INFINITY)) }))
      .filter((p) => Number.isFinite(p.end));
    if (clears.length) {
      const afterDeadline = model.deadlineDay !== null && clears.some((p) => p.end - 1 > model.deadlineDay!);
      facts.push({
        id: 'clears',
        source: 'estimate',
        tone: afterDeadline ? 'warning' : 'neutral',
        title: 'When each person’s open work is planned to end (if estimates hold)',
        detail: clears.map((p) => `${first(p.n)} ${shortDate(dayToIso(model.originMs, p.end - 1))}`).join(', ') + '.',
        taskIds: [],
      });
    }
  }

  return {
    todayIso,
    total: c.total,
    approved: c.DONE,
    inReview: c.IN_REVIEW,
    inProgress: c.IN_PROGRESS,
    notStarted: c.TODO,
    approvedLast7,
    approvedPrevious7,
    forecastFinish,
    deadline,
    slackDays,
    assumedCount: assumed.length,
    facts,
  };
}

export type ChangeKind = 'created' | 'started' | 'submitted' | 'sent back' | 'approved' | 'reopened' | 'moved back';

export interface ChangeEvent {
  day: number;
  taskId: number;
  key: string;
  title: string;
  kind: ChangeKind;
}

/**
 * What happened in the last `days` days, newest first, from the recorded status changes. "Sent
 * back" is a review that requested changes (In review → In progress).
 */
export function recentChanges(model: ProjectModel, days = 7): ChangeEvent[] {
  const from = model.todayDay - days;
  const out: ChangeEvent[] = [];
  for (const b of model.blocks) {
    if (b.createdDay > from && b.createdDay <= model.todayDay) out.push({ day: b.createdDay, taskId: b.id, key: b.key, title: b.title, kind: 'created' });
    for (let i = 1; i < b.segments.length; i++) {
      const seg = b.segments[i];
      if (seg.from <= from || seg.from > model.todayDay) continue;
      const prev = b.segments[i - 1].status;
      const kind: ChangeKind =
        seg.status === 'DONE'
          ? 'approved'
          : seg.status === 'IN_REVIEW'
            ? 'submitted'
            : seg.status === 'IN_PROGRESS'
              ? prev === 'IN_REVIEW'
                ? 'sent back'
                : prev === 'DONE'
                  ? 'reopened'
                  : 'started'
              : prev === 'DONE'
                ? 'reopened'
                : 'moved back';
      out.push({ day: seg.from, taskId: b.id, key: b.key, title: b.title, kind });
    }
  }
  return out.sort((a, z) => z.day - a.day || a.key.localeCompare(z.key, undefined, { numeric: true }));
}

/** The scheduler's estimate the page already shows, in the structured form the server accepts. */
export function forecastFromModel(model: ProjectModel): AiForecast | null {
  const open = model.blocks.filter((b) => b.projected && statusAt(b, model.todayDay) !== 'DONE');
  if (!open.length) return null;
  return {
    finish: model.projectionEnd !== null ? dayToIso(model.originMs, model.projectionEnd - 1) : null,
    tasks: open.map((b) => ({
      key: b.key,
      start: dayToIso(model.originMs, b.projected!.start),
      finish: dayToIso(model.originMs, b.projected!.end - 1),
      late: b.projected!.late,
      assumed: b.projected!.assumed,
    })),
  };
}
