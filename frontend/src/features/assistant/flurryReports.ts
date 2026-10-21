/**
 * Flurry's three starting abilities that need no AI: summarise progress, review blockers and draft
 * a meeting agenda. Each is worked out from the project's records, and every line says whether it
 * is recorded (a fact), an estimate or inference, or something the records don't show. Nothing
 * here changes data, and nothing is invented: no progress, no deadlines, no reasons.
 */
import type { Dependency, Milestone, ProjectDetail, Task } from '@/api/types';
import type { AnalysisFact, ProjectAnalysis } from '@/lib/projectAnalysis';
import { shortDate } from '@/lib/projectAnalysis';

export type LineSource = 'recorded' | 'estimate' | 'missing';

export interface TaskRef {
  id: number;
  key: string;
  projectId: number;
  title: string;
}

export interface ReportLine {
  text: string;
  source: LineSource;
  tone?: 'good' | 'warning' | 'danger' | 'neutral';
  tasks?: TaskRef[];
}

export interface ProgressSummary {
  title: string;
  recorded: ReportLine[];
  inferred: ReportLine[];
  missing: ReportLine[];
}

export interface BlockerFinding {
  id: string;
  kind: 'blocked' | 'overdue' | 'owner' | 'review';
  title: string;
  detail: string;
  /** A concrete next move, phrased as a suggestion. */
  suggestion: string;
  tasks: TaskRef[];
}

export interface ReportInput {
  project: Pick<ProjectDetail, 'id' | 'name' | 'deadline' | 'progress' | 'expectedProgress'>;
  tasks: readonly Task[];
  dependencies?: readonly Dependency[];
  milestones?: readonly Milestone[];
  analysis?: ProjectAnalysis | null;
  /** yyyy-MM-dd */
  today: string;
}

const DAY_MS = 86_400_000;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const ref = (t: Pick<Task, 'id' | 'key' | 'projectId' | 'title'>): TaskRef => ({ id: t.id, key: t.key, projectId: t.projectId, title: t.title });
const isOpen = (t: Pick<Task, 'status'>) => t.status !== 'DONE';
const firstName = (name: string) => name.split(' ')[0];

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((new Date(`${toIso}T12:00:00`).getTime() - new Date(`${fromIso}T12:00:00`).getTime()) / DAY_MS);
}

function listKeys(tasks: readonly Pick<Task, 'key'>[], max = 4): string {
  const shown = tasks.slice(0, max).map((t) => t.key);
  return tasks.length > max ? `${shown.join(', ')} and ${tasks.length - max} more` : shown.join(', ');
}

function fact(analysis: ProjectAnalysis | null | undefined, id: string): AnalysisFact | undefined {
  return analysis?.facts.find((f) => f.id === id);
}

// ------------------------------------------------------------------------------ progress

