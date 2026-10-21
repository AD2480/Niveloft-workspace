import type { Task } from '@/api/types';
import { basis, predict, search, type Learned } from '@/lib/projectLearner';
import { shortDate } from '@/lib/projectAnalysis';
import { dayToIso, type ProjectModel } from '@/three/projectModel';

/** An answer from Niveloft's built-in model (no AI service): lines of findings, each with its tasks. */
export interface LocalAnswer {
  title: string;
  lines: { text: string; task?: Task }[];
  /** What the model learned from, and how accurate it was. */
  basis: string;
  /** Said when the question needs more than records and statistics. */
  limit?: string;
}

const pct = (p: number) => `${Math.round(p * 100)}%`;

function keysIn(question: string): string[] {
  return [...question.toUpperCase().matchAll(/\b([A-Z][A-Z0-9]{1,5})[- ]?(\d{1,4})\b/g)].map((m) => `${m[1]}-${Number(m[2])}`);
}

function risksFor(learned: Learned, tasks: readonly Task[], model: ProjectModel) {
  const blocks = new Map(model.blocks.map((b) => [b.id, b]));
  return tasks
    .filter((t) => t.status !== 'DONE')
    .map((t) => ({ task: t, p: predict(learned, t, blocks.get(t.id)!, model.todayDay) }))
    .filter((r) => blocks.has(r.task.id));
}

function pace(ratio: number): string {
  if (Math.abs(ratio - 1) < 0.1) return 'about as long as estimated';
  return ratio > 1 ? `${ratio.toFixed(1)}× as long as estimated` : `${Math.round((1 - ratio) * 100)}% less time than estimated`;
}

/**
 * Answers a free question from the built-in model: lateness risk (with the reasons it learned),
 * finish estimates from people's real pace, who's working how, or the records that match.
 */
