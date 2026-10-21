import { describe, expect, it } from 'vitest';
import { addWorkingDays, applyTweaks, compareOutcomes, isWeekday, nextWorkingDay, schedule, workingDaysBetween, type PlanInput, type PlanTask } from './scheduler';

// 2026-09-28 is a Monday.
const MON = '2026-09-28';
const task = (id: number, over: Partial<PlanTask> = {}): PlanTask => ({
  id,
  key: `T-${id}`,
  title: `Task ${id}`,
  status: 'TODO',
  priority: 'MEDIUM',
  assigneeId: 1,
  dueDate: null,
  estimateDays: 2,
  startedOn: null,
  milestoneId: null,
  ...over,
});

describe('working days', () => {
  it('skips weekends', () => {
    expect(isWeekday('2026-10-03')).toBe(false); // Saturday
    expect(nextWorkingDay('2026-10-03')).toBe('2026-10-05');
    expect(addWorkingDays(MON, 1)).toBe(MON);
    expect(addWorkingDays(MON, 5)).toBe('2026-10-02');
    expect(addWorkingDays(MON, 6)).toBe('2026-10-05');
    expect(workingDaysBetween(MON, '2026-10-05')).toBe(5);
    expect(workingDaysBetween('2026-10-05', MON)).toBe(-5);
    expect(workingDaysBetween(MON, MON)).toBe(0);
  });
});

describe('schedule', () => {
  it('runs one task at a time per person, in priority order', () => {
    const input: PlanInput = { today: MON, tasks: [task(1), task(2, { priority: 'URGENT' })], dependencies: [] };
    const out = schedule(input);
    expect(out.scheduled.get(2)!.start).toBe(MON);
    expect(out.scheduled.get(2)!.finish).toBe('2026-09-29');
    expect(out.scheduled.get(1)!.start).toBe('2026-09-30');
    expect(out.scheduled.get(1)!.finish).toBe('2026-10-01');
    expect(out.finish).toBe('2026-10-01');
  });

  it('starts a task the working day after its blockers finish', () => {
    const input: PlanInput = {
      today: MON,
      tasks: [task(1, { assigneeId: 1, estimateDays: 5 }), task(2, { assigneeId: 2, estimateDays: 1, priority: 'URGENT' })],
      dependencies: [{ blockerId: 1, blockedId: 2 }],
    };
    const s = schedule(input).scheduled.get(2)!;
    expect(s.start).toBe('2026-10-05');
    expect(s.drivenBy).toBe(1);
    expect(s.flags).toContain('WAITING_ON_BLOCKER');
  });

  it('flags missing estimates and late work, and is deterministic', () => {
    const input: PlanInput = { today: MON, tasks: [task(1, { estimateDays: null, dueDate: MON }), task(2, { dueDate: '2026-09-29' })], dependencies: [] };
    const a = schedule(input);
    const b = schedule(input);
    expect([...a.scheduled.values()]).toEqual([...b.scheduled.values()]);
    expect(a.assumed).toEqual([1]);
    expect(a.scheduled.get(1)!.estimateUsed).toBe(1);
    expect(a.late).toEqual([2]);
    expect(a.scheduled.get(2)!.slipDays).toBe(1);
  });

  it('counts work already done on in-progress tasks and treats review as finishing today', () => {
    const input: PlanInput = {
      today: MON,
      tasks: [task(1, { status: 'IN_PROGRESS', startedOn: '2026-09-23', estimateDays: 5 }), task(2, { status: 'IN_REVIEW', assigneeId: 2 })],
      dependencies: [],
    };
    const out = schedule(input);
    expect(out.scheduled.get(1)!.remainingDays).toBe(2);
    expect(out.scheduled.get(2)!.finish).toBe(MON);
    expect(out.scheduled.get(2)!.flags).toContain('AWAITING_REVIEW');
  });

  it('what-if: reassigning and time off move dates, and the comparison explains it', () => {
    const base: PlanInput = { today: MON, tasks: [task(1, { estimateDays: 3, priority: 'HIGH' }), task(2, { estimateDays: 3, dueDate: '2026-10-01' })], dependencies: [] };
    const before = schedule(base);
    expect(before.late).toEqual([2]);
    const after = schedule(applyTweaks(base, [{ kind: 'reassign', taskId: 2, assigneeId: 2 }]));
    const diff = compareOutcomes(before, after);
    expect(diff.noLongerLate).toEqual([2]);
    expect(diff.finishDelta).toBe(-3);

    const off = schedule(applyTweaks(base, [{ kind: 'timeOff', userId: 1, from: MON, to: '2026-09-29' }]));
    expect(off.scheduled.get(1)!.start).toBe('2026-09-30');
    expect(base.tasks[1].assigneeId).toBe(1); // baseline untouched
  });
});
