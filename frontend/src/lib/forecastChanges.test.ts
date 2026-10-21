import { describe, expect, it } from 'vitest';
import type { ChangeLog, Dependency, FieldChange, Member, StatusChange, Task } from '@/api/types';
import { changeHeadline, dependenciesAsOf, explainForecastChange, statusAsOf } from './forecastChanges';

const user = (id: number, name: string) => ({ id, name, email: `${id}@x.dev`, avatarColor: '#000' });
const asha = user(1, 'Asha');
const ben = user(2, 'Ben');
const member = (u: ReturnType<typeof user>, role: Member['role']): Member => ({ id: u.id, user: { ...u, jobTitle: null }, role, joinedAt: '', openTaskCount: 0 });
const members = [member(asha, 'MEMBER'), member(ben, 'MANAGER')];

function task(id: number, patch: Partial<Task>): Task {
  return {
    id, projectId: 1, projectKey: 'T', projectName: 'T', projectColor: '#000', key: `T-${id}`, title: `Task ${id}`, description: null,
    status: 'TODO', priority: 'MEDIUM', assignee: asha, reporter: asha, dueDate: null, milestoneId: null, milestoneName: null, position: id,
    commentCount: 0, submissionCount: 0, overdue: false, createdAt: '2026-09-01T09:00:00Z', updatedAt: '2026-09-01T09:00:00Z', startedAt: null,
    completedAt: null, acceptanceCriteria: [], checklist: [], version: 0, estimateDays: 2, ...patch,
  } as Task;
}

const dep = (blocked: Task, blocker: Task, id = blocked.id * 100 + blocker.id) =>
  ({ id, projectId: 1, blocker: { id: blocker.id, key: blocker.key, title: '', status: blocker.status }, blocked: { id: blocked.id, key: blocked.key, title: '', status: blocked.status }, createdAt: '' }) as unknown as Dependency;

const change = (t: Task, field: FieldChange['field'], oldValue: string | null, newValue: string | null, at: string, extra: Partial<FieldChange> = {}): FieldChange => ({
  taskId: t.id, taskKey: t.key, field, oldValue, newValue, oldUserId: null, newUserId: null, blockerId: null, at, ...extra,
});

/**
 * Six approved tasks to learn pace from; on 13 Oct, T-7 and T-8 (Asha), T-9 and T-10 (Ben) were open.
 * Since then: T-11 added (30 days, unowned at first, then Ben's), T-7 re-estimated 2 → 6, T-10 made to
 * wait on T-7, T-9 moved from Ben to Asha, T-8 went to review on 13 Oct and is still waiting.
 */
function project() {
  const history: StatusChange[] = [];
  const tasks: Task[] = [];
  const done = (id: number, who: typeof asha, start: number, days: number) => {
    const s = `2026-09-${String(start).padStart(2, '0')}T09:00:00Z`;
    const r = `2026-09-${String(start + days).padStart(2, '0')}T09:00:00Z`;
    const d = `2026-09-${String(start + days).padStart(2, '0')}T17:00:00Z`;
    tasks.push(task(id, { assignee: who, status: 'DONE', startedAt: s, completedAt: d }));
    history.push({ taskId: id, from: null, to: 'TODO', at: '2026-09-01T09:00:00Z' }, { taskId: id, from: 'TODO', to: 'IN_PROGRESS', at: s }, { taskId: id, from: 'IN_PROGRESS', to: 'IN_REVIEW', at: r }, { taskId: id, from: 'IN_REVIEW', to: 'DONE', at: d });
  };
  done(1, asha, 1, 3); done(2, asha, 5, 3); done(3, asha, 9, 3);
  done(4, ben, 1, 2); done(5, ben, 4, 2); done(6, ben, 7, 2);
  const t7 = task(7, { assignee: asha, estimateDays: 6, status: 'IN_PROGRESS', startedAt: '2026-10-01T09:00:00Z' });
  const t8 = task(8, { assignee: asha, status: 'IN_REVIEW', startedAt: '2026-10-06T09:00:00Z' });
  const t9 = task(9, { assignee: asha, estimateDays: 3 });
  const t10 = task(10, { assignee: ben, estimateDays: 3 });
  const t11 = task(11, { assignee: ben, estimateDays: 30, createdAt: '2026-10-15T09:00:00Z', updatedAt: '2026-10-15T09:00:00Z' });
  tasks.push(t7, t8, t9, t10, t11);
  history.push(
    { taskId: 7, from: null, to: 'TODO', at: '2026-09-01T09:00:00Z' }, { taskId: 7, from: 'TODO', to: 'IN_PROGRESS', at: '2026-10-01T09:00:00Z' },
    { taskId: 8, from: null, to: 'TODO', at: '2026-09-01T09:00:00Z' }, { taskId: 8, from: 'TODO', to: 'IN_PROGRESS', at: '2026-10-06T09:00:00Z' },
    { taskId: 8, from: 'IN_PROGRESS', to: 'IN_REVIEW', at: '2026-10-13T10:00:00Z' },
    { taskId: 9, from: null, to: 'TODO', at: '2026-09-01T09:00:00Z' }, { taskId: 10, from: null, to: 'TODO', at: '2026-09-01T09:00:00Z' },
    { taskId: 11, from: null, to: 'TODO', at: '2026-10-15T09:00:00Z' },
  );
  const log: ChangeLog = {
    since: '2026-10-13T00:00:00Z',
    changes: [
      change(t11, 'assignee', null, 'Ben', '2026-10-15T09:00:00Z', { newUserId: 2 }),
      change(t7, 'estimate', '2', '6', '2026-10-14T09:00:00Z'),
      change(t10, 'dependency', null, 'T-7', '2026-10-14T10:00:00Z', { blockerId: 7 }),
      change(t9, 'assignee', 'Ben', 'Asha', '2026-10-16T09:00:00Z', { oldUserId: 2, newUserId: 1 }),
    ],
    deleted: [{ key: 'T-12', at: '2026-10-17T09:00:00Z' }],
    truncated: false,
  };
  return { tasks, history, dependencies: [dep(t10, t7)], log };
}

