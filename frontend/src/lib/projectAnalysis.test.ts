import { describe, expect, it } from 'vitest';
import { PERMISSIONS } from '@/features/public/content';
import { buildSampleModel as buildAny, LIBRARY_SAMPLE, modelFromData, ONBOARDING_SAMPLE, sampleProjectData as dataAny, sampleSummary as summaryAny } from '@/features/public/sampleProject';

// These tests use the small library-app fixture; the public sample is checked at the end.
const buildSampleModel = (now: Date) => buildAny(now, LIBRARY_SAMPLE);
const sampleProjectData = (now: Date) => dataAny(now, LIBRARY_SAMPLE);
const sampleSummary = (m: ReturnType<typeof buildSampleModel>) => summaryAny(m, LIBRARY_SAMPLE);
import { analyzeProject, historySeries, recentChanges, shortDate } from './projectAnalysis';

// A fixed afternoon, so "days since" never depends on when the tests run.
const NOW = new Date(2026, 8, 26, 15, 0, 0);

describe('sample project', () => {
  it('produces valid records that end today', () => {
    const data = sampleProjectData(NOW);
    expect(data.tasks).toHaveLength(14);
    for (const e of data.history) expect(new Date(e.at).getTime()).toBeLessThanOrEqual(NOW.getTime());
    // Every dependency points at a task that exists.
    const ids = new Set(data.tasks.map((t) => t.id));
    for (const d of data.dependencies) {
      expect(ids.has(d.blocker.id)).toBe(true);
      expect(ids.has(d.blocked.id)).toBe(true);
    }
  });

  it('builds a model with four lanes and the expected state today', () => {
    const model = buildSampleModel(NOW);
    expect(model.lanes.map((l) => l.label)).toEqual(['Aarav Sharma', 'Priya Nair', 'Rohan Mehta', 'Sneha Iyer']);
    expect(model.blocks).toHaveLength(14);
    expect(sampleSummary(model)).toContain('Today 7 are approved, 1 is in review, 3 in progress and 3 not started');
    // The scheduler projected every open task.
    const open = model.blocks.filter((b) => b.doneDay === null);
    expect(open.every((b) => b.projected !== null)).toBe(true);
  });
});

describe('historySeries', () => {
  it('starts empty, meets today exactly and ends with everything approved by the estimate', () => {
    const model = buildSampleModel(NOW);
    const start = Math.min(...model.blocks.map((b) => b.createdDay)) - 0.5;
    const series = historySeries(model, start, model.projectionEnd!);
    expect(series[0].scope).toBe(0);
    const today = series.find((p) => p.day === model.todayDay)!;
    expect(today.estimate).toBe(false);
    expect(today.counts).toEqual({ TODO: 3, IN_PROGRESS: 3, IN_REVIEW: 1, DONE: 7 });
    const last = series[series.length - 1];
    expect(last.estimate).toBe(true);
    expect(last.counts.DONE).toBe(14);
    expect(last.scope).toBe(14);
    // Approved work never goes down in the sample (no task was reopened).
    for (let i = 1; i < series.length; i++) expect(series[i].counts.DONE).toBeGreaterThanOrEqual(series[i - 1].counts.DONE);
  });
});

describe('analyzeProject', () => {
  const model = buildSampleModel(NOW);
  const a = analyzeProject(model);
  const fact = (id: string) => a.facts.find((f) => f.id === id);

  it('counts what was recorded', () => {
    expect([a.total, a.approved, a.inReview, a.inProgress, a.notStarted]).toEqual([14, 7, 1, 3, 3]);
    expect(a.approvedLast7).toBe(1);
    expect(a.approvedPrevious7).toBe(3);
    expect(fact('progress')?.title).toBe('7 of 14 tasks approved (50%)');
  });

  it('names overdue work and what it holds up', () => {
    const f = fact('overdue-8');
    expect(f?.source).toBe('recorded');
    expect(f?.title).toBe('LIB-8 is 2 days overdue');
    expect(f?.detail).toContain('It holds up LIB-11, LIB-12.');
  });

  it('labels the forecast as an estimate', () => {
    const f = fact('finish');
    expect(f?.source).toBe('estimate');
    expect(a.forecastFinish).not.toBeNull();
    expect(a.forecastFinish! >= a.todayIso).toBe(true);
    expect(a.slackDays).toBe(Math.round(model.deadlineDay! - (model.projectionEnd! - 1)));
  });

  it('reports rework and waiting reviews', () => {
    expect(fact('rework')?.detail).toBe('LIB-4 (2 submissions)');
    expect(fact('review')?.detail).toBe('LIB-8 for 2 days');
  });

  it('lists open work per person alphabetically, without ranking anyone', () => {
    expect(fact('load')?.source).toBe('recorded');
    expect(fact('load')?.detail).toBe('Aarav 1, Priya 2, Rohan 2, Sneha 2.');
    expect(fact('clears')?.source).toBe('estimate');
  });

  it('keeps calendar days whole', () => {
    expect(model.blocks.every((b) => b.dueDay === null || Number.isInteger(b.dueDay))).toBe(true);
    expect(Number.isInteger(model.deadlineDay)).toBe(true);
  });

  it('says so when the forecast rests on assumed durations, and never calls it on track', () => {
    const data = sampleProjectData(NOW);
    data.tasks = data.tasks.map((t) => ({ ...t, estimateDays: null }));
    const unestimated = analyzeProject(modelFromData(data));
    const f = unestimated.facts.find((x) => x.id === 'assumed');
    expect(f?.source).toBe('estimate');
    expect(f?.title).toBe('7 open tasks have no estimate');
    expect(unestimated.assumedCount).toBe(7);
    const finish = unestimated.facts.find((x) => x.id === 'finish')!;
    expect(finish.tone).not.toBe('good');
    expect(finish.detail).toContain('It assumes 1 working day for each of the 7 open tasks without an estimate.');
    expect(a.assumedCount).toBe(0);
  });

  it('doesn’t report a week it has no records for as zero', () => {
    const data = sampleProjectData(NOW);
    const recent = new Set(data.tasks.filter((t) => new Date(t.createdAt).getTime() > NOW.getTime() - 10 * 86_400_000).map((t) => t.id));
    data.tasks = data.tasks.filter((t) => recent.has(t.id));
    data.history = data.history.filter((e) => recent.has(e.taskId));
    data.dependencies = data.dependencies.filter((d) => recent.has(d.blocker.id) && recent.has(d.blocked.id));
    const young = analyzeProject(modelFromData(data));
    expect(young.facts.find((x) => x.id === 'progress')?.detail).toContain('so there’s no full week before to compare');
  });

  it('formats dates briefly', () => {
    expect(shortDate('2026-10-14')).toBe('14 Oct');
  });
});

