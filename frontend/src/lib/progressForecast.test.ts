import { describe, expect, it } from 'vitest';
import type { Member, StatusChange, Task } from '@/api/types';
import { buildProjectModel } from '@/three/projectModel';
import { checkRanges, dataQuality, forecastProgress, quantile, seeded } from './progressForecast';

const user = (id: number, name: string) => ({ id, name, email: `${id}@x.dev`, avatarColor: '#000' });
const asha = user(1, 'Asha');
const ben = user(2, 'Ben');
const member = (u: ReturnType<typeof user>, role: Member['role']): Member => ({ id: u.id, user: { ...u, jobTitle: null }, role, joinedAt: '', openTaskCount: 0 });

function task(id: number, patch: Partial<Task>): Task {
  return {
    id, projectId: 1, projectKey: 'T', projectName: 'T', projectColor: '#000', key: `T-${id}`, title: `Task ${id}`, description: null,
    status: 'TODO', priority: 'MEDIUM', assignee: asha, reporter: asha, dueDate: null, milestoneId: null, milestoneName: null, position: id,
    commentCount: 0, submissionCount: 0, overdue: false, createdAt: '2026-09-01T09:00:00', updatedAt: '2026-09-01T09:00:00', startedAt: null,
    completedAt: null, acceptanceCriteria: [], checklist: [], version: 0, estimateDays: 2, ...patch,
  } as Task;
}

/** Asha finished 3 tasks at about twice her estimates; Ben finished 3 on estimate. Each has 2 open. */
function fixture(deadline: string | null = '2026-10-30', dependencies: { blockerId: number; blockedId: number }[] = []) {
  const tasks: Task[] = [];
  const history: StatusChange[] = [];
  let id = 1;
  const finished = (who: typeof asha, startDay: number, days: number) => {
    const start = `2026-09-${String(startDay).padStart(2, '0')}T09:00:00`;
    const review = `2026-09-${String(startDay + days).padStart(2, '0')}T09:00:00`;
    const done = `2026-09-${String(startDay + days).padStart(2, '0')}T17:00:00`;
    tasks.push(task(id, { assignee: who, status: 'DONE', startedAt: start, completedAt: done }));
    history.push({ taskId: id, from: null, to: 'TODO', at: '2026-09-01T09:00:00' }, { taskId: id, from: 'TODO', to: 'IN_PROGRESS', at: start }, { taskId: id, from: 'IN_PROGRESS', to: 'IN_REVIEW', at: review }, { taskId: id, from: 'IN_REVIEW', to: 'DONE', at: done });
    id++;
  };
  finished(asha, 1, 6); finished(asha, 7, 6); finished(asha, 13, 5);
  finished(ben, 1, 3); finished(ben, 4, 3); finished(ben, 8, 3);
  for (const who of [asha, ben]) for (let k = 0; k < 2; k++) {
    tasks.push(task(id, { assignee: who }));
    history.push({ taskId: id, from: null, to: 'TODO', at: '2026-09-01T09:00:00' });
    id++;
  }
  tasks.push(task(id, { assignee: null }));
  history.push({ taskId: id, from: null, to: 'TODO', at: '2026-09-01T09:00:00' });
  const deps = dependencies.map((d, i) => ({ id: i + 1, blocker: { id: d.blockerId, key: `T-${d.blockerId}`, title: '', status: 'TODO' }, blocked: { id: d.blockedId, key: `T-${d.blockedId}`, title: '', status: 'TODO' }, createdAt: '' }));
  const model = buildProjectModel({ now: new Date('2026-09-20T12:00:00'), projectStart: '2026-09-01', deadline, tasks, dependencies: deps as never, milestones: [], history, projection: null });
  return { model, tasks, members: [member(asha, 'MEMBER'), member(ben, 'MANAGER'), member(user(3, 'Cleo'), 'VIEWER')] };
}

