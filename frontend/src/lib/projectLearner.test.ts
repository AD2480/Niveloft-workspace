import { describe, expect, it } from 'vitest';
import type { Task } from '@/api/types';
import type { ModelBlock, ProjectModel } from '@/three/projectModel';
import { answerLocally } from '@/features/assistant/localAnswer';
import { buildIndex, learn, learnPace, predict, search, trainRisk } from './projectLearner';

let nextId = 1;
function make(p: { title: string; who: string; status?: Task['status']; estimate?: number | null; start?: number | null; done?: number | null; due?: number | null; priority?: Task['priority']; blockers?: number; description?: string }) {
  const id = nextId++;
  const task = {
    id,
    projectId: 1,
    key: `PF-${id}`,
    title: p.title,
    description: p.description ?? null,
    status: p.status ?? 'DONE',
    priority: p.priority ?? 'MEDIUM',
    assignee: { id: p.who.length, name: p.who },
    dueDate: p.due == null ? null : `2026-09-${String(1 + p.due).padStart(2, '0')}`,
    estimateDays: p.estimate === undefined ? 2 : p.estimate,
    acceptanceCriteria: [],
    milestoneName: null,
  } as unknown as Task;
  const block = {
    id,
    key: task.key,
    title: p.title,
    createdDay: 0,
    startedDay: p.start ?? null,
    doneDay: p.done ?? null,
    dueDay: p.due ?? null,
    blockedBy: Array.from({ length: p.blockers ?? 0 }, (_, i) => 1000 + i),
    segments: [{ from: 0, status: 'TODO' }],
  } as unknown as ModelBlock;
  return { task, block };
}

function project(rows: ReturnType<typeof make>[], todayDay = 20): { tasks: Task[]; model: ProjectModel } {
  return { tasks: rows.map((r) => r.task), model: { blocks: rows.map((r) => r.block), todayDay, originMs: Date.UTC(2026, 8, 1), originIso: '2026-09-01' } as unknown as ProjectModel };
}

describe('built-in model: pace', () => {
  it('learns each person’s pace against their estimates, pulled towards the project average', () => {
    const rows = [
      // Asha takes about twice as long as estimated; Ben about as estimated.
      make({ title: 'a', who: 'Asha', estimate: 2, start: 0, done: 5.6 }),
      make({ title: 'b', who: 'Asha', estimate: 1, start: 2, done: 4.8 }),
      make({ title: 'c', who: 'Asha', estimate: 3, start: 4, done: 12.4 }),
      make({ title: 'd', who: 'Ben', estimate: 2, start: 0, done: 2.8 }),
      make({ title: 'e', who: 'Ben', estimate: 2, start: 3, done: 5.8 }),
    ];
    const { tasks, model } = project(rows);
    const pace = learnPace(tasks, model.blocks);
    expect(pace.overall.n).toBe(5);
    expect(pace.byPerson.get('Asha')!.ratio).toBeGreaterThan(1.4);
    expect(pace.byPerson.get('Ben')!.ratio).toBeLessThan(pace.byPerson.get('Asha')!.ratio);
    // Shrinkage: Ben's own ratio is 1.0, but with only 2 tasks he's pulled towards the average.
    expect(pace.byPerson.get('Ben')!.ratio).toBeGreaterThan(1.0);
  });
});

describe('built-in model: lateness', () => {
  it('learns that tight, blocked tasks run late, and measures itself on tasks it didn’t see', () => {
    const rows = [];
    for (let i = 0; i < 6; i++) rows.push(make({ title: `tight ${i}`, who: 'Asha', estimate: 3, start: i, done: i + 7, due: i + 3, blockers: 2, priority: 'HIGH' }));
    for (let i = 0; i < 6; i++) rows.push(make({ title: `roomy ${i}`, who: 'Ben', estimate: 1, start: i, done: i + 1.4, due: i + 10, blockers: 0, priority: 'LOW' }));
    const { tasks, model } = project(rows, 30);
    const learned = learn(tasks, model);
    expect(learned.risk).not.toBeNull();
    expect(learned.risk!.n).toBe(12);
    expect(learned.risk!.positives).toBe(6);
    expect(learned.risk!.accuracy!).toBeGreaterThanOrEqual(0.9);
    const open = make({ title: 'new tight one', who: 'Asha', status: 'IN_PROGRESS', estimate: 3, start: 28, due: 30, blockers: 2, priority: 'HIGH' });
    const calm = make({ title: 'new roomy one', who: 'Ben', status: 'TODO', estimate: 1, start: null, due: 45, priority: 'LOW' });
    const pRisky = predict(learned, open.task, open.block, 30);
    const pCalm = predict(learned, calm.task, calm.block, 30);
    expect(pRisky.pLate!).toBeGreaterThan(0.6);
    expect(pCalm.pLate!).toBeLessThan(0.4);
    expect(pRisky.factors.length).toBeGreaterThan(0);
    expect(pRisky.finishDay!).toBeGreaterThan(30);
  });

  it('refuses to guess without both outcomes', () => {
    expect(trainRisk([{ x: [1, 2], y: 0 }, { x: [2, 1], y: 0 }, { x: [1, 1], y: 0 }, { x: [3, 1], y: 0 }, { x: [2, 2], y: 0 }, { x: [1, 3], y: 0 }])).toBeNull();
  });
});

