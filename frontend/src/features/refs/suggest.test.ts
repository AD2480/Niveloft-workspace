import { describe, expect, it } from 'vitest';
import type { Member, Task } from '@/api/types';
import { matchPeople, matchTasks, triggerAt } from './suggest';

const member = (id: number, name: string): Member => ({
  id,
  user: { id, name, email: `${id}@x.example`, avatarColor: '#333', jobTitle: null },
  role: 'MEMBER',
  joinedAt: '2026-09-01T00:00:00Z',
  openTaskCount: 0,
});
const task = (id: number, key: string, title: string, updatedAt = '2026-10-01T00:00:00Z'): Task => ({ id, key, title, updatedAt, status: 'TODO', overdue: false }) as Task;

describe('writing suggestions', () => {
  it('notices a mention or a task link being typed before the caret', () => {
    expect(triggerAt('Thanks @pri', 11)).toEqual({ kind: '@', start: 7, query: 'pri' });
    expect(triggerAt('@', 1)).toEqual({ kind: '@', start: 0, query: '' });
    expect(triggerAt('see #onb-1', 10)).toEqual({ kind: '#', start: 4, query: 'onb-1' });
    expect(triggerAt('ask @Priya N', 12)).toEqual({ kind: '@', start: 4, query: 'Priya N' });
    // Not inside a word (an email address), and not once a mention is clearly finished.
    expect(triggerAt('mail me@x', 9)).toBeNull();
    expect(triggerAt('@Priya Nair thanks for this', 27)).toBeNull();
  });

  it('suggests people by the start of any part of their name', () => {
    const people = [member(1, 'Priya Nair'), member(2, 'Rohan Mehta'), member(3, 'Ananya Das')];
    expect(matchPeople(people, 'pr').map((m) => m.user.name)).toEqual(['Priya Nair']);
    expect(matchPeople(people, 'me').map((m) => m.user.name)).toEqual(['Rohan Mehta']);
    expect(matchPeople(people, '')).toHaveLength(3);
    expect(matchPeople(people, 'zz')).toEqual([]);
  });

  it('suggests tasks by key first, then by title, and recent ones when nothing is typed', () => {
    const tasks = [
      task(1, 'ONB-9', 'Passkey sign-in: server API', '2026-10-02T00:00:00Z'),
      task(2, 'ONB-10', 'Connect passkey sign-in', '2026-10-05T00:00:00Z'),
      task(3, 'ONB-1', 'Agree goals'),
    ];
    expect(matchTasks(tasks, 'onb-1').map((t) => t.key)).toEqual(['ONB-10', 'ONB-1']);
    expect(matchTasks(tasks, '9').map((t) => t.key)).toEqual(['ONB-9']);
    expect(matchTasks(tasks, 'passkey').map((t) => t.key)).toEqual(['ONB-9', 'ONB-10']);
    expect(matchTasks(tasks, '').map((t) => t.key)).toEqual(['ONB-10', 'ONB-9', 'ONB-1']);
  });
});