const input = (p = project()) => ({
  // The explanation counts local calendar days, so keep the fixture on these dates in every zone.
  now: new Date(2026, 9, 20, 12),
  since: new Date(2026, 9, 13),
  project: { startDate: '2026-09-01', deadline: '2026-11-30' },
  milestones: [],
  members,
  runs: 200,
  ...p,
});

describe('why the date moved (forecast replay)', () => {
  it('rebuilds statuses and dependencies as they stood', () => {
    const p = project();
    const t8 = p.tasks.find((t) => t.id === 8)!;
    expect(statusAsOf(t8, p.history, new Date('2026-10-12T00:00:00Z').getTime())).toEqual({ status: 'IN_PROGRESS', startedAt: '2026-10-06T09:00:00Z', completedAt: null });
    expect(statusAsOf(t8, p.history, new Date('2026-10-14T00:00:00Z').getTime()).status).toBe('IN_REVIEW');
    const then = dependenciesAsOf(p.dependencies, p.log, new Date('2026-10-13T00:00:00Z').getTime(), p.tasks);
    expect(then.deps).toEqual([]); // T-10 → T-7 was added after
    const removed: ChangeLog = { ...p.log, changes: [change(p.tasks[9], 'dependency', 'T-8', null, '2026-10-14T00:00:00Z', { blockerId: 8 })] };
    expect(dependenciesAsOf([], removed, new Date('2026-10-13T00:00:00Z').getTime(), p.tasks).deps.map((d) => `${d.blocked.key}>${d.blocker.key}`)).toEqual(['T-10>T-8']);
  });

  it('measures each kind of change, and the steps add up to the whole move', () => {
    const c = explainForecastChange(input());
    expect(c.then).not.toBeNull();
    expect(c.now).not.toBeNull();
    const sum = c.steps.reduce((a, s) => a + (s.days ?? 0), 0);
    expect(sum).toBe(c.totalDays);
    const scope = c.steps.find((s) => s.kind === 'scope')!;
    expect(scope.facts.map((f) => f.text)).toEqual(['T-11 was added (30 working days of estimates)', 'T-7 re-estimated from 2 to 6 working days']);
    expect(scope.days).toBeGreaterThan(0); // 30 days of new work can only make it later
    const blocked = c.steps.find((s) => s.kind === 'blocked')!;
    expect(blocked.facts.map((f) => f.text)).toEqual(['T-10 now waits on T-7']);
    expect(blocked.days).toBeGreaterThanOrEqual(0);
    const owners = c.steps.find((s) => s.kind === 'owners')!;
    expect(owners.facts.map((f) => f.text)).toEqual(['T-9 moved from Ben to Asha', 'T-11 went to Ben']);
    const progress = c.steps.find((s) => s.kind === 'progress')!;
    expect(progress.facts[0].text).toBe('5 working days passed');
    expect(progress.facts.some((f) => f.text === 'T-8 went to review')).toBe(true);
    const wait = progress.facts.find((f) => f.review)!;
    expect(wait.text).toMatch(/^T-8 has waited 7 days for review \(usually about 1 day\)$/);
    expect(c.reviewWaits[0]).toMatchObject({ key: 'T-8', pending: true, days: 7 });
    expect(c.notes[0]).toBe('T-12 was deleted since then, so it’s in neither forecast.');
    expect(changeHeadline(c, (d) => d)).toMatch(/^The likely finish moved from \d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2}: \d+ working days? later than on 2026-10-13, mostly from scope and estimates\.$/);
  });

  it('a step with nothing recorded moves nothing', () => {
    const p = project();
    const quiet = { ...p, log: { ...p.log, changes: p.log.changes.filter((c) => c.field !== 'assignee') } };
    const c = explainForecastChange(input(quiet));
    expect(c.steps.find((s) => s.kind === 'owners')).toEqual({ kind: 'owners', days: 0, facts: [] });
  });

  it('the same records give the same explanation', () => {
    expect(explainForecastChange(input())).toEqual(explainForecastChange(input()));
  });
});