describe('recentChanges', () => {
  it('lists the last week newest first, naming requested changes as "sent back"', () => {
    const model = buildSampleModel(NOW);
    const week = recentChanges(model, 7);
    expect(week.map((e) => `${e.key} ${e.kind}`)).toEqual([
      'LIB-11 started',
      'LIB-8 submitted',
      'LIB-10 started',
      'LIB-7 approved',
      'LIB-7 submitted',
      'LIB-9 started',
      'LIB-14 created',
    ]);
    expect(week.filter((e) => e.kind === 'approved').map((e) => e.key)).toEqual(['LIB-7']);
    expect(week.some((e) => e.key === 'LIB-14' && e.kind === 'created')).toBe(true);
    const month = recentChanges(model, 20);
    expect(month.some((e) => e.key === 'LIB-4' && e.kind === 'sent back')).toBe(true);
  });
});

describe('public permission table', () => {
  const row = (label: string) => PERMISSIONS.find((p) => p.label === label)!;
  it('matches the permission rules', () => {
    expect(row('See the project, tasks and activity').cell('VIEWER')).toBe(true);
    expect(row('Comment').cell('VIEWER')).toBe(false);
    expect(row('Edit tasks').cell('MEMBER')).toBe('Their own');
    expect(row('Submit work for review').cell('MANAGER')).toBe('As assignee');
    expect(row('Approve or request changes').cell('MANAGER')).toBe('Not their own');
    expect(row('Approve or request changes').cell('MEMBER')).toBe(false);
    expect(row('Appoint managers').cell('MANAGER')).toBe(false);
    expect(row('Delete the project').cell('OWNER')).toBe(true);
    expect(row('Delete the project').cell('MANAGER')).toBe(false);
  });
});

describe('the public sample: Launch the mobile onboarding update', () => {
  const data = dataAny(NOW, ONBOARDING_SAMPLE);
  const model = buildAny(NOW, ONBOARDING_SAMPLE);
  const a = analyzeProject(model);

  it('has valid records that end today, with milestones counted from the tasks', () => {
    expect(data.tasks).toHaveLength(17);
    for (const e of data.history) expect(new Date(e.at).getTime()).toBeLessThanOrEqual(NOW.getTime());
    const ids = new Set(data.tasks.map((t) => t.id));
    for (const d of data.dependencies) expect(ids.has(d.blocker.id) && ids.has(d.blocked.id)).toBe(true);
    expect(data.milestones.map((m) => [m.name, m.taskCount, m.doneCount])).toEqual([
      ['Research and design', 6, 6],
      ['Beta build', 7, 0],
      ['Launch', 4, 0],
    ]);
    expect(data.tasks.every((t) => t.acceptanceCriteria.length > 0)).toBe(true);
  });

  it('tells the story the front page describes', () => {
    expect([a.total, a.approved, a.inReview, a.inProgress, a.notStarted]).toEqual([17, 6, 1, 4, 6]);
    // The blocker: the passkey API is two days late and holds up two tasks.
    const f = a.facts.find((x) => x.id === 'overdue-9');
    expect(f?.title).toBe('ONB-9 is 2 days overdue');
    expect(f?.detail).toContain('It holds up ONB-10');
    // Two tasks nobody owns yet.
    expect(data.tasks.filter((t) => t.assignee === null).map((t) => t.key)).toEqual(['ONB-16', 'ONB-17']);
    expect(model.lanes.map((l) => l.label)).toContain('Unassigned');
    expect(summaryAny(model, ONBOARDING_SAMPLE)).toContain('17 tasks shared by 6 people over about 7 weeks');
  });
});
