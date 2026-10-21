import { describe, expect, it } from 'vitest';
import { dateRange, deadlineWords, effortText } from './forecastText';

// Model day 0 is 1 Oct 2026 (local midnight).
const ORIGIN = new Date(2026, 9, 1).getTime();

describe('forecast wording', () => {
  it('writes date ranges compactly', () => {
    expect(dateRange(ORIGIN, { p10: 7, p90: 10 })).toBe('8–11 Oct');
    expect(dateRange(ORIGIN, { p10: 29, p90: 34 })).toBe('30 Oct – 4 Nov');
    expect(dateRange(ORIGIN, { p10: 5.2, p90: 5.8 })).toBe('6 Oct');
  });

  it('writes small effort in hours and larger effort in working days with hours', () => {
    expect(effortText({ p10: 1.5, p90: 2.2 })).toBe('12–18 hours');
    expect(effortText({ p10: 12, p90: 18 })).toBe('12–18 working days (about 96–144 hours)');
  });

  it('says how likely the deadline is, and when there is none', () => {
    expect(deadlineWords(0.84)).toEqual({ text: '84% chance of making the deadline', tone: 'success' });
    expect(deadlineWords(0.3).tone).toBe('danger');
    expect(deadlineWords(null).text).toBe('No deadline set');
  });
});