/** "Summarise progress": where the project stands, what that suggests, and what isn't known. */
export function summariseProgress({ project, tasks, milestones = [], analysis, today }: ReportInput): ProgressSummary {
  const total = tasks.length;
  const title = `Progress in ${project.name}`;
  if (total === 0) {
    return {
      title,
      recorded: [{ text: 'There are no tasks yet, so there’s no progress to report.', source: 'recorded' }],
      inferred: [],
      missing: [{ text: 'A plan: add tasks, or ask me to plan the project from a brief.', source: 'missing' }],
    };
  }
  const by = (s: Task['status']) => tasks.filter((t) => t.status === s);
  const done = by('DONE');
  const recorded: ReportLine[] = [
    { text: `${done.length} of ${plural(total, 'task')} approved (${Math.round((done.length / total) * 100)}%).`, source: 'recorded', tone: done.length === total ? 'good' : 'neutral' },
    { text: `${by('IN_PROGRESS').length} in progress, ${by('IN_REVIEW').length} waiting for review, ${by('TODO').length} not started.`, source: 'recorded' },
  ];
  if (analysis) {
    const trend =
      analysis.approvedLast7 === analysis.approvedPrevious7
        ? 'the same as the week before'
        : analysis.approvedLast7 > analysis.approvedPrevious7
          ? `up from ${analysis.approvedPrevious7} the week before`
          : `down from ${analysis.approvedPrevious7} the week before`;
    recorded.push({ text: `${plural(analysis.approvedLast7, 'task')} approved in the last 7 days, ${trend}.`, source: 'recorded' });
  }
  const overdue = tasks.filter((t) => isOpen(t) && t.dueDate !== null && t.dueDate < today);
  if (overdue.length) {
    recorded.push({ text: `${plural(overdue.length, 'task')} past ${overdue.length === 1 ? 'its' : 'their'} due date: ${listKeys(overdue)}.`, source: 'recorded', tone: 'danger', tasks: overdue.slice(0, 6).map(ref) });
  }
  const next = [...milestones].filter((m) => !m.completed).sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
  if (next) {
    const days = daysBetween(today, next.dueDate);
    const when = days < 0 ? `was due ${shortDate(next.dueDate)}` : days === 0 ? 'is due today' : `is due ${shortDate(next.dueDate)} (in ${plural(days, 'day')})`;
    recorded.push({ text: `Next milestone, “${next.name}”, ${when}: ${next.doneCount} of ${plural(next.taskCount, 'task')} approved.`, source: 'recorded', tone: days < 0 ? 'danger' : 'neutral' });
  }

  const inferred: ReportLine[] = [];
  const finish = fact(analysis, 'finish');
  if (finish && finish.source === 'estimate') inferred.push({ text: `${finish.title}. ${finish.detail}`, source: 'estimate', tone: finish.tone === 'danger' ? 'danger' : finish.tone === 'warning' ? 'warning' : 'neutral' });
  if (project.expectedProgress !== null) {
    const gap = project.progress - project.expectedProgress;
    inferred.push({
      text:
        Math.abs(gap) < 5
          ? `Progress (${project.progress}%) is about where the calendar says it should be by today (${project.expectedProgress}%).`
          : gap < 0
            ? `Progress (${project.progress}%) is behind the calendar: evenly spread, you’d expect about ${project.expectedProgress}% by today.`
            : `Progress (${project.progress}%) is ahead of the calendar (about ${project.expectedProgress}% expected by today).`,
      source: 'estimate',
      tone: gap < -10 ? 'warning' : 'neutral',
    });
  }

  const open = tasks.filter(isOpen);
  const missing: ReportLine[] = [];
  const unestimated = open.filter((t) => t.estimateDays === null);
  if (unestimated.length) missing.push({ text: `${plural(unestimated.length, 'open task')} ${unestimated.length === 1 ? 'has' : 'have'} no estimate, so the finish date assumes a default length for ${unestimated.length === 1 ? 'it' : 'them'}.`, source: 'missing', tasks: unestimated.slice(0, 6).map(ref) });
  const undated = open.filter((t) => t.dueDate === null);
  if (undated.length) missing.push({ text: `${plural(undated.length, 'open task')} ${undated.length === 1 ? 'has' : 'have'} no due date.`, source: 'missing', tasks: undated.slice(0, 6).map(ref) });
  const unowned = open.filter((t) => t.assignee === null);
  if (unowned.length) missing.push({ text: `${plural(unowned.length, 'open task')} ${unowned.length === 1 ? 'has' : 'have'} no owner.`, source: 'missing', tasks: unowned.slice(0, 6).map(ref) });
  if (!project.deadline) missing.push({ text: 'The project has no deadline, so I can’t say whether the estimate is early or late.', source: 'missing' });
  missing.push({ text: 'Why work is ahead or behind isn’t in the records; ask the people doing it.', source: 'missing' });
  return { title, recorded, inferred, missing };
}

// ------------------------------------------------------------------------------ blockers

