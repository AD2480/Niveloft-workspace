import { describe, expect, it } from 'vitest';
import type { Task } from '@/api/types';
import { afterWakePhrase, parseDue, parseIntent, suggestNext } from './assistantIntents';

// Saturday 26 September 2026.
const TODAY = new Date(2026, 8, 26, 15, 0, 0);

describe('parseDue', () => {
  it('reads relative days and weekdays', () => {
    expect(parseDue('today', TODAY)).toBe('2026-09-26');
    expect(parseDue('tomorrow', TODAY)).toBe('2026-09-27');
    expect(parseDue('friday', TODAY)).toBe('2026-10-02');
    expect(parseDue('next monday', TODAY)).toBe('2026-09-28');
    expect(parseDue('saturday', TODAY)).toBe('2026-10-03'); // not today: the next one
    expect(parseDue('in 3 days', TODAY)).toBe('2026-09-29');
    expect(parseDue('in two weeks', TODAY)).toBe('2026-10-10');
    expect(parseDue('next week', TODAY)).toBe('2026-09-28');
    expect(parseDue('end of the week', TODAY)).toBe('2026-10-02');
  });

  it('reads calendar dates, rolling past ones into next year', () => {
    expect(parseDue('14 oct', TODAY)).toBe('2026-10-14');
    expect(parseDue('October 14th', TODAY)).toBe('2026-10-14');
    expect(parseDue('14/10', TODAY)).toBe('2026-10-14');
    expect(parseDue('2026-12-01', TODAY)).toBe('2026-12-01');
    expect(parseDue('3 jan', TODAY)).toBe('2027-01-03');
    expect(parseDue('31 september', TODAY)).toBeNull();
    expect(parseDue('2026-02-30', TODAY)).toBeNull();
    expect(parseDue('version 2', TODAY)).toBeNull();
    expect(parseDue('2 marketing', TODAY)).toBeNull();
    expect(parseDue('3 sept', TODAY)).toBe('2027-09-03');
  });
});

describe('wake phrase', () => {
  it('finds "Hey Flurry" however it was transcribed', () => {
    expect(afterWakePhrase('hey flurry what should I work on next')).toBe('what should I work on next');
    expect(afterWakePhrase('Okay, Flurry.')).toBe('');
    expect(afterWakePhrase('Hi flurries, what changed')).toBe('what changed');
    expect(afterWakePhrase('a flurry of snow is fine')).toBeNull();
  });
});

