/**
 * Answers about one exact task ("Why is ONB-9 blocked?", "What depends on ONB-9?", "Tell me about
 * ONB-7"), from the records and nothing else. It answers the question asked, in the right direction
 * (what a task waits on is not what waits on it), corrects a wrong premise gently ("ONB-9 isn't
 * blocked"), keeps what's recorded apart from what isn't, and suggests the move that fits the task's
 * state: a review to make for submitted work, never a new date. No AI; nothing changes.
 */
import type { Dependency, Task } from '@/api/types';
import { daysLate } from '@/features/delivery/deliveryPath';
import { STATUS_LABEL } from '@/lib/constants';
import { formatDate } from '@/lib/dates';

export type TaskAspect = 'blocked' | 'blocks' | 'general';

export interface TaskAnswer {
  task: Task;
  /** One sentence that answers the question. */
  title: string;
  /** What the records show. */
  recorded: string[];
  /** What they don't. */
  unknown: string[];
  /** The move that fits its state. */
  next: string;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const list = (ts: readonly Task[]) => (ts.length <= 3 ? ts.map((t) => t.key).join(', ').replace(/, ([^,]*)$/, ' and $1') : `${ts.slice(0, 3).map((t) => t.key).join(', ')} and ${ts.length - 3} more`);

export function answerAboutTask(key: string, aspect: TaskAspect, tasks: readonly Task[], deps: readonly Dependency[], today: string): TaskAnswer | null {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const task = tasks.find((t) => t.key.toUpperCase() === key.toUpperCase());
  if (!task) return null;
  const open = (t: Task | undefined): t is Task => !!t && t.status !== 'DONE';
  const waitsOn = deps.filter((d) => d.blocked.id === task.id).map((d) => byId.get(d.blocker.id)).filter((t): t is Task => !!t);
  const openWaitsOn = waitsOn.filter(open);
  const direct = deps.filter((d) => d.blocker.id === task.id).map((d) => byId.get(d.blocked.id)).filter(open);
  // Everything downstream that's still open (through other open tasks).
  const downstream: Task[] = [];
  const queue = [...direct];
  while (queue.length) {
    const t = queue.shift()!;
    if (downstream.some((x) => x.id === t.id)) continue;
    downstream.push(t);
    queue.push(...deps.filter((d) => d.blocker.id === t.id).map((d) => byId.get(d.blocked.id)).filter(open));
  }
  const through = downstream.filter((t) => !direct.some((d) => d.id === t.id));
  const late = task.status === 'DONE' ? 0 : daysLate(task.dueDate, today);
  const owner = task.assignee?.name ?? null;

  const state = `${task.key} is ${task.status === 'DONE' ? 'approved' : task.status === 'IN_REVIEW' ? 'waiting for review' : task.status === 'IN_PROGRESS' ? 'in progress' : 'not started'}${late ? `, ${plural(late, 'day')} late` : ''}`;
  const holding = direct.length ? `holding up ${list(direct)}${through.length ? ` (and through ${direct.length === 1 ? 'it' : 'them'}, ${list(through)})` : ''}` : '';

  let title: string;
  if (task.status === 'DONE') title = `${task.key} is approved, so it holds nothing up.`;
  else if (aspect === 'blocked') {
    title = openWaitsOn.length
      ? `${task.key} waits on ${list(openWaitsOn)}, which ${openWaitsOn.length === 1 ? 'isn’t' : 'aren’t'} approved yet.`
      : `${task.key} isn’t blocked: nothing it waits on is open. ${state.charAt(0).toUpperCase()}${state.slice(1)}${holding ? `, and it’s ${holding}` : ''}.`;
  } else if (aspect === 'blocks') {
    title = direct.length ? `${list(direct)} ${direct.length === 1 ? 'depends' : 'depend'} on ${task.key}${through.length ? `, and ${list(through)} through ${direct.length === 1 ? 'it' : 'them'}` : ''}.` : `Nothing open depends on ${task.key}.`;
  } else {
    title = direct.length ? `${task.key} is ${holding}.` : `${state}.`;
  }

  const recorded = [
    `${task.key} “${task.title}”: ${STATUS_LABEL[task.status]}${owner ? `, with ${owner}` : ', with no owner'}${task.dueDate ? `, due ${formatDate(task.dueDate, 'd MMM')}` : ', no due date'}${late ? ` (${plural(late, 'day')} late)` : ''}.`,
    waitsOn.length ? `It waits on ${waitsOn.map((t) => `${t.key} (${t.status === 'DONE' ? 'approved' : STATUS_LABEL[t.status].toLowerCase()})`).join(', ')}.` : 'It doesn’t wait on any other task.',
    direct.length ? `${list(direct)} ${direct.length === 1 ? 'waits' : 'wait'} on it${through.length ? `; ${list(through)} ${through.length === 1 ? 'waits' : 'wait'} on ${direct.length === 1 ? 'that' : 'those'}` : ''}.` : 'Nothing open waits on it.',
  ];
  const unknown: string[] = [];
  if (late && task.status !== 'IN_REVIEW') unknown.push(`Why it’s late: the records don’t say.`);
  if (task.status === 'IN_PROGRESS') unknown.push('How much of it is left: progress inside a task isn’t recorded.');

  let next: string;
  if (task.status === 'DONE') next = 'Nothing to do here.';
  else if (task.status === 'IN_REVIEW') next = `Open its review: a manager or the owner can approve it or request changes. It’s submitted, so a new date or less scope won’t help; the decision will.`;
  else if (openWaitsOn.length && task.status === 'TODO') next = `It can’t start until ${list(openWaitsOn)} ${openWaitsOn.length === 1 ? 'is' : 'are'} approved. Look at ${openWaitsOn.length === 1 ? 'that task' : 'those'} first.`;
  else if (!owner) next = `Give it an owner: nobody is assigned${direct.length ? `, and ${list(direct)} ${direct.length === 1 ? 'waits' : 'wait'} on it` : ''}.`;
  else if (late) next = `Open ${task.key} and check what’s left with ${owner.split(' ')[0]}${direct.length ? `: ${list(direct)} can’t start until it’s approved` : ''}.`;
  else next = `Open ${task.key}${direct.length ? `; finishing it lets ${list(direct)} start` : ''}.`;

  return { task, title, recorded, unknown, next };
}
