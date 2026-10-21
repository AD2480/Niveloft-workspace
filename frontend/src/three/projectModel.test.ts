import { describe, expect, it } from 'vitest';
import type { Dependency, StatusChange, Task } from '@/api/types';
import { blockStateAt, buildProjectModel, countsAt, dateMs, dayToIso, packRows, statusAt } from './projectModel';

const user = (id: number, name: string) => ({ id, name, email: `${name.toLowerCase()}@x.dev`, avatarColor: '#000000' });

function task(id: number, patch: Partial<Task> = {}): Task {
  return {
    id,
    projectId: 1,
    projectKey: 'T',
    projectName: 'Test',
    projectColor: '#000000',
    key: `T-${id}`,
    title: `Task ${id}`,
    description: null,
    status: 'TODO',
    priority: 'MEDIUM',
    assignee: user(1, 'Asha'),
    reporter: user(1, 'Asha'),
    dueDate: null,
    milestoneId: null,
    milestoneName: null,
    position: id,
    commentCount: 0,
    submissionCount: 0,
    overdue: false,
    createdAt: '2026-09-01T09:00:00',
    updatedAt: '2026-09-01T09:00:00',
    startedAt: null,
    completedAt: null,
    acceptanceCriteria: [],
    checklist: [],
    version: 0,
    estimateDays: null,
    ...patch,
  } as Task;
}

const base = {
  now: new Date('2026-09-20T12:00:00'),
  projectStart: '2026-09-01',
  deadline: '2026-10-15',
  dependencies: [] as Dependency[],
  milestones: [],
  projection: null,
};

describe('project model', () => {
  it('converts dates to local day indexes and back', () => {
    const origin = dateMs('2026-09-01');
    expect(dayToIso(origin, 0)).toBe('2026-09-01');
    expect(dayToIso(origin, 30.9)).toBe('2026-10-01');
  });

  it('packs overlapping work into separate rows', () => {
    expect(packRows([{ start: 0, end: 5 }, { start: 2, end: 4 }, { start: 6, end: 8 }])).toEqual([0, 1, 0]);
  });

  it('replays recorded status changes', () => {
    const history: StatusChange[] = [
      { taskId: 1, from: null, to: 'TODO', at: '2026-09-01T09:00:00' },
      { taskId: 1, from: 'TODO', to: 'IN_PROGRESS', at: '2026-09-05T10:00:00' },
      { taskId: 1, from: 'IN_PROGRESS', to: 'IN_REVIEW', at: '2026-09-10T10:00:00' },
      { taskId: 1, from: 'IN_REVIEW', to: 'DONE', at: '2026-09-12T10:00:00' },
    ];
    const model = buildProjectModel({
      ...base,
      tasks: [task(1, { status: 'DONE', startedAt: '2026-09-05T10:00:00', completedAt: '2026-09-12T10:00:00' })],
      history,
    });
    const b = model.blocks[0];
    const day = (iso: string) => (dateMs(iso) - model.originMs) / 86_400_000 + 0.5;
    expect(statusAt(b, day('2026-08-31'))).toBeNull();
    expect(statusAt(b, day('2026-09-02'))).toBe('TODO');
    expect(statusAt(b, day('2026-09-07'))).toBe('IN_PROGRESS');
    expect(statusAt(b, day('2026-09-11'))).toBe('IN_REVIEW');
    expect(statusAt(b, day('2026-09-15'))).toBe('DONE');
    const state = blockStateAt(b, day('2026-09-15'), model.todayDay, true);
    expect(state.solid?.start).toBeCloseTo(day('2026-09-05') - 0.5 + 10 / 24, 5);
    expect(state.overdue).toBe(false);
  });

  it('falls back to task timestamps without history, and marks overdue work', () => {
    const model = buildProjectModel({ ...base, tasks: [task(2, { status: 'IN_PROGRESS', startedAt: '2026-09-03T09:00:00', dueDate: '2026-09-10' })], history: [] });
    const b = model.blocks[0];
    const state = blockStateAt(b, model.todayDay, model.todayDay, true);
    expect(state.status).toBe('IN_PROGRESS');
    expect(state.overdue).toBe(true);
    expect(state.solid?.end).toBeCloseTo(model.todayDay, 5);
  });

  it('gives each person a lane and puts unassigned work last', () => {
    const model = buildProjectModel({
      ...base,
      tasks: [task(1, { assignee: user(2, 'Zed') }), task(2, { assignee: null }), task(3, { assignee: user(3, 'Asha') })],
      history: [],
    });
    expect(model.lanes.map((l) => l.label)).toEqual(['Asha', 'Zed', 'Unassigned']);
    expect(model.blocks.find((b) => b.id === 2)?.lane).toBe(2);
  });

  it('counts projected completions only beyond today', () => {
    const projection = {
      today: '2026-09-21',
      scheduled: new Map([[1, { taskId: 1, start: '2026-09-21', finish: '2026-09-23', remainingDays: 3, estimateUsed: 3, slipDays: null, flags: [], drivenBy: null }]]),
      finish: '2026-09-23',
      late: [],
      assumed: [],
    };
    const model = buildProjectModel({ ...base, tasks: [task(1)], history: [], projection });
    expect(countsAt(model, model.todayDay).DONE).toBe(0);
    expect(countsAt(model, model.todayDay + 10).DONE).toBe(1);
    expect(blockStateAt(model.blocks[0], model.todayDay + 10, model.todayDay, true).estimated).toBe(true);
  });
});
