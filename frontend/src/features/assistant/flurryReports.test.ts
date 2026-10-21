import { describe, expect, it } from 'vitest';
import { buildSampleModel, ONBOARDING_SAMPLE, sampleProjectData } from '@/features/public/sampleProject';
import { analyzeProject } from '@/lib/projectAnalysis';
import { meetingAgenda, reviewBlockers, summariseProgress, type ReportInput } from './flurryReports';

// A fixed afternoon, so "days late" never depends on when the tests run.
const NOW = new Date(2026, 8, 26, 15, 0, 0);
const TODAY = '2026-09-26';

function input(): ReportInput {
  const data = sampleProjectData(NOW, ONBOARDING_SAMPLE);
  return {
    project: { id: 1, name: ONBOARDING_SAMPLE.name, deadline: data.deadline, progress: 35, expectedProgress: 58 },
    tasks: data.tasks,
    dependencies: data.dependencies,
    milestones: data.milestones,
    analysis: analyzeProject(buildSampleModel(NOW, ONBOARDING_SAMPLE)),
    today: TODAY,
  };
}

describe('Summarise progress', () => {
  const s = summariseProgress(input());

  it('states what the records show', () => {
    const text = s.recorded.map((l) => l.text).join('\n');
    expect(text).toContain('6 of 17 tasks approved (35%).');
    expect(text).toContain('4 in progress, 1 waiting for review, 6 not started.');
    expect(text).toContain('Next milestone, “Beta build”, is due 5 Oct (in 9 days): 0 of 7 tasks approved.');
    expect(s.recorded.every((l) => l.source === 'recorded')).toBe(true);
  });

  it('keeps inferences apart, labelled as estimates', () => {
    expect(s.inferred.length).toBeGreaterThan(0);
    expect(s.inferred.every((l) => l.source === 'estimate')).toBe(true);
    expect(s.inferred.map((l) => l.text).join(' ')).toContain('behind the calendar');
  });

  it('says what the records don’t show, without turning it into a finding', () => {
    const text = s.missing.map((l) => l.text).join('\n');
    expect(text).toContain('2 open tasks have no owner.');
    expect(text).toContain('isn’t in the records');
    expect(s.missing.every((l) => l.source === 'missing')).toBe(true);
  });

  it('handles an empty project', () => {
    const empty = summariseProgress({ ...input(), tasks: [] });
    expect(empty.recorded[0].text).toContain('no tasks yet');
  });
});

describe('Review blockers', () => {
  const findings = reviewBlockers(input());

  it('names the late task that holds work up, with a next move', () => {
    const f = findings.find((x) => x.kind === 'blocked')!;
    expect(f.title).toBe('ONB-9 holds up ONB-10');
    expect(f.detail).toContain('2 days overdue, with Sneha');
    expect(f.suggestion).toContain('Check with Sneha');
    expect(f.tasks.map((t) => t.key)).toEqual(['ONB-9', 'ONB-10']);
  });

  it('doesn’t call normal sequencing a blocker', () => {
    // ONB-8 is on time and due before the work that waits on it.
    expect(findings.some((f) => f.title.startsWith('ONB-8 '))).toBe(false);
  });

  it('lists work without an owner, and never assigns it', () => {
    const f = findings.find((x) => x.kind === 'owner')!;
    expect(f.title).toBe('2 open tasks without an owner');
    expect(f.detail).toContain('ONB-16, ONB-17');
    expect(f.suggestion).toContain('I won’t assign people for you');
  });

  it('asks for the review, not a new date, when late work is already submitted', () => {
    // ONB-7 was due yesterday and is waiting for review.
    const f = findings.find((x) => x.id === 'overdue-review')!;
    expect(f.title).toBe('1 task past due and waiting for review');
    expect(f.detail).toContain('ONB-7');
    expect(f.suggestion).toContain('Open the review');
    expect(f.suggestion).not.toMatch(/new date with|cut scope/);
    expect(findings.find((x) => x.id === 'overdue')?.detail ?? '').not.toContain('ONB-7');
  });

  it('finds nothing when everything is approved', () => {
    const done = input();
    done.tasks = done.tasks.map((t) => ({ ...t, status: 'DONE', overdue: false }));
    expect(reviewBlockers(done)).toEqual([]);
  });
});

describe('Meeting agenda', () => {
  it('is drafted from the records, to edit before sending', () => {
    const text = meetingAgenda(input());
    expect(text.split('\n')[0]).toBe(`${ONBOARDING_SAMPLE.name}: team check-in, 26 Sep`);
    expect(text).toContain('Blockers (10 min)');
    expect(text).toContain('ONB-9 holds up ONB-10');
    expect(text).toContain('Work without an owner (5 min)');
    expect(text.trim().endsWith('Edit it before you send it.')).toBe(true);
  });
});
