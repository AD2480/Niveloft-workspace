import { describe, expect, it } from 'vitest';
import { ONBOARDING_SAMPLE } from '../sampleProject';
import { sampleSnowpack } from './sampleSnowpack';

describe('the sample project as a snowpack', () => {
  const s = sampleSnowpack(ONBOARDING_SAMPLE);

  it('puts every task in its layer, from the records', () => {
    expect(s.tasks).toHaveLength(17);
    expect(s.counts).toEqual({ done: 6, review: 1, progress: 4, todo: 6 });
    expect(s.tasks.find((t) => t.key === 'ONB-1')?.layer).toBe('done');
    expect(s.tasks.find((t) => t.key === 'ONB-7')?.layer).toBe('review');
    expect(s.tasks.find((t) => t.key === 'ONB-9')?.layer).toBe('progress');
    expect(s.tasks.find((t) => t.key === 'ONB-17')?.layer).toBe('todo');
  });

  it('finds the weak layer: the late task holding the most work up', () => {
    expect(s.weak?.key).toBe('ONB-9');
    expect(s.weak?.late).toBe(2);
    // ONB-10 waits on it, and ONB-14 and ONB-17 wait on ONB-10.
    expect(s.weak?.holdsUp).toEqual(['ONB-10', 'ONB-14', 'ONB-17']);
  });

  it('never counts finished work as late or held up', () => {
    for (const t of s.tasks.filter((x) => x.layer === 'done')) {
      expect(t.late).toBe(0);
      expect(t.holdsUp).toEqual([]);
    }
  });

  it('names the work nobody owns yet', () => {
    expect(s.unowned).toEqual(['ONB-16', 'ONB-17']);
    expect(s.people).toBe(6);
  });
});
