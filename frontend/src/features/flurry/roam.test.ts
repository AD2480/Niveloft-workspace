import { describe, expect, it } from 'vitest';
import { aimAt, belowBox, besideBox, boxAt, candidateSpots, clampInto, flightAt, followStep, gazeOffset, noteSide, perchBeside, pickResting, pickSpot, planFlight, restingSpots, scoreSpot, type Box, type SpotContext } from './roam';

const seeded = (seed = 7) => {
  let a = seed;
  return () => {
    a = (a * 1664525 + 1013904223) % 4294967296;
    return a / 4294967296;
  };
};
const size = { width: 64, height: 64 };
const area: Box = { left: 276, top: 76, right: 1420, bottom: 880 };
const ctx = (over: Partial<SpotContext> = {}): SpotContext => ({ size, from: { x: 1336, y: 796 }, avoid: [], pointer: null, recent: [], ...over });

describe('where Flurry can rest', () => {
  it('offers spots along the edges and inside, all within the area', () => {
    const spots = candidateSpots(area, size, 'free', seeded());
    expect(spots.length).toBeGreaterThanOrEqual(13);
    for (const p of spots) {
      expect(p.x).toBeGreaterThanOrEqual(area.left);
      expect(p.x + size.width).toBeLessThanOrEqual(area.right + 0.001);
      expect(p.y).toBeGreaterThanOrEqual(area.top);
      expect(p.y + size.height).toBeLessThanOrEqual(area.bottom + 0.001);
    }
  });

  it('stays on the bottom edge on phones', () => {
    const spots = candidateSpots({ left: 16, top: 72, right: 374, bottom: 828 }, { width: 48, height: 48 }, 'bottom', seeded());
    expect(spots.length).toBe(5);
    for (const p of spots) expect(p.y).toBe(828 - 48);
  });

  it('never lands on the field you are typing in, or under the pointer', () => {
    const field = { left: 1000, top: 760, right: 1400, bottom: 800 };
    expect(scoreSpot({ x: 1200, y: 750 }, 0, ctx({ avoid: [field] }))).toBe(-Infinity);
    expect(scoreSpot({ x: 700, y: 400 }, 0, ctx({ pointer: { x: 730, y: 430 } }))).toBe(-Infinity);
    expect(scoreSpot({ x: 700, y: 400 }, 0, ctx({ pointer: { x: 1100, y: 200 } }))).toBeGreaterThan(-Infinity);
  });

  it('prefers empty space over content, and new places over old ones', () => {
    const c = ctx();
    expect(scoreSpot({ x: 900, y: 796 }, 0, c)).toBeGreaterThan(scoreSpot({ x: 900, y: 796 }, 0.8, c));
    expect(scoreSpot({ x: 900, y: 796 }, 0, ctx({ recent: [{ x: 910, y: 790 }] }))).toBeLessThan(scoreSpot({ x: 900, y: 796 }, 0, c));
    // A worthwhile hop, not a twitch.
    expect(scoreSpot({ x: 1320, y: 790 }, 0, c)).toBeLessThan(scoreSpot({ x: 950, y: 796 }, 0, c));
  });

  it('gets away from a field it would cover', () => {
    const flee = { left: 1100, top: 700, right: 1420, bottom: 860 };
    const c = ctx({ flee, avoid: [flee] });
    expect(scoreSpot({ x: 300, y: 796 }, 0, c)).toBeGreaterThan(scoreSpot({ x: 950, y: 600 }, 0, c));
  });

  it('picks one of the best spots, and none when nowhere is allowed', () => {
    const spots = candidateSpots(area, size, 'free', seeded());
    const next = pickSpot(spots, () => 0, ctx(), seeded(3));
    expect(next).not.toBeNull();
    expect(Math.hypot(next!.x - 1336, next!.y - 796)).toBeGreaterThan(90);
    expect(pickSpot(spots, () => 0, ctx({ avoid: [area] }), seeded())).toBeNull();
  });

  it('keeps a point inside the area', () => {
    expect(clampInto({ x: 2000, y: -5 }, area, size)).toEqual({ x: area.right - 64, y: area.top });
  });
});

