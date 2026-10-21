/**
 * The snowpack block's shape and the camera that frames it, without three.js: the block's size, the
 * waves between layers, the hill of fresh snow on top, and the same perspective projection the 3D
 * scene uses. The scene (SnowpackScene.ts) builds its meshes and camera from these; the still
 * drawing (shown before the scene loads, and without WebGL) projects the same corners with them, so
 * the two line up and the one fades into the other without a jump.
 */
import { layerBands, sliceSpans, waves, type BlockTask, type LayerBand, type LayerKey } from './snowpack';
import { SNOW_PALETTES } from './snowPalette';

/** Block size (world units). */
export const W = 7.2;
export const D = 4.2;
export const H = 2.5;
export const PLINTH = 0.18;
/** How far apart the layers lift when the story reads them. */
export const LIFT = 0.46;
/** The block's resting turn (radians about the vertical): a three-quarter view. */
export const BASE_TURN = -0.52;
/** The camera's vertical field of view (degrees). */
export const FOV = 26;
/** The gap between two slices of a layer. */
export const SLICE_GAP = 0.055;

/** The waves between two layers (the boundary above layer i). */
export function interfaceY(band: LayerBand, i: number, x: number, z: number): number {
  return band.y1 + 0.034 * waves(x * 0.85 + i * 3.1, z * 0.9 + i * 1.7, i + 1);
}

/** The fresh snow on top: a soft hill towards the back left, a smaller one to the right, and drifts. */
export function topY(band: LayerBand, x: number, z: number): number {
  const hill = 0.78 * Math.exp(-((x + 1.4) ** 2 / 3.4 + (z + 0.7) ** 2 / 1.7));
  const knoll = 0.36 * Math.exp(-((x - 2.3) ** 2 / 1.5 + (z + 1.1) ** 2 / 1.0));
  const drift = 0.05 * waves(x * 1.25, z * 1.25, 7) + 0.022 * waves(x * 3.3, z * 3.3, 11);
  // Settles down to the cut edges, so the block keeps a clean outline.
  const edge = Math.min(1, (W / 2 - Math.abs(x)) / 0.55, (D / 2 - Math.abs(z)) / 0.55);
  return band.y1 + Math.max(0, hill + knoll + drift + 0.04) * Math.max(0, edge);
}

/** The surface above layer i: the hill of fresh snow for the top layer, the waves for the others. */
export function surfaceY(bands: LayerBand[], i: number, x: number, z: number): number {
  return i === bands.length - 1 ? topY(bands[i], x, z) : interfaceY(bands[i], i, x, z);
}

/** Tasks in a layer, in the order their slices run from left to right (by key number). */
export function sliceOrder<T extends { key: string }>(tasks: T[]): T[] {
  const num = (k: string) => Number(k.replace(/^\D+-/, '')) || 0;
  return tasks.slice().sort((a, b) => num(a.key) - num(b.key));
}

export interface CameraFrame {
  position: [number, number, number];
  target: [number, number, number];
  fov: number;
}

/** A three-quarter view from a little above, at a distance that fits the block with its lifted layers. */
export function cameraFrame(aspect: number, zoom = 1, compact = false): CameraFrame {
  const fov = (FOV * Math.PI) / 180;
  const radius = Math.hypot(W, D) / 2 + 0.6;
  const fitH = (radius * 1.12) / Math.sin(fov / 2);
  const fitW = (radius * 1.06) / Math.sin(Math.atan(Math.tan(fov / 2) * aspect));
  const dist = (Math.max(fitH, fitW) * 1.1) / zoom;
  const elev = ((compact ? 24 : 21) * Math.PI) / 180;
  return { position: [0, Math.sin(elev) * dist + 1.4, Math.cos(elev) * dist], target: [0, 1.55, 0], fov: FOV };
}

export interface ScreenPoint {
  x: number;
  y: number;
  /** Distance in front of the camera (larger is further away). */
  depth: number;
}