describe('parseIntent', () => {
  it('turns a spoken task request into a draft', () => {
    expect(parseIntent('Create a task to fix the login bug, high priority, due Friday and assign it to priya', TODAY)).toEqual({
      kind: 'create-task',
      title: 'Fix the login bug',
      priority: 'HIGH',
      due: '2026-10-02',
      assignee: 'Priya',
      estimate: null,
    });
  });

  it('keeps quoted titles whole and reads estimates', () => {
    expect(parseIntent('add a task "Write release notes" due 14 oct estimated at 2 days', TODAY)).toEqual({
      kind: 'create-task',
      title: 'Write release notes',
      priority: null,
      due: '2026-10-14',
      assignee: null,
      estimate: 2,
    });
    expect(parseIntent("new task don't break the build", TODAY)).toMatchObject({ kind: 'create-task', title: "Don't break the build" });
    expect(parseIntent('create a task', TODAY)).toMatchObject({ kind: 'create-task', title: null });
    // Words that only look like dates stay in the title.
    expect(parseIntent('create a task to review design for 2 marketing pages', TODAY)).toMatchObject({ title: 'Review design for 2 marketing pages', due: null });
    expect(parseIntent('add a task fix it due 2026-02-30', TODAY)).toMatchObject({ due: null });
  });

  it('recognises task keys, typed or spoken', () => {
    expect(parseIntent('start LIB-8', TODAY)).toEqual({ kind: 'start-task', key: 'LIB-8' });
    expect(parseIntent('hey flurry start working on lib 12', TODAY)).toEqual({ kind: 'start-task', key: 'LIB-12' });
    expect(parseIntent('open ccp eight', TODAY)).toEqual({ kind: 'open-task', key: 'CCP-8' });
    expect(parseIntent('show me the 3D model', TODAY)).toEqual({ kind: 'open-model' });
    expect(parseIntent('open task LIB-8', TODAY)).toEqual({ kind: 'open-task', key: 'LIB-8' });
    expect(parseIntent('start lib twenty-three', TODAY)).toEqual({ kind: 'start-task', key: 'LIB-23' });
    expect(parseIntent('open lib twenty one', TODAY)).toEqual({ kind: 'open-task', key: 'LIB-21' });
  });

  it('routes the common questions to computed answers', () => {
    expect(parseIntent('Are we on track for the deadline?', TODAY).kind).toBe('forecast');
    expect(parseIntent('Will we finish this week?', TODAY).kind).toBe('forecast');
    expect(parseIntent('what is at risk this week', TODAY).kind).toBe('risks');
    expect(parseIntent('what is at risk', TODAY).kind).toBe('risks');
    expect(parseIntent('What changed in the last 14 days?', TODAY)).toEqual({ kind: 'changes', days: 14 });
    expect(parseIntent('What should I work on next?', TODAY).kind).toBe('next');
    expect(parseIntent('show my tasks', TODAY).kind).toBe('my-work');
    expect(parseIntent('help', TODAY).kind).toBe('help');
    expect(parseIntent('When will I finish?', TODAY).kind).toBe('my-finish');
    expect(parseIntent('how long will I be working on this project', TODAY).kind).toBe('my-finish');
    expect(parseIntent('how much work do I have left', TODAY).kind).toBe('my-finish');
  });

  it('asks why the date moved before treating it as a forecast question', () => {
    expect(parseIntent('Why did the date move?')).toEqual({ kind: 'date-moved', days: 7 });
    expect(parseIntent('why has the forecast slipped over the last two weeks')).toEqual({ kind: 'date-moved', days: 14 });
    expect(parseIntent('What pushed the deadline in the last 10 days?')).toEqual({ kind: 'date-moved', days: 10 });
    expect(parseIntent('Why are we behind this month?')).toEqual({ kind: 'date-moved', days: 30 });
    expect(parseIntent('Will we make the deadline?')).toEqual({ kind: 'forecast' });
  });

  it('greets back without AI, and treats a greeting before a request as the request', () => {
    for (const hi of ['hi', 'Hi!', 'hello', 'Hello Flurry', 'hey there', 'Good morning', 'Hey Flurry', 'who are you?']) expect(parseIntent(hi, TODAY).kind).toBe('greeting');
    expect(parseIntent('thanks!', TODAY).kind).toBe('thanks');
    expect(parseIntent('Thank you so much', TODAY).kind).toBe('thanks');
    expect(parseIntent('hi, what is at risk?', TODAY).kind).toBe('risks');
    expect(parseIntent('Hello Flurry, can you summarise progress', TODAY).kind).toBe('summary');
    expect(parseIntent('hey flurry what should I work on next', TODAY).kind).toBe('next');
    // Words that only start like a greeting aren't one.
    expect(parseIntent('highlight the risky tasks', TODAY).kind).not.toBe('greeting');
    expect(parseIntent('history of LIB-4', TODAY).kind).not.toBe('greeting');
  });

  it('answers questions about one exact task, in the right direction', () => {
    expect(parseIntent('Why is ONB-9 blocked?', TODAY)).toEqual({ kind: 'task-question', key: 'ONB-9', aspect: 'blocked' });
    expect(parseIntent('What’s holding up ONB-10?', TODAY)).toEqual({ kind: 'task-question', key: 'ONB-10', aspect: 'blocked' });
    expect(parseIntent('why can’t onb-10 start', TODAY)).toEqual({ kind: 'task-question', key: 'ONB-10', aspect: 'blocked' });
    expect(parseIntent('What depends on ONB-9?', TODAY)).toEqual({ kind: 'task-question', key: 'ONB-9', aspect: 'blocks' });
    expect(parseIntent('What is ONB-9 blocking?', TODAY)).toEqual({ kind: 'task-question', key: 'ONB-9', aspect: 'blocks' });
    expect(parseIntent('Tell me about ONB-7', TODAY)).toEqual({ kind: 'task-question', key: 'ONB-7', aspect: 'general' });
    expect(parseIntent('Why is ONB-9 late?', TODAY)).toEqual({ kind: 'task-question', key: 'ONB-9', aspect: 'general' });
    // Commands with a key still do what they say.
    expect(parseIntent('open ONB-9', TODAY).kind).toBe('open-task');
    expect(parseIntent('start ONB-10', TODAY).kind).toBe('start-task');
  });

  it('leaves anything else to the AI', () => {
    expect(parseIntent('Why did the search API take so long?', TODAY)).toEqual({ kind: 'question', text: 'Why did the search API take so long' });
  });
});

describe('suggestNext', () => {
  const task = (key: string, status: Task['status'], dueDate: string | null, priority: Task['priority'] = 'MEDIUM') => ({ key, status, dueDate, priority }) as Task;
  it('puts overdue work first, then work in progress, then what is due soonest', () => {
    const order = suggestNext(
      [
        task('A-1', 'TODO', '2026-10-20', 'URGENT'),
        task('A-2', 'IN_PROGRESS', '2026-10-05'),
        task('A-3', 'TODO', '2026-09-24'),
        task('A-4', 'IN_REVIEW', '2026-09-20'),
        task('A-5', 'TODO', '2026-09-27'),
      ],
      TODAY,
    );
    expect(order.map((o) => o.task.key)).toEqual(['A-3', 'A-2', 'A-5', 'A-1']);
    expect(order[0].reason).toBe('overdue by 2 days');
    expect(order[2].reason).toBe('due tomorrow');
  });
});
