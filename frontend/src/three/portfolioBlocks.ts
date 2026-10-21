/**
 * The shape of Today's project blocks, shared by the 3D drawing (PortfolioSnowpack) and the flat
 * drawing shown while it loads or without WebGL, so the two line up. Pure (no three.js), so it's
 * tested and costs nothing to import.
 */
import { LAYER_ORDER, type LayerKey } from './snowpack';

/** Footprint (world units): a square block on a slightly larger plinth. */
export const BLOCK_SIDE = 1;
export const PLINTH_PAD = 0.2;
export const PLINTH_H = 0.09;
export const BLOCK_MIN_H = 0.5;
export const BLOCK_MAX_H = 1.15;
export const MOUND = 0.2;
/** How far each block is turned, so its front and right faces both show. */
export const BLOCK_TURN = -0.6;
/** The camera looks down at this angle. */
export const BLOCK_ELEV = (24 * Math.PI) / 180;

/** Share of a card's slot height the tallest block may use, and where the plinth's front corner sits. */
export const SLOT_FILL = 0.78;
export const SLOT_BASE = 0.9;

/**
 * The block's frame on screen (world units): `span` is the turned plinth's width, `needH` the
 * height the tallest block needs, `below` how far the plinth's front corner sits below its centre.
 */
export function blockFrame() {
  const span = (BLOCK_SIDE + PLINTH_PAD) * (Math.cos(BLOCK_TURN) + Math.abs(Math.sin(BLOCK_TURN)));
  const needH = span * Math.sin(BLOCK_ELEV) + (BLOCK_MAX_H + MOUND + PLINTH_H) * Math.cos(BLOCK_ELEV);
  const below = (span / 2) * Math.sin(BLOCK_ELEV);
  return { span, needH, below };
}

/** Pixels per world unit for a slot, so the tallest block fits (the same for every card in the grid). */
export function slotUnit(w: number, h: number): number {
  const { span, needH } = blockFrame();
  return Math.min((w * 0.62) / span, (h * SLOT_FILL) / needH);
}

export const totalOf = (c: Record<LayerKey, number>) => LAYER_ORDER.reduce((n, k) => n + c[k], 0);

/** A block's height: grows with the square root of its tasks, relative to the biggest project shown. */
export function blockHeight(total: number, biggest: number): number {
  if (total <= 0) return 0.06;
  return BLOCK_MIN_H + (BLOCK_MAX_H - BLOCK_MIN_H) * Math.sqrt(total / Math.max(total, biggest, 1));
}

/** A block's layers, bottom up: approved, then the weak layer (late work), then the rest of the open work. */
export type BlockLayerKey = LayerKey | 'weak';

export interface BlockBand {
  key: BlockLayerKey;
  count: number;
  y0: number;
  y1: number;
}

/**
 * The block's layers. Late tasks are taken out of the layers they're in and laid down as one red
 * layer just above the approved base (the weak layer, buried under the newer snow), so every layer
 * is exactly as thick as its share of the tasks and nothing is counted twice.
 */
export function blockBands(counts: Record<LayerKey, number>, late: Partial<Record<LayerKey, number>>, height: number, floor = 0.07): BlockBand[] {
  const lateIn = (k: LayerKey) => (k === 'done' ? 0 : Math.min(counts[k], Math.max(0, late[k] ?? 0)));
  const weak = lateIn('review') + lateIn('progress') + lateIn('todo');
  const entries: [BlockLayerKey, number][] = [
    ['done', counts.done],
    ['weak', weak],
    ['review', counts.review - lateIn('review')],
    ['progress', counts.progress - lateIn('progress')],
    ['todo', counts.todo - lateIn('todo')],
  ];
  // The weak layer only exists when there is late work; the four states always have a band (a hairline when empty).
  const shown = entries.filter(([k, n]) => k !== 'weak' || n > 0);
  const total = shown.reduce((sum, [, n]) => sum + n, 0);
  const raw = shown.map(([, n]) => (total === 0 ? 1 / shown.length : n === 0 ? 0.012 : Math.max(floor, n / total)));
  const sum = raw.reduce((a, b) => a + b, 0);
  let y = 0;
  return shown.map(([key, count], i) => {
    const h = (raw[i] / sum) * height;
    const band = { key, count, y0: y, y1: y + h };
    y += h;
    return band;
  });
}

/** Where a block-local point lands on screen (world units; y grows downwards), seen as in 3D. */
export function projectPoint(x: number, y: number, z: number): [number, number] {
  const c = Math.cos(BLOCK_TURN);
  const s = Math.sin(BLOCK_TURN);
  const xr = x * c + z * s;
  const zr = -x * s + z * c;
  return [xr, -(y * Math.cos(BLOCK_ELEV) - zr * Math.sin(BLOCK_ELEV))];
}

export interface FlatFace {
  points: [number, number][];
  /** Which layer it belongs to, 'weak' for the late notch, 'snow' for the top, 'plinth'. */
  fill: LayerKey | 'weak' | 'snow' | 'plinth';
  /** 0 = front (lit), 1 = side (in shade), 2 = top. */
  shade: 0 | 1 | 2;
}

/**
 * The block drawn flat: the visible faces (front, side, top) of the plinth and of each layer, in
 * drawing order, plus the bounds of the drawing.
 */
export function flatBlock(
  counts: Record<LayerKey, number>,
  late: Partial<Record<LayerKey, number>>,
  biggest: number,
): { faces: FlatFace[]; box: [number, number, number, number] } {
  const h = BLOCK_SIDE / 2;
  const p = h + PLINTH_PAD / 2;
  const faces: FlatFace[] = [];
  const quad = (pts: [number, number, number][]) => pts.map(([x, y, z]) => projectPoint(x, y, z));
  const box = (x0: number, x1: number, z0: number, z1: number, y0: number, y1: number, fill: FlatFace['fill'], top: FlatFace['fill'] | null) => {
    faces.push({
      points: quad([
        [x0, y0, z1],
        [x1, y0, z1],
        [x1, y1, z1],
        [x0, y1, z1],
      ]),
      fill,
      shade: 0,
    });
    faces.push({
      points: quad([
        [x1, y0, z1],
        [x1, y0, z0],
        [x1, y1, z0],
        [x1, y1, z1],
      ]),
      fill,
      shade: 1,
    });
    if (top)
      faces.push({
        points: quad([
          [x0, y1, z1],
          [x1, y1, z1],
          [x1, y1, z0],
          [x0, y1, z0],
        ]),
        fill: top,
        shade: 2,
      });
  };
  box(-p, p, -p, p, 0, PLINTH_H, 'plinth', 'plinth');
  const total = totalOf(counts);
  const height = blockHeight(total, biggest);
  if (total === 0) {
    box(-h, h, -h, h, PLINTH_H, PLINTH_H + height, 'todo', 'todo');
  } else {
    const bands = blockBands(counts, late, height);
    bands.forEach((b, i) => {
      const isTop = i === bands.length - 1;
      box(-h, h, -h, h, PLINTH_H + b.y0, PLINTH_H + b.y1, b.key, isTop ? (b.key === 'weak' ? 'weak' : 'snow') : null);
    });
  }
  const xs = faces.flatMap((f) => f.points.map((q) => q[0]));
  const ys = faces.flatMap((f) => f.points.map((q) => q[1]));
  return { faces, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] };
}
