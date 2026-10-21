import { describe, expect, it } from 'vitest';
import type { Dependency, Task } from '@/api/types';
import { todayIso } from '@/lib/dates';
import { sampleProjectData } from '@/features/public/sampleProject';
import { daysLate, labelSides, milestoneAtRisk, milestoneBlocker, placeLabels, routeY, timeScale } from './deliveryPath';

const data = sampleProjectData(new Date(2026, 9, 6, 10));
const today = todayIso(new Date(2026, 9, 6, 10));
const ms = (name: string) => data.milestones.find((m) => m.name === name)!;
const task = (key: string) => data.tasks.find((t) => t.key === key)!;

describe('what holds a milestone up', () => {
  it('finds the late passkey API holding up the beta build, and says so plainly', () => {
    const b = milestoneBlocker(ms('Beta build'), data.tasks, data.dependencies, { today })!;
    expect(b.task.key).toBe('ONB-9');
    expect(b.kind).toBe('late');
    expect(b.lateDays).toBe(2);
    expect(b.holdsUp.map((t) => t.key)).toEqual(['ONB-10', 'ONB-14', 'ONB-17']);
    expect(b.heldInMilestone).toBe(1);
    expect(b.sentence).toBe('ONB-9 is 2 days late and holding up ONB-10. Open it?');
    expect(b.title).toBe('ONB-9, in progress, 2 days late');
  });

  it('follows the dependencies upstream: the launch waits on ONB-9 too, from another milestone', () => {
    const b = milestoneBlocker(ms('Launch'), data.tasks, data.dependencies, { today })!;
    expect(b.task.key).toBe('ONB-9');
    expect(b.inMilestone).toBe(false);
    expect(b.holdsUp.slice(0, 2).map((t) => t.key)).toEqual(['ONB-14', 'ONB-17']);
    expect(b.sentence).toBe('ONB-9 is 2 days late and holding up ONB-14 and 1 more. Open it?');
  });

  it('puts a review waiting for a decision first, in the words people use', () => {
    // Pretend the passkey API was submitted: now it's a review holding the app work up.
    const tasks: Task[] = data.tasks.map((t) => (t.key === 'ONB-9' ? { ...t, status: 'IN_REVIEW' } : t));
    const b = milestoneBlocker(ms('Beta build'), tasks, data.dependencies, { today })!;
    expect(b.kind).toBe('review');
    expect(b.sentence).toBe('This review is holding up ONB-10. Open it?');
  });

  it('never blames approved work, and says nothing when the milestone is done', () => {
    expect(milestoneBlocker(ms('Research and design'), data.tasks, data.dependencies, { today })).toBeNull();
    const approved: Task[] = data.tasks.map((t) => (t.key === 'ONB-9' ? { ...t, status: 'DONE' } : t));
    const deps: Dependency[] = data.dependencies.map((d) => (d.blocker.key === 'ONB-9' ? { ...d, blocker: { ...d.blocker, status: 'DONE' } } : d));
    const b = milestoneBlocker(ms('Beta build'), approved, deps, { today })!;
    expect(b.task.key).not.toBe('ONB-9');
  });

  it('without any waiting, names the task likely to be approved last', () => {
    const b = milestoneBlocker(ms('Beta build'), data.tasks, [], { today, likely: (id) => (id === task('ONB-13').id ? '20 Oct' : null), likelyDay: (id) => (id === task('ONB-13').id ? 99 : 10) })!;
    expect(b.kind).toBe('last');
    expect(b.task.key).toBe('ONB-13');
    expect(b.sentence).toBe('Nothing in Beta build waits on other work. ONB-13 is likely the last to be approved, around 20 Oct. Open it?');
  });

  it('counts days late from the due date', () => {
    expect(daysLate('2026-10-04', '2026-10-06')).toBe(2);
    expect(daysLate('2026-10-06', '2026-10-06')).toBe(0);
    expect(daysLate(null, '2026-10-06')).toBe(0);
  });
});

describe('the milestone most at risk', () => {
  it('is the open one furthest past its due date, by its likely finish', () => {
    const due = (iso: string) => Number(iso.replace(/-/g, ''));
    const m = [
      { id: 1, dueDate: '2026-10-15', completed: false },
      { id: 2, dueDate: '2026-10-26', completed: false },
      { id: 3, dueDate: '2026-09-28', completed: true },
    ];
    expect(milestoneAtRisk(m, (id) => (id === 1 ? due('2026-10-15') + 1 : due('2026-10-26') + 6), due)?.id).toBe(2);
    expect(milestoneAtRisk(m, () => null, due)?.id).toBe(1);
    expect(milestoneAtRisk([{ id: 3, dueDate: '2026-09-28', completed: true }], () => null, due)).toBeNull();
  });
});

describe('one time scale for the path and the chart', () => {
  it('maps days to x and back, inside the padding', () => {
    const s = timeScale(10, 50, 1000, 40);
    expect(s.x(10)).toBe(40);
    expect(s.x(50)).toBe(960);
    expect(s.day(s.x(23.5))).toBeCloseTo(23.5);
  });

  it('draws the route inside the box (its height is decoration)', () => {
    for (let x = 0; x <= 900; x += 50) {
      const y = routeY(x, 900, 320);
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(320);
    }
  });

  it('alternates labels above and below where they would collide', () => {
    expect(labelSides([0, 400, 800])).toEqual(['above', 'above', 'above']);
    expect(labelSides([0, 60, 120, 400])).toEqual(['above', 'below', 'above', 'above']);
  });

  it('places labels without overlaps: closest free row first, most important first, inside the width', () => {
    const placed = placeLabels(
      [
        { x: 500, width: 100, priority: 2 },
        { x: 520, width: 100, priority: 0 },
        { x: 540, width: 100, priority: 1 },
        { x: 990, width: 100, priority: 3 },
      ],
      1000,
    );
    expect(placed[1]).toEqual({ side: 'above', level: 0, left: 470 });
    expect(placed[2].side).toBe('below');
    expect(placed[2].level).toBe(0);
    expect(placed[0].level).toBe(1);
    expect(placed[3].left).toBe(896);
    expect(placed[3].level).toBe(0);
  });
});
