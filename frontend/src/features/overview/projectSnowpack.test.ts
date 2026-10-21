import { describe, expect, it } from 'vitest';
import { projectSnowpack } from './projectSnowpack';

const task = (id: number, status: 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'DONE', dueDate: string | null = null, who: string | null = 'Ann Lee') => ({
  id,
  key: `ABC-${id}`,
  title: `Task ${id}`,
  status,
  dueDate,
  assignee: who ? { name: who } : null,
});
const dep = (blocker: { id: number; status: string }, blocked: { id: number; status: string }) => ({ blocker, blocked }) as never;

describe('projectSnowpack', () => {
  const tasks = [
    task(1, 'DONE', '2026-09-01'),
    task(2, 'IN_PROGRESS', '2026-10-03'),
    task(3, 'TODO', '2026-10-20'),
    task(4, 'TODO', null, null),
    task(5, 'IN_REVIEW', '2026-10-05'),
  ];
  const deps = [
    dep({ id: 2, status: 'IN_PROGRESS' }, { id: 3, status: 'TODO' }),
    dep({ id: 3, status: 'TODO' }, { id: 4, status: 'TODO' }),
    dep({ id: 1, status: 'DONE' }, { id: 2, status: 'IN_PROGRESS' }),
  ];
  const s = projectSnowpack(tasks, deps, '2026-10-06');

  it('puts every task in its layer', () => {
    expect(s.counts).toEqual({ done: 1, review: 1, progress: 1, todo: 2 });
    expect(s.tasks.map((t) => t.layer)).toEqual(['done', 'progress', 'todo', 'todo', 'review']);
  });

  it('counts days late only for open work past its due date', () => {
    expect(s.tasks.find((t) => t.key === 'ABC-2')!.late).toBe(3);
    expect(s.tasks.find((t) => t.key === 'ABC-5')!.late).toBe(1);
    expect(s.tasks.find((t) => t.key === 'ABC-1')!.late).toBe(0); // approved, so never late
    expect(s.late).toBe(2);
  });

  it('follows what waits on what, through other tasks, and ignores finished work', () => {
    expect(s.tasks.find((t) => t.key === 'ABC-2')!.holdsUp).toEqual(['ABC-3', 'ABC-4']);
    expect(s.tasks.find((t) => t.key === 'ABC-1')!.holdsUp).toEqual([]);
  });

  it('names the weak layer: the late task holding the most work up', () => {
    expect(s.weak?.key).toBe('ABC-2');
  });

  it('keeps who owns each task, or says nobody does', () => {
    expect(s.tasks.find((t) => t.key === 'ABC-4')!.owner).toBeNull();
    expect(s.tasks.find((t) => t.key === 'ABC-3')!.owner).toBe('Ann Lee');
  });

  it('has no weak layer when nothing late holds work up', () => {
    expect(projectSnowpack([task(1, 'TODO', '2026-10-01')], [], '2026-10-06').weak).toBeNull();
  });
});
