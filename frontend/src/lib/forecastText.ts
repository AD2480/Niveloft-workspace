import { format } from 'date-fns';
import { dayToIso } from '@/three/projectModel';
import { parseLocalDate } from './dates';
import type { AiForecastRange } from '@/api/types';
import type { PersonForecast, ProgressForecast, Range } from './progressForecast';

/** Hours in one estimated working day, for showing effort in hours as well. */
export const HOURS_PER_DAY = 8;

const d = (originMs: number, day: number) => parseLocalDate(dayToIso(originMs, day));

/** "20–29 Oct", "30 Oct – 4 Nov", or "24 Oct" when the range is a single day. */
export function dateRange(originMs: number, r: Pick<Range, 'p10' | 'p90'>): string {
  const a = d(originMs, r.p10);
  const b = d(originMs, r.p90);
  if (format(a, 'yyyy-MM-dd') === format(b, 'yyyy-MM-dd')) return format(a, 'd MMM');
  if (a.getFullYear() !== b.getFullYear()) return `${format(a, 'd MMM yyyy')} – ${format(b, 'd MMM yyyy')}`;
  if (a.getMonth() === b.getMonth()) return `${format(a, 'd')}–${format(b, 'd MMM')}`;
  return `${format(a, 'd MMM')} – ${format(b, 'd MMM')}`;
}

/** "24 Oct" for one model day. */
export function dayText(originMs: number, day: number, pattern = 'd MMM'): string {
  return format(d(originMs, day), pattern);
}

const roundDays = (x: number) => (x < 1 ? Math.max(0.5, Math.round(x * 2) / 2) : Math.round(x));
const roundHours = (x: number) => (x < 40 ? Math.max(1, Math.round(x)) : Math.round(x / 4) * 4);

/**
 * Effort left, from working days of estimates: in hours when it's small ("6–10 hours"),
 * otherwise in working days with hours alongside ("12–18 working days, about 96–144 hours").
 */
export function effortText(r: Pick<Range, 'p10' | 'p90'>): string {
  const lo = r.p10;
  const hi = r.p90;
  if (hi * HOURS_PER_DAY < 20) {
    const a = roundHours(lo * HOURS_PER_DAY);
    const b = roundHours(hi * HOURS_PER_DAY);
    return a === b ? `about ${a} hours` : `${a}–${b} hours`;
  }
  const a = roundDays(lo);
  const b = roundDays(hi);
  const days = a === b ? `about ${a} working ${a === 1 ? 'day' : 'days'}` : `${a}–${b} working days`;
  // Hours from the rounded days, so the two always agree at 8 hours a day.
  return `${days} (about ${a === b ? a * HOURS_PER_DAY : `${a * HOURS_PER_DAY}–${b * HOURS_PER_DAY}`} hours)`;
}

/** A chance as a percentage, never a false certainty: "under 1%" and "over 99%" rather than 0% and 100%. */
export const chanceText = (p: number) => (p < 0.01 ? 'under 1%' : p > 0.99 ? 'over 99%' : `${Math.round(p * 100)}%`);

/** How likely the deadline is, in words and a tone. */
export function deadlineWords(p: number | null): { text: string; tone: 'success' | 'warning' | 'danger' | 'neutral' } {
  if (p === null) return { text: 'No deadline set', tone: 'neutral' };
  const c = chanceText(p);
  const cap = c.charAt(0).toUpperCase() + c.slice(1);
  if (p >= 0.8) return { text: `${cap} chance of making the deadline`, tone: 'success' };
  if (p >= 0.5) return { text: `${cap} chance of making the deadline`, tone: 'warning' };
  return { text: `${p < 0.01 ? cap : `Only ${c}`} chance of making the deadline`, tone: 'danger' };
}

export interface ProjectBlocker {
  taskId: number;
  key: string;
  owner: string | null;
  /** People whose work waits on it, and how many working days in total (on average). */
  waiting: { name: string; days: number }[];
  days: number;
}

/** The one piece of work that holds the most other work up, judged across everyone's forecast. */
export function projectBlocker(f: ProgressForecast): ProjectBlocker | null {
  const byTask = new Map<number, ProjectBlocker>();
  for (const p of f.people) {
    const m = p.mainDependency;
    if (!m || m.days < 0.5) continue;
    const cur = byTask.get(m.taskId) ?? { taskId: m.taskId, key: m.key, owner: m.owner, waiting: [], days: 0 };
    cur.waiting.push({ name: p.name, days: m.days });
    cur.days += m.days;
    byTask.set(m.taskId, cur);
  }
  return [...byTask.values()].sort((a, b) => b.days - a.days)[0] ?? null;
}

/** The person's forecast row, if they have any work in the project. */
export function forecastFor(f: ProgressForecast, userId: number | null | undefined): PersonForecast | null {
  if (!userId) return null;
  return f.people.find((p) => p.userId === userId && p.total > 0) ?? null;
}

// ------------------------------------------------------------------ Flurry's forecast answers

export interface ForecastFact {
  id: string;
  source: 'recorded' | 'estimate';
  tone: 'neutral' | 'good' | 'warning' | 'danger';
  title: string;
  detail: string;
  taskIds: number[];
}

