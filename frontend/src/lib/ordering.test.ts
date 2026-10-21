import { describe, expect, it } from 'vitest';
import { MIN_POSITION_GAP, placeBetween, POSITION_GAP, positionBetween } from './ordering';

const col = (...positions: number[]) => positions.map((position, i) => ({ id: i + 1, position }));

describe('positionBetween', () => {
  it('handles empty columns and both ends', () => {
    expect(positionBetween(undefined, undefined)).toBe(POSITION_GAP);
    expect(positionBetween(undefined, 1024)).toBe(0);
    expect(positionBetween(2048, undefined)).toBe(2048 + POSITION_GAP);
  });
  it('returns the midpoint, or null when the gap is exhausted', () => {
    expect(positionBetween(1024, 2048)).toBe(1536);
    expect(positionBetween(1, 1 + MIN_POSITION_GAP / 2)).toBeNull();
  });
});

describe('placeBetween', () => {
  it('only changes the moved item', () => {
    const column = col(1024, 2048, 3072);
    const item = { id: 99, position: 0 };
    placeBetween(column, item, 1, 2);
    expect(item.position).toBe(1536);
    expect(column.map((c) => c.position)).toEqual([1024, 2048, 3072]);
  });
  it('appends when no neighbours are given and uses the real next item after "previous"', () => {
    const column = col(1024, 2048);
    const a = { id: 50, position: 0 };
    placeBetween(column, a, undefined, undefined);
    expect(a.position).toBe(3072);
    const b = { id: 51, position: 0 };
    placeBetween(column, b, 1, null);
    expect(b.position).toBe(1536);
  });
  it('rebalances the column when neighbours are too close', () => {
    const column = col(1, 1 + MIN_POSITION_GAP / 10);
    const item = { id: 99, position: 0 };
    placeBetween(column, item, 1, 2);
    expect(column.map((c) => c.position)).toEqual([POSITION_GAP, 2 * POSITION_GAP]);
    expect(item.position).toBe(1.5 * POSITION_GAP);
  });
});