describe('how Flurry flies', () => {
  it('starts and ends on the spots, arcing between them', () => {
    const f = planFlight({ x: 100, y: 500 }, { x: 700, y: 500 }, seeded());
    expect(flightAt(f, 0).p).toEqual({ x: 100, y: 500 });
    const end = flightAt(f, 1).p;
    expect(end.x).toBeCloseTo(700);
    expect(end.y).toBeCloseTo(500);
    expect(flightAt(f, 0.5).p.y).not.toBeCloseTo(500); // an arc, not a slide
    expect(f.duration).toBeGreaterThanOrEqual(800);
    expect(f.duration).toBeLessThanOrEqual(2600);
  });

  it('banks into the direction of travel, and levels out on landing', () => {
    const right = planFlight({ x: 100, y: 500 }, { x: 900, y: 500 }, seeded());
    const left = planFlight({ x: 900, y: 500 }, { x: 100, y: 500 }, seeded());
    expect(flightAt(right, 0.5).tilt).toBeGreaterThan(0);
    expect(flightAt(left, 0.5).tilt).toBeLessThan(0);
    expect(Math.abs(flightAt(right, 1).tilt)).toBeLessThan(0.01);
    expect(Math.abs(flightAt(right, 0.5).tilt)).toBeLessThanOrEqual(14);
  });

  it('looks at the pointer, a little, and straight ahead without one', () => {
    expect(gazeOffset({ x: 0, y: 0 }, null)).toEqual({ x: 0, y: 0 });
    const g = gazeOffset({ x: 0, y: 0 }, { x: 1000, y: 0 });
    expect(g.x).toBeCloseTo(2.6);
    expect(gazeOffset({ x: 0, y: 0 }, { x: -50, y: 0 }).x).toBeGreaterThan(-2.6);
  });

  it('perches on the assistant, or beside it when there is no room above, inside the window', () => {
    const view = { width: 1440, height: 900 };
    const card = { left: 1020, top: 240, right: 1420, bottom: 880 };
    const onTop = perchBeside(card, size, view, 12, 64);
    expect(onTop.y + size.height).toBeGreaterThan(card.top); // sitting on the edge
    expect(onTop.y + size.height).toBeLessThanOrEqual(card.top + 12);
    expect(onTop.x).toBeGreaterThanOrEqual(card.left);
    const high = { left: 1020, top: 76, right: 1420, bottom: 716 };
    const beside = perchBeside(high, size, view, 12, 64);
    expect(beside.x + size.width).toBeLessThanOrEqual(high.left);
    expect(beside.y).toBe(82);
    const leftCard = { left: 20, top: 76, right: 420, bottom: 716 };
    expect(perchBeside(leftCard, size, view, 12, 64).x).toBeGreaterThanOrEqual(leftCard.right);
    expect(boxAt(perchBeside({ left: 0, top: 0, right: 1440, bottom: 900 }, size, view), size).right).toBeLessThanOrEqual(1432);
  });
});