const assumptionLine = (f: ProgressForecast): string =>
  [
    `From ${f.runs} simulations: one task at a time per person, dependencies first, about ${f.reviewLag.toFixed(1)} days per review.`,
    f.unownedKeys.length ? `Assumes someone starts ${f.unownedKeys.slice(0, 3).join(', ')}${f.unownedKeys.length > 3 ? '…' : ''} today.` : '',
    f.unestimatedOpen ? `${f.unestimatedOpen} open ${f.unestimatedOpen === 1 ? 'task has' : 'tasks have'} no estimate.` : '',
  ]
    .filter(Boolean)
    .join(' ');

/** The project's forecast as Flurry's answer: when, how sure, what holds it up, and on what basis. */
export function projectForecastFacts(f: ProgressForecast, originMs: number): ForecastFact[] {
  const out: ForecastFact[] = [];
  const finish = f.project.finish;
  if (!finish) return [{ id: 'none', source: 'recorded', tone: 'good', title: 'Nothing is open.', detail: 'Every task is approved, so there’s nothing left to forecast.', taskIds: [] }];
  const dw = deadlineWords(f.project.pDeadline);
  out.push({
    id: 'finish',
    source: 'estimate',
    tone: dw.tone === 'success' ? 'good' : dw.tone === 'warning' ? 'warning' : dw.tone === 'danger' ? 'danger' : 'neutral',
    title: `Likely finish: ${dateRange(originMs, finish)} (most likely ${dayText(originMs, finish.p50)}).`,
    detail: f.deadlineDay !== null ? `${dw.text}, ${dayText(originMs, f.deadlineDay)}.` : 'The project has no deadline.',
    taskIds: [],
  });
  const b = projectBlocker(f);
  if (b) {
    out.push({
      id: 'blocker',
      source: 'estimate',
      tone: 'warning',
      title: `${b.key}${b.owner ? ` (${b.owner})` : ' (no owner)'} holds work up.`,
      detail: `${b.waiting.map((w) => w.name).join(', ')} ${b.waiting.length === 1 ? 'waits' : 'wait'} on it, about ${Math.max(1, Math.round(b.days))} working days in total.`,
      taskIds: [b.taskId],
    });
  }
  if (f.effort) out.push({ id: 'effort', source: 'estimate', tone: 'neutral', title: `Work left: ${effortText(f.effort)}.`, detail: 'Estimates adjusted by how long finished tasks took against theirs. Waiting isn’t counted as work.', taskIds: [] });
  out.push({ id: 'basis', source: 'recorded', tone: 'neutral', title: 'How it’s worked out', detail: assumptionLine(f), taskIds: [] });
  return out;
}

/** One person's forecast as Flurry's answer, with effort, delivery and the project kept apart. */
export function myForecastFacts(f: ProgressForecast, originMs: number, me: number | null): ForecastFact[] | null {
  const mine = forecastFor(f, me);
  if (!mine || !mine.open) return null;
  const out: ForecastFact[] = [];
  if (mine.effort) out.push({ id: 'effort', source: 'estimate', tone: 'neutral', title: `Your remaining effort: ${effortText(mine.effort)}.`, detail: `On ${mine.open} open ${mine.open === 1 ? 'task' : 'tasks'}: your estimates, adjusted by how long your finished tasks took against theirs.${mine.unestimated ? ` ${mine.unestimated} without an estimate.` : ''}`, taskIds: [] });
  if (mine.finish) {
    out.push({
      id: 'finish',
      source: 'estimate',
      tone: 'neutral',
      title: `Your work likely approved: ${dateRange(originMs, mine.finish)}.`,
      detail: `Includes waiting for other work and for reviews${mine.waitingDays >= 0.5 ? `; about ${Math.round(mine.waitingDays)} working ${Math.round(mine.waitingDays) === 1 ? 'day' : 'days'} of that is waiting` : ''}.`,
      taskIds: [],
    });
  }
  if (mine.mainDependency) {
    out.push({
      id: 'dependency',
      source: 'estimate',
      tone: 'warning',
      title: `Main dependency: ${mine.mainDependency.key}${mine.mainDependency.owner ? ` (${mine.mainDependency.owner})` : ' (no owner yet)'}.`,
      detail: `It holds your work up in ${Math.round(mine.mainDependency.share * 100)}% of the simulations.`,
      taskIds: [mine.mainDependency.taskId],
    });
  }
  if (f.project.finish) out.push({ id: 'project', source: 'estimate', tone: 'neutral', title: `The whole project: ${dateRange(originMs, f.project.finish)}.`, detail: 'Everyone’s work and approvals included.', taskIds: [] });
  out.push({ id: 'basis', source: 'recorded', tone: 'neutral', title: 'How it’s worked out', detail: assumptionLine(f), taskIds: [] });
  return out;
}

/** The simulation's project range for an AI prompt, so the AI explains dates rather than inventing them. */
export function aiRange(f: ProgressForecast | null, originMs: number): AiForecastRange | null {
  const r = f?.project.finish;
  if (!f || !r) return null;
  return {
    optimistic: dayToIso(originMs, r.p10),
    likely: dayToIso(originMs, r.p50),
    cautious: dayToIso(originMs, r.p90),
    chanceByDeadlinePercent: f.project.pDeadline === null ? null : Math.round(f.project.pDeadline * 100),
    mainBlocker: projectBlocker(f)?.key ?? null,
  };
}