describe('built-in model: search and answers', () => {
  it('finds the records behind a free question', () => {
    const rows = [
      make({ title: 'Fix the login bug on Safari', who: 'Asha', description: 'Session cookie is dropped after redirect' }),
      make({ title: 'Write release notes', who: 'Ben' }),
      make({ title: 'Design the notification service', who: 'Ben', description: 'Email and in-app notifications' }),
    ];
    const idx = buildIndex(rows.map((r) => r.task));
    expect(search(idx, 'what is happening with notifications email?')[0].id).toBe(rows[2].task.id);
    expect(search(idx, 'login problem safari')[0].id).toBe(rows[0].task.id);
    expect(search(idx, 'xylophone')).toEqual([]);
  });

  it('answers risk, timing, people and other questions, always saying what it learned from', () => {
    const rows = [];
    for (let i = 0; i < 5; i++) rows.push(make({ title: `API endpoint ${i}`, who: 'Asha', estimate: 3, start: i, done: i + 8, due: i + 4, blockers: 1, priority: 'HIGH' }));
    for (let i = 0; i < 5; i++) rows.push(make({ title: `Docs page ${i}`, who: 'Ben', estimate: 1, start: i, done: i + 1.4, due: i + 9 }));
    rows.push(make({ title: 'Search API', who: 'Asha', status: 'IN_PROGRESS', estimate: 3, start: 18, due: 21, blockers: 1, priority: 'HIGH' }));
    const { tasks, model } = project(rows, 20);
    const learned = learn(tasks, model);
    const key = rows[10].task.key;
    const risk = answerLocally(`Is ${key} going to be late?`, learned, tasks, model);
    expect(risk.title).toContain(key);
    expect(risk.lines[0].text).toMatch(/% chance of finishing late/);
    expect(risk.basis).toMatch(/Learned from 10 finished tasks/);
    expect(answerLocally(`When will ${key} finish?`, learned, tasks, model).lines[0].text).toMatch(/Asha’s tasks here take/);
    expect(answerLocally('Who is the busiest?', learned, tasks, model).lines.map((l) => l.text.split(':')[0])).toEqual(['Asha', 'Ben']);
    const other = answerLocally('anything about the search api?', learned, tasks, model);
    expect(other.lines[0].task?.key).toBe(key);
    expect(other.limit).toMatch(/AI in this browser/);
  });

  it('answers deadline questions with the scheduler’s finish against the deadline', () => {
    const rows = [make({ title: 'Done one', who: 'Asha', estimate: 2, start: 0, done: 3 }), make({ title: 'Open one', who: 'Asha', status: 'IN_PROGRESS', estimate: 3, start: 18, due: 25 })];
    const { tasks, model } = project(rows, 20);
    const learned = learn(tasks, model);
    const behind = answerLocally('Will we make the deadline?', learned, tasks, { ...model, deadlineDay: 30, projectionEnd: 34 } as ProjectModel);
    expect(behind.title).toBe('Behind the deadline, at the current pace');
    expect(behind.lines[0].text).toMatch(/4 days after the deadline/);
    const ahead = answerLocally('are we on track?', learned, tasks, { ...model, deadlineDay: 30, projectionEnd: 29 } as ProjectModel);
    expect(ahead.lines[0].text).toMatch(/1 day before/);
    expect(answerLocally('Will we make the deadline?', learned, tasks, { ...model, deadlineDay: null, projectionEnd: 29 } as ProjectModel).title).toBe('This project has no deadline');
  });
});