describe('the few places Flurry rests in the app', () => {
  const view = { width: 1440, height: 900 };
  const frame = { left: 256, top: 56, gap: 20, home: { x: 1364, y: 824 }, sidebarPerch: { x: 196, y: 700 } };
  it('is a short, fixed list: home, the corners and edges, and the sidebar on large screens', () => {
    const spots = restingSpots(view, { width: 56, height: 56 }, frame);
    expect(spots.map((s) => s.id)).toEqual(['home', 'right', 'top-right', 'bottom-left', 'sidebar']);
    expect(restingSpots(view, { width: 56, height: 56 }, { ...frame, sidebarPerch: null }).some((s) => s.id === 'sidebar')).toBe(false);
  });
  it('never picks where it is, something open, the pointer or a busy spot', () => {
    const spots = restingSpots(view, { width: 56, height: 56 }, frame);
    const base = { size: { width: 56, height: 56 }, from: frame.home, avoid: [] as Box[], pointer: null, recent: [] };
    for (let i = 0; i < 40; i++) {
      const s = pickResting(spots, { ...base, busyOf: (p) => (p.x < 300 ? 0.9 : 0) }, seeded(i));
      expect(s).not.toBeNull();
      expect(s!.id).not.toBe('home');
      expect(s!.id).not.toBe('bottom-left');
      expect(s!.id).not.toBe('sidebar');
    }
    const open = { left: 1300, top: 0, right: 1440, bottom: 900 };
    expect(pickResting(spots, { ...base, busyOf: () => 0, avoid: [open], from: { x: 600, y: 400 } }, seeded())?.p.x).toBeLessThan(1300);
    expect(pickResting(spots, { ...base, busyOf: () => 1 }, seeded())).toBeNull();
  });
  it('perches on the sidebar now and then, not most of the time', () => {
    const spots = restingSpots(view, { width: 56, height: 56 }, frame);
    let sidebar = 0;
    const rand = seeded(3);
    for (let i = 0; i < 400; i++) if (pickResting(spots, { size: { width: 56, height: 56 }, from: frame.home, busyOf: () => 0, avoid: [], pointer: null, recent: [] }, rand)?.id === 'sidebar') sidebar++;
    expect(sidebar).toBeGreaterThan(20);
    expect(sidebar).toBeLessThan(120);
  });
});

describe('carrying Flurry and pointing', () => {
  it('trails behind the pointer, then catches up, and sways with the movement', () => {
    let at = { x: 0, y: 0 };
    const first = followStep(at, { x: 100, y: 0 }, 1 / 60);
    expect(first.p.x).toBeGreaterThan(10);
    expect(first.p.x).toBeLessThan(40);
    expect(first.sway).toBeLessThan(0);
    for (let i = 0; i < 60; i++) at = followStep(at, { x: 100, y: 0 }, 1 / 60).p;
    expect(at.x).toBeGreaterThan(99);
    expect(followStep({ x: 0, y: 0 }, { x: 100, y: 0 }, 1 / 30).p.x).toBeGreaterThan(first.p.x);
  });
  it('faces and aims at what it points to', () => {
    expect(aimAt({ x: 100, y: 100 }, { x: 300, y: 100 })).toEqual({ flip: false, aim: 0, lookY: 0 });
    const left = aimAt({ x: 300, y: 100 }, { x: 100, y: 300 });
    expect(left.flip).toBe(true);
    expect(left.aim).toBe(45);
    expect(aimAt({ x: 0, y: 500 }, { x: 10, y: 0 }).aim).toBe(-50);
  });
  it('stands beside something on the side with room, inside the window', () => {
    const view = { width: 1440, height: 900 };
    const s = { width: 56, height: 56 };
    expect(besideBox({ left: 600, top: 300, right: 640, bottom: 340 }, s, view).x).toBe(640 + 12);
    expect(besideBox({ left: 1200, top: 300, right: 1240, bottom: 340 }, s, view).x).toBe(1200 - 56 - 12);
    expect(besideBox({ left: 20, top: 300, right: 60, bottom: 340 }, s, view).x).toBe(72);
    expect(besideBox({ left: 600, top: 880, right: 640, bottom: 900 }, s, view).y).toBe(900 - 56 - 8);
  });
  it('stands just under a row of controls, centred on the one it means, inside the window', () => {
    const view = { width: 1440, height: 900 };
    const s = { width: 56, height: 56 };
    expect(belowBox({ left: 600, top: 300, right: 700, bottom: 330 }, s, view)).toEqual({ x: 650 - 28, y: 340 });
    expect(belowBox({ left: 1400, top: 300, right: 1440, bottom: 330 }, s, view).x).toBe(1440 - 56 - 8);
    expect(belowBox({ left: 600, top: 860, right: 700, bottom: 890 }, s, view).y).toBe(900 - 56 - 8);
  });
  it('puts its note towards the middle of the window', () => {
    expect(noteSide({ x: 1300, y: 800 }, { width: 56, height: 56 }, { width: 1440, height: 900 })).toEqual({ side: 'left', above: true });
    expect(noteSide({ x: 300, y: 100 }, { width: 56, height: 56 }, { width: 1440, height: 900 })).toEqual({ side: 'right', above: false });
  });
});
