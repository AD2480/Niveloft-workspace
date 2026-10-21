import { describe, expect, it } from 'vitest';
import { calculateExpectedProgress, calculateHealth } from './health';

const today = new Date(2026, 8, 25); // 25 Sep 2026
const base = { projectStatus: 'ACTIVE' as const, startDate: '2026-09-01', deadline: '2026-12-01', today };

describe('calculateExpectedProgress', () => {
  it('is proportional to elapsed time', () => {
    expect(calculateExpectedProgress('2026-09-15', '2026-10-05', today)).toBe(50);
  });
  it('is null without a deadline and clamps to 0–100', () => {
    expect(calculateExpectedProgress('2026-09-01', null, today)).toBeNull();
    expect(calculateExpectedProgress('2026-10-01', '2026-11-01', today)).toBe(0);
    expect(calculateExpectedProgress('2026-01-01', '2026-02-01', today)).toBe(100);
  });
});

describe('calculateHealth', () => {
  it('reports NOT_STARTED without tasks', () => {
    expect(calculateHealth({ ...base, total: 0, done: 0, overdue: 0 }).health).toBe('NOT_STARTED');
  });

  it('reports COMPLETED when every task is done or the project is completed', () => {
    expect(calculateHealth({ ...base, total: 4, done: 4, overdue: 0 }).health).toBe('COMPLETED');
    expect(calculateHealth({ ...base, projectStatus: 'COMPLETED', total: 4, done: 1, overdue: 1 }).health).toBe('COMPLETED');
  });

  it('is ON_TRACK when progress keeps pace and nothing is overdue', () => {
    // expected ≈ 26% (24 of 91 days)
    const r = calculateHealth({ ...base, total: 10, done: 3, overdue: 0 });
    expect(r.health).toBe('ON_TRACK');
    expect(r.progress).toBe(30);
  });

  it('is AT_RISK with a single overdue task', () => {
    const r = calculateHealth({ ...base, total: 10, done: 3, overdue: 1 });
    expect(r.health).toBe('AT_RISK');
    expect(r.reasons.join(' ')).toMatch(/1 task is overdue/);
  });

  it('is AT_RISK when 10–25 points behind schedule', () => {
    // expected 26%, progress 10%
    expect(calculateHealth({ ...base, total: 10, done: 1, overdue: 0 }).health).toBe('AT_RISK');
  });

  it('is AT_RISK inside the deadline window below 80%', () => {
    const r = calculateHealth({ ...base, startDate: '2026-09-20', deadline: '2026-09-30', total: 10, done: 7, overdue: 0 });
    expect(r.health).toBe('AT_RISK');
  });

  it('is OFF_TRACK when more than 25 points behind', () => {
    const r = calculateHealth({ ...base, startDate: '2026-08-01', deadline: '2026-10-01', total: 10, done: 2, overdue: 0 });
    expect(r.health).toBe('OFF_TRACK');
  });

  it('is OFF_TRACK when a quarter of open tasks are overdue', () => {
    expect(calculateHealth({ ...base, total: 10, done: 2, overdue: 2 }).health).toBe('OFF_TRACK');
  });

  it('is OFF_TRACK after the deadline with open work', () => {
    const r = calculateHealth({ ...base, startDate: '2026-08-01', deadline: '2026-09-20', total: 5, done: 4, overdue: 0 });
    expect(r.health).toBe('OFF_TRACK');
    expect(r.reasons[0]).toMatch(/deadline passed 5 days ago/);
  });
});
