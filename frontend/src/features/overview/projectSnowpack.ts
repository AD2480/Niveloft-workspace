/**
 * A project's tasks as a snowpack, for the Overview's block: every task in its layer (approved, in
 * review, in progress, not started), how late each is, what unfinished work waits on it, and the
 * weak layer (the late task holding the most work up). The same reading as the front page's sample,
 * made from the project's own records. Pure, so it's tested.
 */
import type { TaskStatus } from '@/api/types';
import { weakTask, type BlockTask, type LayerKey, type SnowpackData } from '@/three/snowpack';

export interface ProjectSnowpack extends SnowpackData {
  tasks: (BlockTask & { id: number; owner: string | null })[];
  /** Late tasks (open, past their due date). */
  late: number;
}

interface TaskLike {
  id: number;
  key: string;
  title: string;
  status: TaskStatus;
  dueDate: string | null;
  assignee: { name: string } | null;
}

interface DependencyLike {
  blocker: { id: number; status: TaskStatus };
  blocked: { id: number; status: TaskStatus };
}

const LAYER_OF: Record<TaskStatus, LayerKey> = { DONE: 'done', IN_REVIEW: 'review', IN_PROGRESS: 'progress', TODO: 'todo' };

/** Whole days from `a` to `b` (yyyy-MM-dd), by the calendar. */
function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

export function projectSnowpack(tasks: readonly TaskLike[], deps: readonly DependencyLike[], today: string): ProjectSnowpack {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  // Who waits on whom: unfinished work only.
  const waiters = new Map<number, number[]>();
  for (const d of deps) {
    if (d.blocked.status === 'DONE') continue;
    waiters.set(d.blocker.id, [...(waiters.get(d.blocker.id) ?? []), d.blocked.id]);
  }
  const heldUp = (id: number): string[] => {
    const seen = new Set<number>();
    const queue = [...(waiters.get(id) ?? [])];
    while (queue.length) {
      const next = queue.shift()!;
      if (seen.has(next) || next === id) continue;
      const t = byId.get(next);
      if (!t || t.status === 'DONE') continue;
      seen.add(next);
      queue.push(...(waiters.get(next) ?? []));
    }
    return [...seen].map((n) => byId.get(n)!.key);
  };
  const out = tasks.map((t) => {
    const open = t.status !== 'DONE';
    const late = open && t.dueDate !== null && t.dueDate < today ? daysBetween(t.dueDate, today) : 0;
    return {
      id: t.id,
      key: t.key,
      title: t.title,
      layer: LAYER_OF[t.status],
      late,
      holdsUp: open ? heldUp(t.id) : [],
      owner: t.assignee?.name ?? null,
    };
  });
  const counts: Record<LayerKey, number> = { done: 0, review: 0, progress: 0, todo: 0 };
  for (const t of out) counts[t.layer]++;
  return { tasks: out, counts, weak: weakTask(out), late: out.filter((t) => t.late > 0).length };
}
