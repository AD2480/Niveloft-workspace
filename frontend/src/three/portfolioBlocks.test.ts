import { describe, expect, it } from 'vitest';
import { blockBands, blockHeight, flatBlock, slotUnit, BLOCK_MAX_H, BLOCK_MIN_H } from './portfolioBlocks';

const counts = (done: number, review: number, progress: number, todo: number) => ({ done, review, progress, todo });

describe('Today’s project blocks', () => {
  it('lays late work down as one red layer above the approved base, counting nothing twice', () => {
    const b = blockBands(counts(3, 2, 4, 3), { review: 1, progress: 2, todo: 0, done: 5 }, 1);
    expect(b.map((x) => x.key)).toEqual(['done', 'weak', 'review', 'progress', 'todo']);
    expect(b.map((x) => x.count)).toEqual([3, 3, 1, 2, 3]);
    expect(b.reduce((n, x) => n + x.count, 0)).toBe(12);
    // Stacked from the base, edge to edge, to the full height.
    expect(b[0].y0).toBe(0);
    for (let i = 1; i < b.length; i++) expect(b[i].y0).toBeCloseTo(b[i - 1].y1, 9);
    expect(b[b.length - 1].y1).toBeCloseTo(1, 9);
  });

  it('has no weak layer when nothing is late, and never takes more late work than a layer holds', () => {
    expect(blockBands(counts(2, 1, 1, 1), {}, 1).map((x) => x.key)).toEqual(['done', 'review', 'progress', 'todo']);
    const b = blockBands(counts(0, 1, 0, 0), { review: 9 }, 1);
    expect(b.find((x) => x.key === 'weak')?.count).toBe(1);
    expect(b.find((x) => x.key === 'review')?.count).toBe(0);
  });

  it('grows a block with the square root of its tasks, within bounds', () => {
    expect(blockHeight(0, 10)).toBeLessThan(BLOCK_MIN_H);
    expect(blockHeight(10, 10)).toBeCloseTo(BLOCK_MAX_H, 9);
    const quarter = blockHeight(10, 40);
    expect(quarter).toBeCloseTo(BLOCK_MIN_H + (BLOCK_MAX_H - BLOCK_MIN_H) * 0.5, 9);
    expect(blockHeight(5, 40)).toBeLessThan(quarter);
  });

  it('draws the flat block with its plinth, its layers and fresh snow on top, in a finite box', () => {
    const { faces, box } = flatBlock(counts(3, 1, 2, 2), { progress: 1 }, 12);
    expect(faces.some((f) => f.fill === 'plinth')).toBe(true);
    expect(faces.some((f) => f.fill === 'weak')).toBe(true);
    expect(faces.some((f) => f.fill === 'snow' && f.shade === 2)).toBe(true);
    expect(box.every(Number.isFinite)).toBe(true);
    expect(box[2]).toBeGreaterThan(box[0]);
    expect(box[3]).toBeGreaterThan(box[1]);
  });

  it('sizes every slot so the tallest block fits', () => {
    const wide = slotUnit(300, 176);
    const narrow = slotUnit(160, 176);
    expect(wide).toBeGreaterThan(0);
    expect(narrow).toBeLessThanOrEqual(wide);
  });
});
