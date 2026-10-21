import { describe, expect, it } from 'vitest';
import { completionRate, successRate } from '@/features/site/formStats';
import { BUILTIN, CHROME, contenderLabel, pickPair, type Contender } from './contenders';

const server = (name: string): Contender => ({ id: `server:${name}`, label: name, detail: 'On the server' });

describe('arena pairs', () => {
  it('needs two sources, and never pairs one with itself', () => {
    expect(pickPair([BUILTIN])).toBeNull();
    const pool = [BUILTIN, CHROME, server('llama3.2'), server('qwen2.5')];
    for (let k = 0; k < 200; k++) {
      const pair = pickPair(pool)!;
      expect(pair[0].id).not.toBe(pair[1].id);
    }
  });

  it('puts every source in both places over time (no fixed A/B)', () => {
    const pool = [BUILTIN, CHROME];
    const firsts = new Set<string>();
    for (let k = 0; k < 50; k++) firsts.add(pickPair(pool)![0].id);
    expect([...firsts].sort()).toEqual(['builtin', 'chrome']);
  });

  it('names sources, including models that have since gone', () => {
    expect(contenderLabel('builtin')).toBe('Built-in model');
    expect(contenderLabel('chrome')).toBe('Gemini Nano');
    expect(contenderLabel('server:llama3.2:latest')).toBe('llama3.2:latest');
  });
});

describe('form success rates', () => {
  it('divides successes by sends and by views, and says nothing without data', () => {
    expect(successRate({ submits: 10, successes: 9 })).toBeCloseTo(0.9);
    expect(successRate({ submits: 0, successes: 0 })).toBeNull();
    expect(completionRate({ views: 40, successes: 10 })).toBeCloseTo(0.25);
    expect(completionRate({ views: 0, successes: 0 })).toBeNull();
    // Counts from different moments can overlap; a rate never exceeds 100%.
    expect(successRate({ submits: 3, successes: 5 })).toBe(1);
  });
});
