import { describe, expect, it } from 'vitest';
import type { Task } from '@/api/types';
import { compareTasks, groupTasks } from './taskGroups';

const user = (id: number, name: string) => ({ id, name, email: `${id}@x.dev`, avatarColor: '#000' });
const task = (n: number, over: Partial<Task>): Task =>
  ({ id: n, key: `WEB-${n}`, title: `Task ${n}`, status: 'TODO', priority: 'MEDIUM', assignee: null, dueDate: null, ...over }) as Task;

const TODAY = '2026-09-27';
const tasks = [
  task(1, { assignee: user(2, 'Priya'), dueDate: '2026-10-20' }),
  task(2, { assignee: user(1, 'Aarav'), dueDate: '2026-09-20' }),
  task(3, { dueDate: '2026-09-27', priority: 'URGENT' }),
  task(4, { assignee: user(2, 'Priya'), dueDate: '2026-09-30', priority: 'HIGH' }),
  task(5, { assignee: user(1, 'Aarav') }),
  task(6, { assignee: user(1, 'Aarav'), dueDate: '2026-09-10', status: 'DONE' }),
];

describe('compareTasks', () => {
  it('orders by due date (none last), then priority, then key number', () => {
    const a = task(10, { dueDate: '2026-10-01', priority: 'LOW' });
    const b = task(2, { dueDate: '2026-10-01', priority: 'HIGH' });
    const c = task(3, { dueDate: null, priority: 'URGENT' });
    expect([a, c, b].sort(compareTasks).map((t) => t.key)).toEqual(['WEB-2', 'WEB-10', 'WEB-3']);
    expect([task(12, {}), task(9, {})].sort(compareTasks).map((t) => t.key)).toEqual(['WEB-9', 'WEB-12']);
  });
});

describe('groupTasks', () => {
  it('groups people alphabetically with unassigned last, each sorted by due date', () => {
    const g = groupTasks(tasks, 'person', TODAY);
    expect(g.map((x) => x.label)).toEqual(['Aarav', 'Priya', 'Unassigned']);
    expect(g[0].tasks.map((t) => t.key)).toEqual(['WEB-6', 'WEB-2', 'WEB-5']);
    expect(g[1].tasks.map((t) => t.key)).toEqual(['WEB-4', 'WEB-1']);
  });

  it('buckets by due date from most urgent and leaves out empty buckets', () => {
    const g = groupTasks(tasks, 'due', TODAY);
    expect(g.map((x) => x.key)).toEqual(['overdue', 'today', 'week', 'later', 'earlier', 'none']);
    expect(g[0].tasks.map((t) => t.key)).toEqual(['WEB-2']);
    expect(g[0].tone).toBe('danger');
    expect(g[4].tasks.map((t) => t.key)).toEqual(['WEB-6']);
    expect(groupTasks([tasks[0]], 'due', TODAY).map((x) => x.key)).toEqual(['later']);
  });

  it('groups by priority from Urgent down', () => {
    expect(groupTasks(tasks, 'priority', TODAY).map((x) => x.label)).toEqual(['Urgent', 'High', 'Medium']);
  });
});