/**
 * Projects a point of the block (block coordinates: the layers' own, before the turn and the plinth)
 * onto the stage, in pixels, exactly as three.js would with the camera above and a view offset of
 * `framing` (the share of the width and height the picture is shifted by).
 */
export function blockProjector(size: { w: number; h: number }, framing: { x: number; y: number }, opts: { zoom?: number; compact?: boolean; turn?: number } = {}) {
  const aspect = size.w / Math.max(1, size.h);
  const cam = cameraFrame(aspect, opts.zoom ?? 1, opts.compact ?? false);
  const [cx, cy, cz] = cam.position;
  const [tx, ty, tz] = cam.target;
  // The camera's axes: backwards (towards the camera), right and up.
  let bx = cx - tx;
  let by = cy - ty;
  let bz = cz - tz;
  const bl = Math.hypot(bx, by, bz);
  bx /= bl;
  by /= bl;
  bz /= bl;
  // right = up × back, with up = (0, 1, 0)
  let rx = bz;
  let rz = -bx;
  const rl = Math.hypot(rx, rz);
  rx /= rl;
  rz /= rl;
  // up = back × right
  const ux = by * rz;
  const uy = bz * rx - bx * rz;
  const uz = -by * rx;
  const t = Math.tan((cam.fov * Math.PI) / 180 / 2);
  const turn = opts.turn ?? BASE_TURN;
  const c = Math.cos(turn);
  const s = Math.sin(turn);
  return (x: number, y: number, z: number): ScreenPoint => {
    // The turn about the vertical, then up onto the plinth.
    const wx = c * x + s * z;
    const wy = y + PLINTH;
    const wz = -s * x + c * z;
    const dx = wx - cx;
    const dy = wy - cy;
    const dz = wz - cz;
    const px = dx * rx + dz * rz;
    const py = dx * ux + dy * uy + dz * uz;
    const pz = -(dx * bx + dy * by + dz * bz);
    const nx = px / pz / (t * aspect);
    const ny = py / pz / t;
    return { x: ((nx + 1) / 2 - framing.x) * size.w, y: ((1 - ny) / 2 - framing.y) * size.h, depth: pz };
  };
}

// ---------------------------------------------------------------------------------------- the still

export interface StillPolygon {
  points: string;
  fill: string;
}

export interface StillLine {
  points: string;
  stroke: string;
  width: number;
}

/** A piece of the top: a shaded patch of snow, or a short stretch of seam. */
export interface TopItem {
  points: string;
  fill?: string;
  stroke?: string;
  width?: number;
}

export interface StillModel {
  shadow: string;
  /** The plinth and the walls. */
  polygons: StillPolygon[];
  /** The top's patches, back to front (drawn a little larger first, to close the hairlines between them). */
  top: StillPolygon[];
  /** The top's patches and seams together, back to front. */
  topItems: TopItem[];
  seams: StillLine[];
  /** Where the labels go: each layer's right edge, and the weak slice. */
  anchors: { id: LayerKey | 'weak'; x: number; y: number }[];
}

/** Vertical room one layer label needs, in pixels (its chip is about 24 px tall). */
export const LABEL_GAP = 27;

/**
 * Layer labels far enough apart to read: on a small block a thin layer's label (one task in review,
 * say) would sit on its neighbour's. Labels that would overlap are spread evenly around where they
 * were, keeping the layers' order top to bottom and moving each as little as it can. The weak
 * slice's label stays where it is.
 */