describe('progress forecast (Monte Carlo)', () => {
  it('seeded random numbers repeat, and quantiles interpolate', () => {
    const a = seeded(1);
    const b = seeded(1);
    expect([a(), a()]).toEqual([b(), b()]);
    expect(quantile([0, 10], 0.5)).toBe(5);
  });

  it('records history, and predicts slower people to finish later', () => {
    const f = forecastProgress(fixture());
    const asha = f.people.find((p) => p.name === 'Asha')!;
    const ben = f.people.find((p) => p.name === 'Ben')!;
    expect(asha.approved).toBe(3);
    expect(asha.open).toBe(2);
    expect(asha.history[asha.history.length - 1]).toBe(3);
    expect(asha.pace.ratio).toBeGreaterThan(ben.pace.ratio);
    expect(asha.finish!.p50).toBeGreaterThan(ben.finish!.p50);
    expect(asha.finish!.p10).toBeLessThan(asha.finish!.p90);
    // Cumulative approved can only grow, and ends with everything approved.
    const last = asha.forecast[asha.forecast.length - 1];
    expect(last.p50).toBe(5);
    expect(asha.forecast.every((d, i) => i === 0 || d.p50 >= asha.forecast[i - 1].p50)).toBe(true);
  });

  it('is the same every time for the same records', () => {
    expect(forecastProgress(fixture()).project.finish).toEqual(forecastProgress(fixture()).project.finish);
  });

  it('groups by role, lists members without work, and flags unowned work as an assumption', () => {
    const f = forecastProgress(fixture());
    expect(f.roles.map((r) => r.key)).toEqual(['MANAGER', 'MEMBER', 'VIEWER', 'NONE']);
    expect(f.roles.find((r) => r.key === 'VIEWER')!.total).toBe(0);
    expect(f.unassignedOpen).toBe(1);
    // Simulated as if someone started it today, and named so the page can say so.
    expect(f.unownedKeys).toEqual(['T-11']);
    expect(f.people.find((p) => p.name === 'Unassigned')!.finish).not.toBeNull();
    expect(f.people.find((p) => p.name === 'Unassigned')!.effort).toBeNull();
    // The project finishes when its slowest person does.
    expect(f.project.finish!.p50).toBeGreaterThanOrEqual(Math.max(...f.people.filter((p) => p.finish).map((p) => p.finish!.p50)) - 0.001);
  });

  it('gives a chance of meeting the deadline, or none without one', () => {
    const tight = forecastProgress(fixture('2026-09-21'));
    const loose = forecastProgress(fixture('2026-12-31'));
    expect(tight.project.pDeadline!).toBeLessThan(loose.project.pDeadline!);
    expect(loose.project.pDeadline!).toBeGreaterThan(0.9);
    expect(forecastProgress(fixture(null)).project.pDeadline).toBeNull();
  });

  it('waits for dependencies: work that waits on someone else finishes later, and says what it waits on', () => {
    // Ben's open T-9 waits on Asha's open T-7.
    const free = forecastProgress(fixture());
    const held = forecastProgress(fixture('2026-10-30', [{ blockerId: 7, blockedId: 9 }]));
    const benFree = free.people.find((p) => p.name === 'Ben')!;
    const benHeld = held.people.find((p) => p.name === 'Ben')!;
    expect(benHeld.finish!.p50).toBeGreaterThan(benFree.finish!.p50);
    expect(held.tasks[9].p50).toBeGreaterThan(held.tasks[7].p50);
    // He does his other task first rather than sitting idle, but still ends up waiting.
    expect(benHeld.waitingDays).toBeGreaterThan(0);
    expect(benHeld.mainDependency).toMatchObject({ key: 'T-7', owner: 'Asha' });
    // Effort is the same work either way: waiting isn't work.
    expect(benHeld.effort!.p50).toBeCloseTo(benFree.effort!.p50, 0);
  });

  it('keeps effort apart from delivery when someone has less time', () => {
    const full = forecastProgress(fixture());
    const half = forecastProgress({ ...fixture(), shares: { 1: 0.5 } });
    const a1 = full.people.find((p) => p.name === 'Asha')!;
    const a2 = half.people.find((p) => p.name === 'Asha')!;
    expect(a2.effort!.p50).toBeCloseTo(a1.effort!.p50, 5);
    expect(a2.finish!.p50 - full.todayDay).toBeGreaterThan((a1.finish!.p50 - full.todayDay) * 1.5);
  });
});


describe('the delivery outlook’s numbers', () => {
  it('gives an 85% date between the median and the cautious date', () => {
    const r = forecastProgress(fixture()).project.finish!;
    expect(r.p85).toBeDefined();
    expect(r.p85!).toBeGreaterThanOrEqual(r.p50);
    expect(r.p85!).toBeLessThanOrEqual(r.p90);
  });

  it('counts the whole project, from what’s approved today to everything at the horizon', () => {
    const f = forecastProgress(fixture());
    expect(f.totalTasks).toBe(11);
    expect(f.projectHistory[f.projectHistory.length - 1]).toBe(6);
    const first = f.projectSeries[0];
    const last = f.projectSeries[f.projectSeries.length - 1];
    expect(first.p50).toBeGreaterThanOrEqual(6);
    expect(last.p50).toBe(11);
    // Optimistic (p10) never has fewer approved than cautious (p90).
    for (const d of f.projectSeries) expect(d.p10).toBeGreaterThanOrEqual(d.p90);
  });

  it('a smaller scope (lower estimates) can only bring the finish forward, and changes nothing else', () => {
    const fx = fixture();
    const base = forecastProgress(fx);
    const open = fx.tasks.filter((t) => t.status !== 'DONE' && t.assignee?.name === 'Asha');
    const smaller = forecastProgress({ ...fx, estimates: Object.fromEntries(open.map((t) => [t.id, 1])) });
    expect(smaller.project.finish!.p50).toBeLessThanOrEqual(base.project.finish!.p50);
    expect(smaller.people.find((p) => p.name === 'Asha')!.finish!.p50).toBeLessThan(base.people.find((p) => p.name === 'Asha')!.finish!.p50);
    // Ben's work doesn't depend on Asha's here: his dates don't move.
    expect(smaller.people.find((p) => p.name === 'Ben')!.finish).toEqual(base.people.find((p) => p.name === 'Ben')!.finish);
  });
});

describe('checking the ranges against what happened', () => {
  it('counts how many finished tasks fell inside their predicted 80% range', () => {
    const { model, tasks } = fixture();
    const check = checkRanges(tasks, model);
    expect(check.n).toBe(6);
    expect(check.inside).toBeGreaterThanOrEqual(0);
    expect(check.inside).toBeLessThanOrEqual(6);
    expect(check.coverage).toBe(check.inside / 6);
    expect(check.medianErrorDays).not.toBeNull();
  });

  it('says there are too few to judge below five', () => {
    const { model, tasks } = fixture();
    const few = tasks.filter((t) => t.status !== 'DONE' || t.id <= 3);
    expect(checkRanges(few, model).coverage).toBeNull();
    expect(dataQuality(0).level).toBe('none');
    expect(dataQuality(4).label).toContain('Limited history');
  });
});
