/**
 * "My next task", from Flurry's menu: the one piece of your open work to pick up now, with the
 * reason, worked out from the records (no AI). Work that can't start yet (it waits on unfinished
 * tasks) is skipped and said so; work waiting for a review isn't yours to move.
 */
import type { Dependency, Task } from '@/api/types';
import { suggestNext } from '@/lib/assistantIntents';

export interface NextTaskAnswer {
  /** The task to open, if there's one to pick up. */
  task: Task | null;
  /** A short heading for Flurry's note. */
  title: string;
  /** One or two sentences. */
  text: string;
}

export function nextTaskFor(mine: readonly Task[], dependencies: readonly Dependency[], today: Date = new Date()): NextTaskAnswer {
  const waitingOn = new Map<number, string[]>();
  for (const d of dependencies) {
    if (d.blocker.status === 'DONE') continue;
    waitingOn.set(d.blocked.id, [...(waitingOn.get(d.blocked.id) ?? []), d.blocker.key]);
  }
  const open = mine.filter((t) => t.status === 'TODO' || t.status === 'IN_PROGRESS');
  // Work already in progress stays pickable; work not started can't start before what it waits on is approved.
  const blocked = open.filter((t) => t.status === 'TODO' && waitingOn.has(t.id));
  const ranked = suggestNext(open.filter((t) => !blocked.includes(t)), today);
  const inReview = mine.filter((t) => t.status === 'IN_REVIEW');
  if (ranked.length) {
    const { task, reason } = ranked[0];
    const also = blocked.length ? ` ${blocked.length === 1 ? `${blocked[0].key} waits on ${waitingOn.get(blocked[0].id)!.join(', ')}` : `${blocked.length} of your tasks wait on others`}, so it isn’t suggested yet.` : '';
    return { task, title: `Next: ${task.key}`, text: `“${task.title}”: ${reason}.${also}` };
  }
  if (blocked.length) {
    const first = blocked[0];
    return {
      task: null,
      title: 'Your open work is waiting',
      text: `${blocked.map((t) => `${t.key} waits on ${waitingOn.get(t.id)!.join(', ')}`).slice(0, 2).join('; ')}. Nothing of yours can start until ${blocked.length === 1 && waitingOn.get(first.id)!.length === 1 ? 'that is' : 'those are'} approved.`,
    };
  }
  if (inReview.length) {
    return { task: null, title: 'Waiting for reviews', text: `Everything assigned to you is waiting for a reviewer: ${inReview.map((t) => t.key).slice(0, 4).join(', ')}.` };
  }
  return { task: null, title: 'Nothing assigned to you', text: 'Nothing open is assigned to you right now.' };
}