/** "Review blockers": work that waits on unfinished work, overdue work, missing owners and long review waits. */
export function reviewBlockers({ tasks, dependencies = [], analysis, today }: ReportInput): BlockerFinding[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const findings: BlockerFinding[] = [];

  // Work waiting on unfinished work: grouped by the task that holds things up.
  const holding = new Map<number, Task[]>();
  for (const d of dependencies) {
    const blocker = byId.get(d.blocker.id);
    const blocked = byId.get(d.blocked.id);
    if (!blocker || !blocked || blocker.status === 'DONE' || blocked.status === 'DONE') continue;
    holding.set(blocker.id, [...(holding.get(blocker.id) ?? []), blocked]);
  }
  // Waiting on unfinished work is normal sequencing; it's a blocker when the task it waits on is
  // late, has no owner, sits in review, or is due after the work that waits on it.
  const isProblem = (blocker: Task, waiting: Task[]) =>
    (blocker.dueDate !== null && blocker.dueDate < today) ||
    blocker.assignee === null ||
    blocker.status === 'IN_REVIEW' ||
    waiting.some((w) => w.dueDate !== null && blocker.dueDate !== null && blocker.dueDate > w.dueDate);
  const holders = [...holding.entries()]
    .map(([id, waiting]) => ({ blocker: byId.get(id)!, waiting }))
    .filter((h) => isProblem(h.blocker, h.waiting))
    .sort((a, b) => Number(b.blocker.overdue) - Number(a.blocker.overdue) || b.waiting.length - a.waiting.length);
  for (const { blocker, waiting } of holders.slice(0, 5)) {
    const owner = blocker.assignee ? firstName(blocker.assignee.name) : null;
    const late = blocker.dueDate && blocker.dueDate < today ? ` and ${plural(daysBetween(blocker.dueDate, today), 'day')} overdue` : '';
    findings.push({
      id: `blocked-${blocker.id}`,
      kind: 'blocked',
      title: `${blocker.key} holds up ${listKeys(waiting, 3)}`,
      detail: `${blocker.key} “${blocker.title}” is ${blocker.status === 'TODO' ? 'not started' : blocker.status === 'IN_REVIEW' ? 'waiting for review' : 'in progress'}${late}${owner ? `, with ${owner}` : ', with no owner'}. ${plural(waiting.length, 'task')} can’t finish before it${
        waiting.some((w) => w.dueDate !== null && blocker.dueDate !== null && blocker.dueDate > w.dueDate) ? ', and it’s due after work that waits on it' : ''
      }.`,
      suggestion: !owner
        ? `Give ${blocker.key} an owner first: nothing moves until someone has it.`
        : blocker.status === 'IN_REVIEW'
          ? `A reviewer could look at ${blocker.key} next; approving it frees ${plural(waiting.length, 'task')}.`
          : `Check with ${owner} whether ${blocker.key} needs help, or whether part of it can be split off so the waiting work can start.`,
      tasks: [ref(blocker), ...waiting.slice(0, 4).map(ref)],
    });
  }

  // Overdue work that isn't already listed as a blocker.
  const listed = new Set(holders.map((h) => h.blocker.id));
  const late = tasks.filter((t) => isOpen(t) && t.dueDate !== null && t.dueDate < today && !listed.has(t.id)).sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''));
  // Late work that's already submitted needs a review decision, not a new date or less scope.
  const lateReviews = late.filter((t) => t.status === 'IN_REVIEW');
  const overdue = late.filter((t) => t.status !== 'IN_REVIEW');
  if (lateReviews.length) {
    findings.push({
      id: 'overdue-review',
      kind: 'review',
      title: `${plural(lateReviews.length, 'task')} past due and waiting for review`,
      detail: lateReviews
        .slice(0, 4)
        .map((t) => `${t.key} (${plural(daysBetween(t.dueDate!, today), 'day')} past due${t.assignee ? `, submitted by ${firstName(t.assignee.name)}` : ''})`)
        .join('; ') + (lateReviews.length > 4 ? `; and ${lateReviews.length - 4} more.` : '.'),
      suggestion: 'Open the review: a manager or the owner can approve it or request changes. The work is submitted, so a new date or less scope won’t help; the decision will.',
      tasks: lateReviews.slice(0, 6).map(ref),
    });
  }
  if (overdue.length) {
    findings.push({
      id: 'overdue',
      kind: 'overdue',
      title: `${plural(overdue.length, 'task')} past due`,
      detail: overdue
        .slice(0, 4)
        .map((t) => `${t.key} (${plural(daysBetween(t.dueDate!, today), 'day')}${t.assignee ? `, ${firstName(t.assignee.name)}` : ', no owner'})`)
        .join('; ') + (overdue.length > 4 ? `; and ${overdue.length - 4} more.` : '.'),
      suggestion: 'Agree a realistic new date with each owner, or cut scope. I won’t change due dates myself.',
      tasks: overdue.slice(0, 6).map(ref),
    });
  }

  // Missing owners, soonest due first.
  const unowned = tasks.filter((t) => isOpen(t) && t.assignee === null).sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'));
  if (unowned.length) {
    const soon = unowned.filter((t) => t.dueDate !== null && daysBetween(today, t.dueDate) <= 7);
    findings.push({
      id: 'owners',
      kind: 'owner',
      title: `${plural(unowned.length, 'open task')} without an owner`,
      detail: `${listKeys(unowned)}${soon.length ? `. ${plural(soon.length, 'is', 'are')} due within a week.` : '.'}`,
      suggestion: 'Decide who takes them: a manager can give each one an owner on its task page, or a member can pick one up. I won’t assign people for you.',
      tasks: unowned.slice(0, 6).map(ref),
    });
  }

  // Long review waits, from the analysis (recorded from status changes).
  const review = fact(analysis, 'review');
  if (review && (review.tone === 'warning' || review.tone === 'danger')) {
    const refs = review.taskIds.map((id) => byId.get(id)).filter((t): t is Task => !!t);
    findings.push({ id: 'review', kind: 'review', title: review.title, detail: review.detail, suggestion: 'A manager or the owner can review these; the submitter can’t approve their own work.', tasks: refs.slice(0, 6).map(ref) });
  }
  return findings;
}

