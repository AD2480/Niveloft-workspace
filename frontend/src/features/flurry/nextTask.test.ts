import { describe, expect, it } from 'vitest';
import type { Dependency, Task } from '@/api/types';
import { nextTaskFor } from './nextTask';

const task = (id: number, key: string, status: Task['status'], due: string | null, priority: Task['priority'] = 'MEDIUM'): Task =>
  ({ id, key, title: `Task ${key}`, status, priority, dueDate: due, projectId: 1 }) as unknown as Task;
const dep = (blocked: Task, blocker: Task): Dependency =>
  ({ id: blocked.id * 100 + blocker.id, projectId: 1, blocked: { id: blocked.id, key: blocked.key, status: blocked.status }, blocker: { id: blocker.id, key: blocker.key, status: blocker.status } }) as unknown as Dependency;
const today = new Date('2026-10-05T10:00:00');

describe('my next task', () => {
  it('picks overdue work first, then work in progress, with the reason', () => {
    const a = task(1, 'ONB-12', 'IN_PROGRESS', '2026-10-12');
    const b = task(2, 'ONB-15', 'TODO', '2026-10-03');
    const r = nextTaskFor([a, b], [], today);
    expect(r.task?.key).toBe('ONB-15');
    expect(r.title).toBe('Next: ONB-15');
    expect(r.text).toContain('overdue by 2 days');
  });
  it('skips work that can’t start yet, and says so', () => {
    const waits = task(1, 'ONB-10', 'TODO', '2026-10-06', 'URGENT');
    const other = task(2, 'ONB-11', 'TODO', '2026-10-15');
    const blocker = task(9, 'ONB-9', 'IN_PROGRESS', '2026-10-03');
    const r = nextTaskFor([waits, other], [dep(waits, blocker)], today);
    expect(r.task?.key).toBe('ONB-11');
    expect(r.text).toContain('ONB-10 waits on ONB-9');
    const none = nextTaskFor([waits], [dep(waits, blocker)], today);
    expect(none.task).toBeNull();
    expect(none.text).toContain('ONB-10 waits on ONB-9');
  });
  it('doesn’t count approved blockers, and never offers work in review', () => {
    const waits = task(1, 'ONB-10', 'TODO', '2026-10-09');
    const done = task(9, 'ONB-9', 'DONE', '2026-10-03');
    expect(nextTaskFor([waits], [dep(waits, done)], today).task?.key).toBe('ONB-10');
    const review = nextTaskFor([task(3, 'ONB-7', 'IN_REVIEW', '2026-10-04')], [], today);
    expect(review.task).toBeNull();
    expect(review.text).toContain('ONB-7');
    expect(nextTaskFor([], [], today).text).toBe('Nothing open is assigned to you right now.');
  });
});
