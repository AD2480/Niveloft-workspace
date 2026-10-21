import { describe, expect, it } from 'vitest';
import { NO_CHANGES, sampleForecast } from '@/features/public/sampleForecast';
import { ONBOARDING_SAMPLE } from '@/features/public/sampleProject';
import { buildGraph, chainOf, defaultLens, lensesFor, type Lens } from './workGraphData';

const NOW = new Date(2026, 8, 26, 15, 0, 0);
const s = sampleForecast(NO_CHANGES, NOW);
const graph = (lens: Lens, me: number | null = null) => buildGraph({ model: s.model, forecast: s.forecast, tasks: s.data.tasks, milestones: s.data.milestones, lens, me });
const rohan = ONBOARDING_SAMPLE.people.rohan.id;

describe('the work graph’s views', () => {
  it('opens each role on the view that answers its question', () => {
    expect(defaultLens('VIEWER', false)).toBe('delivery');
    expect(defaultLens('MEMBER', true)).toBe('mine');
    expect(defaultLens('MEMBER', false)).toBe('team');
    expect(defaultLens('OWNER', true)).toBe('team');
    expect(defaultLens('MANAGER', false)).toBe('team');
  });

  it('offers the reviews view only to people who can review', () => {
    expect(lensesFor('VIEWER')).not.toContain('reviews');
    expect(lensesFor('MEMBER')).not.toContain('reviews');
    expect(lensesFor('MANAGER')).toContain('reviews');
    expect(lensesFor('VIEWER')).not.toContain('mine');
  });

  it('team: every task once, one lane per person, the main blocker flagged', () => {
    const g = graph('team');
    expect(g.items.length).toBe(s.data.tasks.length);
    expect(new Set(g.items.map((it) => it.id)).size).toBe(g.items.length);
    const flagged = g.items.filter((it) => it.flag === 'blocker').map((it) => it.key);
    expect(flagged).toEqual([s.blocker!.key]);
    // Lanes don't overlap and cover every row.
    expect(g.lanes.reduce((n, l) => n + l.rows, 0)).toBe(g.rows);
    for (const it of g.items) {
      const lane = g.lanes[it.lane];
      expect(it.row >= lane.rowStart && it.row < lane.rowStart + lane.rows).toBe(true);
    }
  });

  it('my work: your tasks first, plus only the tasks you wait on (shown faintly)', () => {
    const g = graph('mine', rohan);
    expect(g.lanes[0].label).toBe('You');
    const mine = g.items.filter((it) => it.ownerId === rohan);
    const others = g.items.filter((it) => it.ownerId !== rohan);
    expect(mine.length).toBe(s.data.tasks.filter((t) => t.assignee?.id === rohan).length);
    expect(mine.every((it) => !it.muted)).toBe(true);
    expect(others.every((it) => it.muted)).toBe(true);
    const waitedOn = new Set(mine.filter((it) => it.status !== 'DONE').flatMap((it) => it.blockedBy));
    expect(others.every((it) => waitedOn.has(it.id))).toBe(true);
  });

  it('reviews: work waiting for review is flagged, and what it holds up stays visible', () => {
    const g = graph('reviews');
    const inReview = g.items.filter((it) => it.status === 'IN_REVIEW');
    expect(inReview.length).toBeGreaterThan(0);
    expect(inReview.every((it) => it.flag === 'review' && !it.muted)).toBe(true);
    const unrelatedDone = g.items.filter((it) => it.status === 'DONE');
    expect(unrelatedDone.every((it) => it.muted)).toBe(true);
  });

  it('delivery: one lane per milestone, with counts and a forecast for open ones', () => {
    const g = graph('delivery');
    expect(g.items.length).toBe(0);
    expect(g.lanes.length).toBe(s.data.milestones.length);
    const total = g.lanes.reduce((n, l) => n + l.milestone!.total, 0);
    expect(total).toBe(s.data.tasks.length);
    for (const l of g.lanes) {
      if (l.milestone!.open > 0) expect(l.milestone!.band).not.toBeNull();
      else expect(l.milestone!.band).toBeNull();
    }
  });

  it('open work has a planned outline and a range; finished work has neither', () => {
    const g = graph('team');
    for (const it of g.items) {
      if (it.status === 'DONE') {
        expect(it.planned).toBeNull();
        expect(it.band).toBeNull();
      } else {
        expect(it.band).not.toBeNull();
        expect(it.band!.p10 <= it.band!.p50 && it.band!.p50 <= it.band!.p90).toBe(true);
      }
    }
  });

  it('a selected task’s chain runs both ways along dependencies', () => {
    const g = graph('team');
    const blocker = g.items.find((it) => it.flag === 'blocker')!;
    const chain = chainOf(g.items, blocker.id);
    for (const p of blocker.blockedBy) expect(chain.has(p)).toBe(true);
    for (const n of blocker.blocks) expect(chain.has(n)).toBe(true);
    expect(chain.size).toBeLessThan(g.items.length);
  });
});
