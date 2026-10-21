import { describe, expect, it } from 'vitest';
import { NO_CHANGES, sampleForecast } from './sampleForecast';

const NOW = new Date(2026, 8, 26, 15, 0, 0);

describe('the front page’s forecast playground', () => {
  const base = sampleForecast(NO_CHANGES, NOW);

  it('forecasts the sample with the app’s own engine, and names the blocker', () => {
    expect(base.forecast.project.finish).not.toBeNull();
    expect(base.forecast.learnedFrom).toBeGreaterThan(0);
    expect(base.blocker?.key).toBe('ONB-10');
  });

  it('moves the window when the visitor changes an assumption', () => {
    const help = sampleForecast({ ...NO_CHANGES, ananyaTakesOnb10: true }, NOW);
    const half = sampleForecast({ ...NO_CHANGES, priyaHalfTime: true }, NOW);
    const more = sampleForecast({ ...NO_CHANGES, addLocalisation: true }, NOW);
    const p50 = (f: typeof base) => f.forecast.project.finish!.p50;
    expect(p50(help)).toBeLessThan(p50(base));
    expect(p50(half)).toBeGreaterThan(p50(base));
    expect(p50(more)).toBeGreaterThan(p50(base));
    expect(more.data.tasks).toHaveLength(base.data.tasks.length + 1);
  });
});
