import { describe, expect, it } from 'vitest';
import { catchUpSentence, sinceWords } from './catchUpText';

describe('since you were last here', () => {
  it('says what happened in words, from the counts', () => {
    expect(catchUpSentence({ counts: { REVIEW_APPROVED: 2, COMMENT_ADDED: 1, SUBMISSION_CREATED: 3 }, dueDateChanges: 0 })).toBe(
      '2 approved, 3 submitted for review and 1 comment.',
    );
    // Due date changes are named; other edits are counted together, not itemised.
    expect(catchUpSentence({ counts: { TASK_UPDATED: 3, CRITERIA_UPDATED: 1 }, dueDateChanges: 2 })).toBe('2 due dates changed and 2 other changes.');
    expect(catchUpSentence({ counts: {}, dueDateChanges: 0 })).toBeNull();
  });

  it('names the moment in plain words', () => {
    const now = new Date('2026-10-13T12:00:00');
    expect(sinceWords('2026-10-13T09:05:00', now)).toBe('today at 09:05');
    expect(sinceWords('2026-10-12T18:00:00', now)).toBe('yesterday at 18:00');
    expect(sinceWords('2026-10-10T18:00:00', now)).toBe('on Saturday at 18:00');
    expect(sinceWords('2026-10-01T18:00:00', now)).toBe('on 1 October');
  });
});
