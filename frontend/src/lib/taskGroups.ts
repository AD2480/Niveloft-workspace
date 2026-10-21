import type { Task, UserSummary } from '@/api/types';
import { PRIORITY_LABEL, PRIORITY_RANK, PRIORITIES } from './constants';
import { addDaysIso } from './dates';

export type GroupBy = 'person' | 'due' | 'priority';

export interface TaskGroup {
  key: string;
  label: string;
  tasks: Task[];
  /** Set when grouping by person (null = unassigned). */
  user?: UserSummary | null;
  tone?: 'danger' | 'warning';
}

const keyNumber = (key: string) => Number(key.slice(key.lastIndexOf('-') + 1)) || 0;

/** One fixed order everywhere: soonest due first (no date last), then higher priority, then key. */
export function compareTasks(a: Task, b: Task): number {
  if (a.dueDate !== b.dueDate) {
    if (a.dueDate === null) return 1;
    if (b.dueDate === null) return -1;
    return a.dueDate < b.dueDate ? -1 : 1;
  }
  const p = PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority];
  if (p) return p;
  return keyNumber(a.key) - keyNumber(b.key);
}

const DUE_BUCKETS = [
  { key: 'overdue', label: 'Overdue', tone: 'danger' as const },
  { key: 'today', label: 'Due today', tone: 'warning' as const },
  { key: 'week', label: 'Next 7 days' },
  { key: 'later', label: 'Later' },
  { key: 'earlier', label: 'Earlier (done)' },
  { key: 'none', label: 'No due date' },
];

function dueBucket(t: Task, today: string): string {
  if (!t.dueDate) return 'none';
  if (t.dueDate < today) return t.status === 'DONE' ? 'earlier' : 'overdue';
  if (t.dueDate === today) return 'today';
  return t.dueDate <= addDaysIso(today, 7) ? 'week' : 'later';
}

/**
 * Splits tasks into tidy groups, always in the same order: people alphabetically (unassigned
 * last), due-date buckets from most urgent, or priority from Urgent down. Empty groups are left out.
 */
export function groupTasks(tasks: readonly Task[], by: GroupBy, today: string): TaskGroup[] {
  const sorted = [...tasks].sort(compareTasks);
  if (by === 'priority') {
    return PRIORITIES.map((p) => ({ key: p, label: PRIORITY_LABEL[p], tasks: sorted.filter((t) => t.priority === p) })).filter((g) => g.tasks.length);
  }
  if (by === 'due') {
    return DUE_BUCKETS.map((b) => ({ key: b.key, label: b.label, tone: b.tone, tasks: sorted.filter((t) => dueBucket(t, today) === b.key) })).filter((g) => g.tasks.length);
  }
  const people = new Map<number, UserSummary>();
  for (const t of sorted) if (t.assignee) people.set(t.assignee.id, t.assignee);
  const groups: TaskGroup[] = [...people.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((u) => ({ key: `u${u.id}`, label: u.name, user: u, tasks: sorted.filter((t) => t.assignee?.id === u.id) }));
  const nobody = sorted.filter((t) => !t.assignee);
  if (nobody.length) groups.push({ key: 'none', label: 'Unassigned', user: null, tasks: nobody });
  return groups;
}