// -------------------------------------------------------------------------------- agenda

/** "Draft a meeting agenda": a short check-in built from the records, to edit before sharing. */
export function meetingAgenda(input: ReportInput): string {
  const { project, tasks, milestones = [], today } = input;
  const findings = reviewBlockers(input);
  const lines: string[] = [`${project.name}: team check-in, ${shortDate(today)}`, ''];
  let n = 1;
  const item = (heading: string, body: string[]) => {
    lines.push(`${n}. ${heading}`);
    body.forEach((b) => lines.push(`   - ${b}`));
    n++;
  };
  const done = tasks.filter((t) => t.status === 'DONE').length;
  item('Where we are (5 min)', [`${done} of ${plural(tasks.length, 'task')} approved; ${tasks.filter((t) => t.status === 'IN_PROGRESS').length} in progress; ${tasks.filter((t) => t.status === 'IN_REVIEW').length} waiting for review.`]);
  const blocked = findings.filter((f) => f.kind === 'blocked');
  if (blocked.length) item('Blockers (10 min)', blocked.map((f) => `${f.title}. ${f.suggestion}`));
  const overdue = findings.find((f) => f.kind === 'overdue');
  if (overdue) item('Overdue work (5 min)', [overdue.detail, 'Agree new dates or cut scope.']);
  const review = findings.find((f) => f.kind === 'review');
  if (review) item('Reviews waiting (5 min)', [review.detail]);
  const owners = findings.find((f) => f.kind === 'owner');
  if (owners) item('Work without an owner (5 min)', [owners.detail, 'Decide who takes each one.']);
  const next = [...milestones].filter((m) => !m.completed).sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
  if (next) item('Next milestone (5 min)', [`“${next.name}”, due ${shortDate(next.dueDate)}: ${next.doneCount} of ${plural(next.taskCount, 'task')} approved.`]);
  item('Anything else, and who does what next (5 min)', ['Each person: one thing they’ll finish before the next check-in.']);
  lines.push('', 'Drafted by Flurry from the project’s records. Edit it before you send it.');
  return lines.join('\n');
}
