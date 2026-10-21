import { describe, expect, it } from 'vitest';
import type { Task } from '@/api/types';
import { sampleProjectData } from '@/features/public/sampleProject';
import { answerAboutTask } from './taskAnswer';

const NOW = new Date(2026, 9, 6, 10);
const TODAY = '2026-10-06';
const data = sampleProjectData(NOW);

describe('answers about one exact task', () => {
  it('corrects the premise: ONB-9 isn’t blocked, it holds others up, and why it’s late isn’t recorded', () => {
    const a = answerAboutTask('ONB-9', 'blocked', data.tasks, data.dependencies, TODAY)!;
    expect(a.title).toBe('ONB-9 isn’t blocked: nothing it waits on is open. ONB-9 is in progress, 2 days late, and it’s holding up ONB-10 (and through it, ONB-14 and ONB-17).');
    expect(a.recorded.join(' ')).toContain('It waits on ONB-6 (approved).');
    expect(a.unknown).toContain('Why it’s late: the records don’t say.');
    expect(a.next).toBe('Open ONB-9 and check what’s left with Sneha: ONB-10 can’t start until it’s approved.');
  });

  it('keeps the direction straight: what depends on it, and what it waits on', () => {
    expect(answerAboutTask('ONB-9', 'blocks', data.tasks, data.dependencies, TODAY)!.title).toBe('ONB-10 depends on ONB-9, and ONB-14 and ONB-17 through it.');
    const b = answerAboutTask('onb-10', 'blocked', data.tasks, data.dependencies, TODAY)!;
    expect(b.title).toBe('ONB-10 waits on ONB-9, which isn’t approved yet.');
    expect(b.next).toBe('It can’t start until ONB-9 is approved. Look at that task first.');
  });

  it('for work waiting for review, asks for the review, never a new date or less scope', () => {
    const a = answerAboutTask('ONB-7', 'general', data.tasks, data.dependencies, TODAY)!;
    expect(a.title).toBe('ONB-7 is waiting for review, 1 day late.');
    expect(a.next).toContain('Open its review');
    expect(a.next).not.toMatch(/move|reschedul|new date with/i);
    expect(a.unknown).toEqual([]);
  });

  it('says nothing about a task that isn’t in the project', () => {
    expect(answerAboutTask('CCP-8', 'general', data.tasks, data.dependencies, TODAY)).toBeNull();
  });

  it('approved work holds nothing up', () => {
    const tasks: Task[] = data.tasks.map((t) => (t.key === 'ONB-9' ? { ...t, status: 'DONE' } : t));
    expect(answerAboutTask('ONB-9', 'blocks', tasks, data.dependencies, TODAY)!.title).toBe('ONB-9 is approved, so it holds nothing up.');
  });
});