export function answerLocally(question: string, learned: Learned, tasks: readonly Task[], model: ProjectModel): LocalAnswer {
  const q = question.toLowerCase();
  const byKey = new Map(tasks.map((t) => [t.key.toUpperCase(), t]));
  const blocks = new Map(model.blocks.map((b) => [b.id, b]));
  const focus = keysIn(question).map((k) => byKey.get(k)).filter((t): t is Task => !!t);
  const dateOf = (day: number) => shortDate(dayToIso(model.originMs, Math.round(day)));
  const base = basis(learned);

  // 0. The deadline: the scheduler's finish against it, and what most threatens it.
  if (!focus.length && /\b(deadline|make it|in time|on track|ship|launch|release)\b/.test(q)) {
    const open = tasks.filter((t) => t.status !== 'DONE');
    if (model.deadlineDay == null) {
      return {
        title: 'This project has no deadline',
        lines: [{ text: model.projectionEnd != null ? `At the scheduler’s estimate the open work finishes about ${dateOf(model.projectionEnd)}.` : 'Nothing is scheduled yet.' }],
        basis: base,
      };
    }
    if (!open.length) return { title: 'Everything is done', lines: [{ text: `All tasks are approved, before the deadline of ${dateOf(model.deadlineDay)}.` }], basis: base };
    const end = model.projectionEnd ?? null;
    const gap = end === null ? null : Math.round(model.deadlineDay - end);
    const first = end === null
      ? { text: `The deadline is ${dateOf(model.deadlineDay)}; the open work has no estimate yet, so there’s nothing to compare it with.` }
      : { text: `The scheduler estimates the open work finishing about ${dateOf(end)}, ${gap! >= 0 ? `${gap} ${gap === 1 ? 'day' : 'days'} before` : `${-gap!} ${gap === -1 ? 'day' : 'days'} after`} the deadline (${dateOf(model.deadlineDay)}).` };
    const risky = risksFor(learned, tasks, model)
      .filter((r) => r.p.pLate !== null)
      .sort((a, b) => b.p.pLate! - a.p.pLate!)
      .slice(0, 3)
      .map((r) => ({ task: r.task, text: `${r.task.key} ${r.task.title}: ${pct(r.p.pLate!)} chance of finishing late.` }));
    return {
      title: gap === null ? 'The deadline' : gap >= 0 ? 'On course for the deadline, at the current pace' : 'Behind the deadline, at the current pace',
      lines: [first, ...risky],
      basis: base,
    };
  }

  // 1. Lateness and risk.
  if (/\b(late|risk|risky|slip|slipping|delay|delayed|behind|on time|overdue|miss)\b/.test(q)) {
    const rows = focus.length ? focus.filter((t) => t.status !== 'DONE' && blocks.has(t.id)).map((t) => ({ task: t, p: predict(learned, t, blocks.get(t.id)!, model.todayDay) })) : risksFor(learned, tasks, model);
    if (!learned.risk) {
      const late = rows.filter((r) => r.p.finishDay !== null && blocks.get(r.task.id)?.dueDay != null && r.p.finishDay > blocks.get(r.task.id)!.dueDay! + 0.5);
      return {
        title: late.length ? 'At its people’s usual pace, these would finish after their due date' : 'Nothing is estimated to finish late at its people’s usual pace',
        lines: late.slice(0, 5).map((r) => ({ task: r.task, text: `${r.task.key} ${r.task.title}: about ${dateOf(r.p.finishDay!)}, due ${r.task.dueDate}` })),
        basis: base,
      };
    }
    const ranked = rows.filter((r) => r.p.pLate !== null).sort((a, b) => b.p.pLate! - a.p.pLate!);
    return {
      title: focus.length ? `How likely ${focus.map((t) => t.key).join(', ')} is to finish late` : 'Open tasks most likely to finish late',
      lines: ranked.slice(0, focus.length ? focus.length : 5).map((r) => {
        const why = r.p.factors.filter((f) => f.effect > 0).map((f) => f.name);
        const calms = r.p.factors.filter((f) => f.effect < 0).map((f) => f.name);
        return {
          task: r.task,
          text: `${r.task.key} ${r.task.title}: ${pct(r.p.pLate!)} chance of finishing late${why.length ? `, mostly because of ${why.join(' and ')}` : ''}${calms.length ? ` (helped by ${calms.join(' and ')})` : ''}.`,
        };
      }),
      basis: base,
    };
  }

  // 2. How long / when will it finish.
  if (/\b(how long|when will|when is|finish|finished|done by|eta|take|estimate)\b/.test(q)) {
    const subject = focus.length ? focus : tasks.filter((t) => t.status === 'IN_PROGRESS').slice(0, 5);
    const lines = subject
      .filter((t) => t.status !== 'DONE' && blocks.has(t.id))
      .map((t) => {
        const p = predict(learned, t, blocks.get(t.id)!, model.todayDay);
        const who = t.assignee?.name ?? 'Unassigned';
        return {
          task: t,
          text: `${t.key} ${t.title}: about ${dateOf(p.finishDay!)}. ${who}’s tasks here take ${pace(p.pace.ratio)}${p.pace.n ? ` (${p.pace.n} finished)` : ' (no finished tasks yet, so the project average)'}.`,
        };
      });
    return {
      title: focus.length ? 'When it’s likely to finish' : 'When the work in progress is likely to finish',
      lines: lines.length ? lines : [{ text: 'Nothing matching is still open.' }],
      basis: base,
    };
  }

  // 3. People and workload.
  if (/\b(who|people|person|team|workload|busy|fastest|slowest|pace)\b/.test(q)) {
    const open = new Map<string, number>();
    for (const t of tasks) if (t.status !== 'DONE') open.set(t.assignee?.name ?? 'Unassigned', (open.get(t.assignee?.name ?? 'Unassigned') ?? 0) + 1);
    const names = [...new Set([...open.keys(), ...learned.pace.byPerson.keys()])].sort((a, b) => a.localeCompare(b));
    return {
      title: 'Who is working at what pace',
      lines: names.map((n) => {
        const p = learned.pace.byPerson.get(n);
        return { text: `${n}: ${open.get(n) ?? 0} open ${open.get(n) === 1 ? 'task' : 'tasks'}${p ? `; finished tasks took ${pace(p.ratio)} (${p.n} measured)` : '; no finished, estimated tasks to learn pace from yet'}.` };
      }),
      basis: base,
    };
  }

  // 4. Anything else: the records that match.
  const hits = search(learned.index, question, 5);
  const byId = new Map(tasks.map((t) => [t.id, t]));
  return {
    title: hits.length ? 'The records that best match your question' : 'No records match your question',
    lines: hits.map((h) => {
      const t = byId.get(h.id)!;
      const status = { TODO: 'to do', IN_PROGRESS: 'in progress', IN_REVIEW: 'in review', DONE: 'done' }[t.status];
      return { task: t, text: `${t.key} ${t.title}: ${status}${t.assignee ? `, ${t.assignee.name}` : ', unassigned'}${t.dueDate ? `, due ${t.dueDate}` : ''}.` };
    }),
    basis: base,
    limit: 'The built-in model finds and measures; it can’t reason about why in your words. For open-ended answers, turn on the AI in this browser (Chrome), or run Ollama on the computer with the backend: it’s picked up automatically.',
  };
}
