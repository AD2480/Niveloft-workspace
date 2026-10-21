import { describe, expect, it } from 'vitest';
import { LONGEST_PARAGRAPH, splitDocument } from './documentText';

// The same cases as the server's DocumentTextTest, so both sides cut documents the same way.
describe('document passages', () => {
  it('splits at headings and paragraphs and remembers where each passage is', () => {
    const p = splitDocument('Intro line.\n\n# Sign-in\n\nPasskeys first.\n\n## Sessions\n\n30 minutes idle.\nKept sign-ins: 30 days.\n\n### Edge cases\n\nNone.\n\n# Billing\n\nMonthly.');
    expect(p.map((x) => x.heading)).toEqual([null, 'Sign-in', 'Sign-in › Sessions', 'Sign-in › Sessions › Edge cases', 'Billing']);
    expect(p[2].content).toBe('30 minutes idle.\nKept sign-ins: 30 days.');
    expect(p.map((x) => x.ordinal)).toEqual([0, 1, 2, 3, 4]);
  });

  it('gathers short paragraphs and cuts long ones at sentences', () => {
    const para = 'This sentence is about forty characters. '.repeat(10).trim();
    expect(splitDocument(`${para}\n\n${para}\n\n${para}`)).toHaveLength(2);
    const cut = splitDocument('Word after word without an end and still going on and on. '.repeat(60));
    expect(cut.length).toBeGreaterThan(3);
    expect(cut.every((x) => x.content.length <= LONGEST_PARAGRAPH)).toBe(true);
    expect(splitDocument('   \n\n  ')).toEqual([]);
  });
});
