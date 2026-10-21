/**
 * The snowpack: a project drawn as a cut-away block of snow, one layer per state, read the way an
 * avalanche forecaster reads a snow pit. Approved work is the firm snow at the base, then work in
 * review, work in progress, and fresh snow on top (work nobody has started). Each task is one slice
 * of its layer, and the late task holding the most work up is the weak layer, in red.
 *
 * This file is the pure part (layer heights, slices, the scroll story), so it's tested; the drawing
 * is in SnowpackScene.ts.
 */

export type LayerKey = 'done' | 'review' | 'progress' | 'todo';

/** Bottom to top. */
export const LAYER_ORDER: LayerKey[] = ['done', 'review', 'progress', 'todo'];

/** Top to bottom: the order the front page reads them in, the way you read a snow pit. */
export const READING_ORDER: LayerKey[] = ['todo', 'progress', 'review', 'done'];

export const LAYER_WORD: Record<LayerKey, string> = {
  todo: 'Not started',
  progress: 'In progress',
  review: 'In review',
  done: 'Approved',
};

export interface BlockTask {
  key: string;
  title: string;
  layer: LayerKey;
  /** Days past its due date (0 when it isn't late). */
  late: number;
  /** Unfinished work waiting on it, directly or through others. */
  holdsUp: string[];
}

/** What a snowpack drawing needs: the tasks in their layers, the counts, and the weak layer. */
export interface SnowpackData {
  tasks: (BlockTask & { id?: number; owner?: string | null })[];
  counts: Record<LayerKey, number>;
  /** The late task holding the most unfinished work up, if any. */
  weak: BlockTask | null;
}

export interface LayerBand {
  key: LayerKey;
  count: number;
  /** Bottom and top of the layer (before the waves), in world units above the plinth. */
  y0: number;
  y1: number;
}

/**
 * Layer heights: proportional to the number of tasks, with a floor so a layer of one task is still a
 * readable band, and an empty layer a hairline.
 */
export function layerBands(counts: Record<LayerKey, number>, height = 2.6, floor = 0.075): LayerBand[] {
  const total = LAYER_ORDER.reduce((n, k) => n + counts[k], 0);
  const raw = LAYER_ORDER.map((k) => (total === 0 ? 1 / LAYER_ORDER.length : counts[k] === 0 ? 0.012 : Math.max(floor, counts[k] / total)));
  const sum = raw.reduce((a, b) => a + b, 0);
  let y = 0;
  return LAYER_ORDER.map((key, i) => {
    const h = (raw[i] / sum) * height;
    const band = { key, count: counts[key], y0: y, y1: y + h };
    y += h;
    return band;
  });
}

/** Splits a width into n equal slices with a gap between them (one slice per task). */
export function sliceSpans(n: number, width: number, gap = 0.05): [number, number][] {
  if (n <= 0) return [];
  const w = (width - gap * (n - 1)) / n;
  return Array.from({ length: n }, (_, i) => {
    const x0 = -width / 2 + i * (w + gap);
    return [x0, x0 + w] as [number, number];
  });
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (t: number) => t * t * (3 - 2 * t);

export type StoryFocus = LayerKey | 'weak' | null;

/** What the story shows at scroll position `s` (0 = the first screen; 1…5 = the five layers read top down; 6 = past it). */
export interface StoryState {
  /** 0 = the block whole, 1 = its layers lifted apart. */
  explode: number;
  /** The layer being read, if any. */
  focus: StoryFocus;
  /** Which step is being read (0 = none), for the words beside it. */
  step: number;
  /** A slow turn of the block with the scroll, in radians. */
  turn: number;
}

export const STORY_FOCUS: Exclude<StoryFocus, null>[] = ['todo', 'progress', 'review', 'done', 'weak'];

export function storyAt(s: number): StoryState {
  const explode = smooth(clamp01((s - 0.15) / 0.85)) * (1 - smooth(clamp01((s - 5.35) / 0.65)));
  const step = s < 0.55 || s >= 5.6 ? 0 : Math.min(5, Math.max(1, Math.round(s)));
  return { explode, focus: step ? STORY_FOCUS[step - 1] : null, step, turn: -0.22 * smooth(clamp01(s / 5.5)) };
}

/** The late task holding the most unfinished work up (the weak layer), if there is one. */
export function weakTask(tasks: BlockTask[]): BlockTask | null {
  const late = tasks.filter((t) => t.late > 0 && t.holdsUp.length > 0 && t.layer !== 'done');
  late.sort((a, b) => b.holdsUp.length - a.holdsUp.length || b.late - a.late);
  return late[0] ?? null;
}

/** Deterministic smooth noise in [-1, 1] (value noise), so the snow's waves are the same on every load. */
export function waves(x: number, z: number, seed = 0): number {
  const h = (i: number, j: number) => {
    const s = Math.sin(i * 127.1 + j * 311.7 + seed * 74.7) * 43758.5453;
    return (s - Math.floor(s)) * 2 - 1;
  };
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const xf = x - xi;
  const zf = z - zi;
  const u = smooth(xf);
  const v = smooth(zf);
  const a = h(xi, zi);
  const b = h(xi + 1, zi);
  const c = h(xi, zi + 1);
  const d = h(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
