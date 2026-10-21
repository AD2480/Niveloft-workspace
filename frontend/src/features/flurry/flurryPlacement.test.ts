import { describe, expect, it } from 'vitest';
import { nearestCorner, oppositeCorner, overlaps } from './flurryPlacement';

describe('Flurry’s corners', () => {
  const view = { width: 1200, height: 800 };
  it('snaps a drag to the nearest corner', () => {
    expect(nearestCorner(1100, 700, view)).toBe('bottom-right');
    expect(nearestCorner(100, 700, view)).toBe('bottom-left');
    expect(nearestCorner(1100, 100, view)).toBe('top-right');
    expect(nearestCorner(100, 100, view)).toBe('top-left');
  });

  it('steps aside along the same edge', () => {
    expect(oppositeCorner('bottom-right')).toBe('bottom-left');
    expect(oppositeCorner('top-left')).toBe('top-right');
  });

  it('knows when it would cover a field', () => {
    const flurry = { left: 1100, top: 700, right: 1164, bottom: 764 };
    expect(overlaps(flurry, { left: 900, top: 720, right: 1120, bottom: 760 })).toBe(true);
    expect(overlaps(flurry, { left: 600, top: 720, right: 1080, bottom: 760 })).toBe(false);
    expect(overlaps(flurry, { left: 600, top: 720, right: 1080, bottom: 760 }, 24)).toBe(true);
  });
});
