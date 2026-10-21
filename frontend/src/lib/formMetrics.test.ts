import { afterEach, describe, expect, it } from 'vitest';
import { failureKind, flushFormMetrics, setFormMetricsSender, trackForm } from './formMetrics';
import { freshness } from './freshness';

afterEach(() => setFormMetricsSender(null));

describe('form success counts', () => {
  it('batches counts and sends only numbers', () => {
    const sent: string[] = [];
    setFormMetricsSender((body) => sent.push(body));
    trackForm('sign-up', 'view');
    trackForm('sign-up', 'view');
    trackForm('sign-up', 'submit');
    trackForm('contact', 'failed');
    flushFormMetrics(true);
    expect(sent.length).toBe(1);
    const events = (JSON.parse(sent[0]) as { events: { form: string; event: string; count: number }[] }).events;
    expect(events).toEqual([
      { form: 'sign-up', event: 'view', count: 2 },
      { form: 'sign-up', event: 'submit', count: 1 },
      { form: 'contact', event: 'failed', count: 1 },
    ]);
    // Nothing new: nothing sent.
    flushFormMetrics(true);
    expect(sent.length).toBe(1);
  });

  it('tells refusals from failures', () => {
    expect(failureKind({ status: 400 })).toBe('rejected');
    expect(failureKind({ status: 409 })).toBe('rejected');
    expect(failureKind({ status: 429 })).toBe('failed');
    expect(failureKind({ status: 500 })).toBe('failed');
    expect(failureKind({ status: 'FETCH_ERROR' })).toBe('failed');
    expect(failureKind(new Error('x'))).toBe('failed');
  });
});

describe('last updated', () => {
  it('says how long ago, in words', () => {
    const now = Date.parse('2026-09-28T12:00:00Z');
    expect(freshness(now - 10_000, now)).toBe('just now');
    expect(freshness(now - 4 * 60_000, now)).toBe('4 min ago');
    expect(freshness(now - 3 * 3600_000, now)).toBe('3 h ago');
    expect(freshness(now + 5000, now)).toBe('just now');
  });
});