export function spreadLabels<T extends { id: string; y: number }>(anchors: readonly T[], gap = LABEL_GAP): T[] {
  const layers = anchors.filter((a) => a.id !== 'weak').sort((a, b) => a.y - b.y);
  if (layers.length < 2) return [...anchors];
  const clusters = layers.map((a) => ({ items: [a], top: a.y }));
  for (let i = 0; i + 1 < clusters.length; ) {
    const upper = clusters[i];
    const lower = clusters[i + 1];
    if (lower.top - (upper.top + (upper.items.length - 1) * gap) >= gap) {
      i++;
      continue;
    }
    const items = [...upper.items, ...lower.items];
    const mean = items.reduce((sum, a) => sum + a.y, 0) / items.length;
    clusters.splice(i, 2, { items, top: mean - ((items.length - 1) * gap) / 2 });
    // The bigger cluster may now reach the one above it.
    i = Math.max(0, i - 1);
  }
  const moved = new Map<string, number>();
  for (const c of clusters) c.items.forEach((a, j) => moved.set(a.id, c.top + j * gap));
  return anchors.map((a) => (moved.has(a.id) ? { ...a, y: moved.get(a.id)! } : a));
}

const hex = (v: string) => [1, 3, 5].map((i) => parseInt(v.slice(i, i + 2), 16));
/** Mixes two #rrggbb colours (t = 0 is a, t = 1 is b). */
export function mixHex(a: string, b: string, t: number): string {
  const x = hex(a);
  const y = hex(b);
  return `#${x
    .map((v, i) =>
      Math.round(v + (y[i] - v) * t)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

const pts = (list: ScreenPoint[]) => list.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

/**
 * The block as flat shapes for an SVG, from the same tasks, layers and camera as the 3D scene: the
 * plinth, each layer's front and right walls (late slices in red), the fresh snow on top shaded by
 * its slope, and the seams between slices.
 */
export function stillModel(
  tasks: BlockTask[],
  opts: { weakKey: string | null; lateKeys?: string[]; dark: boolean; size: { w: number; h: number }; framing: { x: number; y: number }; zoom?: number; compact?: boolean },
): StillModel {
  const pal = SNOW_PALETTES[opts.dark ? 'dark' : 'light'];
  const P = blockProjector(opts.size, opts.framing, { zoom: opts.zoom, compact: opts.compact });
  const counts = { done: 0, review: 0, progress: 0, todo: 0 } as Record<LayerKey, number>;
  for (const t of tasks) counts[t.layer]++;
  const bands = layerBands(counts, H);
  const late = new Set([...(opts.lateKeys ?? []), ...(opts.weakKey ? [opts.weakKey] : [])]);
  const lit = (c: string) => (opts.dark ? mixHex(c, '#000000', 0.16) : mixHex(c, '#ffffff', 0.12));
  const side = (c: string) => (opts.dark ? mixHex(c, '#000000', 0.46) : mixHex(c, '#0b1620', 0.3));
  const red = opts.dark ? pal.weak : mixHex(pal.weak, '#ffffff', 0.12);
  const polygons: StillPolygon[] = [];
  const top: StillPolygon[] = [];
  const topItems: TopItem[] = [];
  const seams: StillLine[] = [];
  const front = D / 2;
  const right = W / 2;
  const N = 24;
  const along = (a: number, b: number, n: number) => Array.from({ length: n + 1 }, (_, i) => a + ((b - a) * i) / n);
  // Pixels per world unit at the front of the block (for line widths).
  const unit = Math.hypot(P(right, 0, front).x - P(-right, 0, front).x, P(right, 0, front).y - P(-right, 0, front).y) / W;

  // The soft shadow under the plinth.
  const sw = W * 0.6;
  const sd = D * 0.7;
  const shadow = pts([P(-sw, -PLINTH, -sd), P(sw, -PLINTH, -sd), P(sw, -PLINTH, sd), P(-sw, -PLINTH, sd)]);

  // The plinth: its front and right sides, then its top (the block covers most of it).
  const pw = (W + 0.42) / 2;
  const pd = (D + 0.42) / 2;
  const bottom = -PLINTH;
  polygons.push({
    points: pts([P(pw, bottom, pd), P(pw, bottom, -pd), P(pw, 0, -pd), P(pw, 0, pd)]),
    fill: opts.dark ? mixHex(pal.plinth, '#000000', 0.35) : mixHex(pal.plinth, '#0b1620', 0.12),
  });
  polygons.push({ points: pts([P(-pw, bottom, pd), P(pw, bottom, pd), P(pw, 0, pd), P(-pw, 0, pd)]), fill: opts.dark ? pal.plinth : mixHex(pal.plinth, '#0b1620', 0.05) });
  polygons.push({ points: pts([P(-pw, 0, pd), P(pw, 0, pd), P(pw, 0, -pd), P(-pw, 0, -pd)]), fill: pal.plinthTop });

  // The layers' walls: right side, then front; late slices over them in red.
  const byLayer = new Map<LayerKey, BlockTask[]>();
  for (const t of tasks) byLayer.set(t.layer, [...(byLayer.get(t.layer) ?? []), t]);
  const below = (i: number, x: number, z: number) => (i === 0 ? 0 : interfaceY(bands[i - 1], i - 1, x, z));
  let topLayer = -1;
  bands.forEach((band, i) => {
    const list = sliceOrder(byLayer.get(band.key) ?? []);
    if (!list.length) return;
    topLayer = i;
    const face = pal.face[band.key];
    const spans = sliceSpans(list.length, W, SLICE_GAP);
    const lastLate = late.has(list[list.length - 1].key);
    // Right wall (the last slice's side).
    const zs = along(front, -front, 12);
    polygons.push({
      points: pts([
        ...zs.map((z) => P(right, below(i, right, z), z)),
        ...zs
          .slice()
          .reverse()
          .map((z) => P(right, surfaceY(bands, i, right, z), z)),
      ]),
      fill: lastLate ? side(pal.weak) : side(face),
    });
    // Front wall, as one band, with the late slices drawn over it.
    const xs = along(-right, right, N);
    polygons.push({
      points: pts([
        ...xs.map((x) => P(x, below(i, x, front), front)),
        ...xs
          .slice()
          .reverse()
          .map((x) => P(x, surfaceY(bands, i, x, front), front)),
      ]),
      fill: lit(face),
    });
    list.forEach((task, k) => {
      if (!late.has(task.key)) return;
      const [x0, x1] = spans[k];
      const sx = along(x0, x1, 4);
      polygons.push({
        points: pts([
          ...sx.map((x) => P(x, below(i, x, front), front)),
          ...sx
            .slice()
            .reverse()
            .map((x) => P(x, surfaceY(bands, i, x, front), front)),
        ]),
        fill: red,
      });
    });
    // Seams between slices, down the front wall.
    for (let k = 0; k < spans.length - 1; k++) {
      const x = (spans[k][1] + spans[k + 1][0]) / 2;
      seams.push({ points: pts([P(x, below(i, x, front), front), P(x, surfaceY(bands, i, x, front), front)]), stroke: side(face), width: Math.max(1, SLICE_GAP * unit * 0.6) });
    }
  });

  // The top: fresh snow (or the top layer's own colour, when nothing is waiting to start), shaded by its slope.
  if (topLayer >= 0) {
    const band = bands[topLayer];
    const snow = topLayer === bands.length - 1;
    const litC = snow ? (opts.dark ? mixHex(pal.snow, '#000000', 0.12) : pal.snow) : mixHex(pal.face[band.key], '#ffffff', opts.dark ? 0.08 : 0.28);
    const shadeC = snow ? (opts.dark ? mixHex(pal.snow, '#0a131b', 0.62) : mixHex(pal.snow, '#7d8d9c', 0.38)) : side(pal.face[band.key]);
    const c = Math.cos(BASE_TURN);
    const s = Math.sin(BASE_TURN);
    const L = (() => {
      const v = [-6, 10, 7];
      const l = Math.hypot(...v);
      return v.map((n) => n / l);
    })();
    const GX = 44;
    const GZ = 22;
    const y = (x: number, z: number) => surfaceY(bands, topLayer, x, z);
    const items: (TopItem & { depth: number })[] = [];
    const depth: number[][] = [];
    for (let a = 0; a < GX; a++) {
      depth.push([]);
      for (let b = 0; b < GZ; b++) {
        const x0 = -right + (W * a) / GX;
        const x1 = -right + (W * (a + 1)) / GX;
        const z0 = -front + (D * b) / GZ;
        const z1 = -front + (D * (b + 1)) / GZ;
        const xm = (x0 + x1) / 2;
        const zm = (z0 + z1) / 2;
        // The slope, from a slightly wide difference so the drifts don't speckle the shading.
        const e = 0.14;
        const gx = (y(xm + e, zm) - y(xm - e, zm)) / (2 * e);
        const gz = (y(xm, zm + e) - y(xm, zm - e)) / (2 * e);
        const nl = Math.hypot(gx, 1, gz);
        const n = [(c * -gx + s * -gz) / nl, 1 / nl, (-s * -gx + c * -gz) / nl];
        const lambert = Math.max(0, n[0] * L[0] + n[1] * L[1] + n[2] * L[2]);
        const v = Math.min(1, 0.5 * lambert + 0.5 * (0.5 + 0.5 * n[1]) + 0.08);
        const corners = [P(x0, y(x0, z0), z0), P(x1, y(x1, z0), z0), P(x1, y(x1, z1), z1), P(x0, y(x0, z1), z1)];
        const d = P(xm, y(xm, zm), zm).depth;
        depth[a].push(d);
        items.push({ depth: d, points: pts(corners), fill: mixHex(shadeC, litC, Math.pow(v, 1.6)) });
      }
    }
    // Seams between the top layer's slices, across the snow: a short piece per row, drawn just after
    // the snow beside it, so a hill nearer the camera hides the part behind it.
    const list = byLayer.get(band.key) ?? [];
    const spans = sliceSpans(list.length, W, SLICE_GAP);
    const seamColour = mixHex(shadeC, opts.dark ? '#000000' : '#4f6070', 0.3);
    const seamWidth = Math.max(1, SLICE_GAP * unit * 0.45);
    for (let k = 0; k < spans.length - 1; k++) {
      const x = (spans[k][1] + spans[k + 1][0]) / 2;
      const a = Math.min(GX - 1, Math.max(0, Math.floor(((x + right) / W) * GX)));
      for (let b = 0; b < GZ; b++) {
        const z0 = -front + (D * b) / GZ;
        const z1 = -front + (D * (b + 1)) / GZ;
        const near = Math.min(depth[a][b], depth[Math.max(0, a - 1)][b], depth[Math.min(GX - 1, a + 1)][b]);
        items.push({ depth: near - 1e-4, points: pts([P(x, y(x, z0), z0), P(x, y(x, z1), z1)]), stroke: seamColour, width: seamWidth });
      }
    }
    items.sort((p, q) => q.depth - p.depth);
    for (const it of items) topItems.push({ points: it.points, fill: it.fill, stroke: it.stroke, width: it.width });
    for (const it of items) if (it.fill) top.push({ points: it.points, fill: it.fill });
  }

  // Label anchors, as the scene places them (SnowpackScene.emitAnchors).
  const anchors: StillModel['anchors'] = bands.map((band) => {
    const p = P(right + 0.02, (band.y0 + band.y1) / 2, front - 0.05);
    return { id: band.key, x: p.x, y: p.y };
  });
  if (opts.weakKey) {
    const weak = tasks.find((t) => t.key === opts.weakKey);
    if (weak) {
      const i = bands.findIndex((b) => b.key === weak.layer);
      const list = sliceOrder(byLayer.get(weak.layer) ?? []);
      const k = list.findIndex((t) => t.key === weak.key);
      const [x0, x1] = sliceSpans(list.length, W, SLICE_GAP)[k];
      const p = P((x0 + x1) / 2, (bands[i].y0 + bands[i].y1) / 2, front);
      anchors.push({ id: 'weak', x: p.x, y: p.y });
    }
  }
  return { shadow, polygons, top, topItems, seams, anchors };
}
