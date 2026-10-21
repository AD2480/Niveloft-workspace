import { describe, expect, it } from 'vitest';
import { parseIntent } from './assistantIntents';
import { briefFrom, draftPlanFromBrief, splitBrief } from './planDraft';

// Monday 28 September 2026, so "Friday" is 2 October.
const TODAY = new Date(2026, 8, 28, 10, 0, 0);

const BRIEF = `Design:
- Wireframes for the three welcome screens by Friday
- We need to write the welcome copy, assign to Priya
Build:
1. Build the screens for iOS and Android, high priority, takes 5 days
2. After the screens are done, run an accessibility check
Background: we want more people to finish onboarding.`;

describe('draftPlanFromBrief (Plan a project without AI)', () => {
  const plan = draftPlanFromBrief(BRIEF, TODAY);

  it('makes one task per line of work and keeps headings as context', () => {
    expect(plan.tasks.map((t) => t.title)).toEqual([
      'Wireframes for the three welcome screens',
      'Write the welcome copy',
      'Build the screens for iOS and Android',
      'After the screens are done, run an accessibility check',
    ]);
    expect(plan.tasks[0].description).toBe('Part of: Design');
    expect(plan.tasks[2].description).toBe('Part of: Build');
  });

  it('takes dates, owners, priorities and estimates only from the words', () => {
    expect(plan.tasks[0].dueDate).toBe('2026-10-02');
    expect(plan.tasks[1].assigneeName).toBe('Priya');
    expect(plan.tasks[2].priority).toBe('HIGH');
    expect(plan.tasks[2].estimateDays).toBe(5);
    // Nothing invented where the brief is silent.
    expect(plan.tasks[3].dueDate).toBeNull();
    expect(plan.tasks[3].assigneeName).toBeNull();
    expect(plan.tasks[3].priority).toBeNull();
  });

  it('links a task that clearly waits on the one before', () => {
    expect(plan.tasks[3].dependsOn).toEqual([2]);
    expect(plan.tasks[0].dependsOn).toEqual([]);
  });

  it('keeps context out of the plan, and says what the brief leaves open', () => {
    expect(plan.skipped).toEqual(['we want more people to finish onboarding']);
    expect(plan.gaps.join(' ')).toContain('doesn’t name an owner for 3 of the 4 tasks');
    expect(plan.gaps.join(' ')).toContain('I haven’t made any up');
  });

  it('finds nothing to do in prose that isn’t work', () => {
    const empty = draftPlanFromBrief('This is a note. It is fine.', TODAY);
    expect(empty.tasks).toHaveLength(0);
    expect(empty.skipped.length).toBeGreaterThan(0);
  });

  it('splits sentences and semicolons as well as lines', () => {
    expect(splitBrief('Write the copy. Build the screens; test them').map((p) => p.text)).toEqual(['Write the copy', 'Build the screens', 'test them']);
  });

  it('turns a one-line list after a heading into one task each', () => {
    const one = draftPlanFromBrief('the launch: write copy, build screens and test with users', TODAY);
    expect(one.tasks.map((t) => t.title)).toEqual(['Write copy', 'Build screens', 'Test with users']);
    expect(one.tasks[0].description).toBe('Part of: the launch');
  });

  it('caps a very long brief', () => {
    const many = Array.from({ length: 30 }, (_, i) => `- Do thing number ${i + 1}`).join('\n');
    expect(draftPlanFromBrief(many, TODAY).tasks).toHaveLength(20);
  });
});

describe('Flurry’s starting abilities are understood without AI', () => {
  it('recognises plan, summary, blockers and agenda', () => {
    expect(parseIntent('Plan a project', TODAY)).toEqual({ kind: 'plan', brief: null });
    expect(parseIntent('plan the launch: write copy, build screens and test with users', TODAY)).toEqual({ kind: 'plan', brief: 'the launch: write copy, build screens and test with users' });
    expect(parseIntent('Summarise progress', TODAY).kind).toBe('summary');
    expect(parseIntent('how are we doing?', TODAY).kind).toBe('summary');
    expect(parseIntent('Review blockers', TODAY).kind).toBe('blockers');
    expect(parseIntent('which tasks have no owner', TODAY).kind).toBe('blockers');
    expect(parseIntent('Draft a meeting agenda', TODAY).kind).toBe('agenda');
    // Unchanged: risks and planning words inside other requests.
    expect(parseIntent('what is at risk', TODAY).kind).toBe('risks');
    expect(parseIntent('create a task to plan the offsite', TODAY).kind).toBe('create-task');
  });

  it('keeps the brief’s line breaks', () => {
    expect(briefFrom('Plan a project:\n- one\n- two')).toBe('- one\n- two');
    expect(briefFrom('Hey Flurry, draft a plan for the launch')).toBe('the launch');
    expect(briefFrom('- just a brief')).toBe('- just a brief');
  });
});
