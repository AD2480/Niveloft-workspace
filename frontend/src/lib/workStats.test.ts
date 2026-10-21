import { describe, expect, it } from 'vitest';
import { cycleStats, progressMeasures } from './workStats';

const done = (start: string, end: string) => ({ status: 'DONE' as const, startedAt: `${start}T09:00:00`, completedAt: `${end}T09:00:00` });

describe('cycle time', () => {
  it('reports the median, the middle half and the sample size, not a lone average', () => {
    const s = cycleStats([done('2026-09-01', '2026-09-03'), done('2026-09-01', '2026-09-05'), done('2026-09-01', '2026-09-06'), done('2026-09-01', '2026-09-21'), { status: 'TODO', startedAt: null, completedAt: null }]);
    expect(s.n).toBe(4);
    expect(s.median).toBe(4.5);
    expect(s.p25).toBe(3.5);
    expect(s.p75).toBe(8.8);
    expect(s.min).toBe(2);
    expect(s.max).toBe(20);
  });

  it('refuses to summarise fewer than three', () => {
    const s = cycleStats([done('2026-09-01', '2026-09-03')]);
    expect(s.n).toBe(1);
    expect(s.median).toBeNull();
  });
});

describe('progress', () => {
  it('counts tasks, and weights by estimates only when most tasks have one', () => {
    const tasks = [
      { status: 'DONE' as const, estimateDays: 1 },
      { status: 'TODO' as const, estimateDays: 8 },
      { status: 'TODO' as const, estimateDays: 1 },
    ];
    const m = progressMeasures(tasks);
    expect(m.tasksDone).toBe(1);
    expect(m.effortShare).toBeCloseTo(0.1, 5);
    expect(progressMeasures([...tasks, { status: 'TODO', estimateDays: null }, { status: 'TODO', estimateDays: null }]).effortShare).toBeNull();
  });
});
