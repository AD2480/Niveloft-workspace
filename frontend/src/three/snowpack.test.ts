import { describe, expect, it } from 'vitest';
import { layerBands, sliceSpans, storyAt, waves, weakTask, type BlockTask } from './snowpack';

describe('the snowpack block', () => {
  it('gives each layer a height in proportion to its tasks, stacked from the base', () => {
    const b = layerBands({ done: 6, review: 1, progress: 4, todo: 6 }, 2.5);
    expect(b.map((x) => x.key)).toEqual(['done', 'review', 'progress', 'todo']);
    expect(b[0].y0).toBe(0);
    expect(b[3].y1).toBeCloseTo(2.5, 6);
    for (let i = 1; i < b.length; i++) expect(b[i].y0).toBeCloseTo(b[i - 1].y1, 9);
    // Six tasks make a thicker layer than four, and four than one.
    const h = b.map((x) => x.y1 - x.y0);
    expect(h[0]).toBeGreaterThan(h[2]);
    expect(h[2]).toBeGreaterThan(h[1]);
    // A layer of one task is still a readable band.
    expect(h[1]).toBeGreaterThan(0.15);
  });

  it('keeps an empty layer as a hairline, and shares the height out when there are no tasks', () => {
    const b = layerBands({ done: 0, review: 0, progress: 3, todo: 2 }, 2);
    expect(b[0].y1 - b[0].y0).toBeLessThan(0.05);
    const none = layerBands({ done: 0, review: 0, progress: 0, todo: 0 }, 2);
    expect(none[3].y1).toBeCloseTo(2, 6);
  });

  it('cuts a layer into one slice per task, edge to edge, with even gaps', () => {
    const s = sliceSpans(4, 8, 0.1);
    expect(s).toHaveLength(4);
    expect(s[0][0]).toBeCloseTo(-4, 9);
    expect(s[3][1]).toBeCloseTo(4, 9);
    expect(s[1][0] - s[0][1]).toBeCloseTo(0.1, 9);
    expect(sliceSpans(0, 8)).toEqual([]);
  });

  it('tells the scroll story: whole, then lifted apart and read top down, then whole again', () => {
    expect(storyAt(0)).toMatchObject({ explode: 0, focus: null, step: 0 });
    expect(storyAt(1)).toMatchObject({ explode: 1, focus: 'todo', step: 1 });
    expect(storyAt(2).focus).toBe('progress');
    expect(storyAt(3).focus).toBe('review');
    expect(storyAt(4).focus).toBe('done');
    expect(storyAt(5).focus).toBe('weak');
    expect(storyAt(6)).toMatchObject({ explode: 0, focus: null, step: 0 });
    // It lifts smoothly.
    expect(storyAt(0.5).explode).toBeGreaterThan(0);
    expect(storyAt(0.5).explode).toBeLessThan(1);
  });

  it('finds the weak layer: late, unfinished and holding the most work up', () => {
    const t = (key: string, late: number, holdsUp: string[], layer: BlockTask['layer'] = 'progress'): BlockTask => ({ key, title: key, layer, late, holdsUp });
    expect(weakTask([t('A-1', 3, ['A-2']), t('A-3', 1, ['A-4', 'A-5']), t('A-6', 5, [])])?.key).toBe('A-3');
    expect(weakTask([t('A-1', 0, ['A-2'])])).toBeNull();
    expect(weakTask([t('A-1', 4, ['A-2'], 'done')])).toBeNull();
  });

  it('draws the same waves every time, within bounds', () => {
    expect(waves(1.3, 2.7, 4)).toBe(waves(1.3, 2.7, 4));
    for (let i = 0; i < 50; i++) {
      const v = waves(i * 0.37, i * 0.53, 2);
      expect(Math.abs(v)).toBeLessThanOrEqual(1);
    }
  });
});
