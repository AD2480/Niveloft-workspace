/**
 * How Flurry gets about: pure geometry and choices, kept free of React and the DOM so they can be
 * tested on their own (the hook in useFlurryRoam.ts does the timing and the drawing).
 *
 * Flurry roams from one resting spot to another, preferring the edges of the page and empty space,
 * and never lands where you're working: not on the field you're typing in, not under the pointer,
 * not on an open menu, and not back where it just was. It flies in a soft arc and banks into turns.
 */

export interface Pt {
  x: number;
  y: number;
}
export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
export interface Size {
  width: number;
  height: number;
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const boxAt = (p: Pt, s: Size): Box => ({ left: p.x, top: p.y, right: p.x + s.width, bottom: p.y + s.height });
export const centre = (p: Pt, s: Size): Pt => ({ x: p.x + s.width / 2, y: p.y + s.height / 2 });
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

/** Whether two boxes overlap once `a` is grown by `pad` on every side. */
export function boxesOverlap(a: Box, b: Box, pad = 0): boolean {
  return a.left - pad < b.right && a.right + pad > b.left && a.top - pad < b.bottom && a.bottom + pad > b.top;
}

/** Keeps a top-left point inside the area, for something of `size`. */
export function clampInto(p: Pt, area: Box, size: Size): Pt {
  return { x: clamp(p.x, area.left, Math.max(area.left, area.right - size.width)), y: clamp(p.y, area.top, Math.max(area.top, area.bottom - size.height)) };
}

/** Where Flurry roams: 'free' anywhere in the area (edges preferred), 'bottom' only along the bottom edge (phones). */
export type RoamMode = 'free' | 'bottom';

/**
 * Candidate resting spots (top-left points): along the area's edges, where Flurry is least in the
 * way, and a few inside it. Phones only get spots along the bottom.
 */
export function candidateSpots(area: Box, size: Size, mode: RoamMode, rand: () => number, inner = 4): Pt[] {
  const w = Math.max(0, area.right - area.left - size.width);
  const h = Math.max(0, area.bottom - area.top - size.height);
  const at = (fx: number, fy: number): Pt => ({ x: area.left + w * clamp(fx, 0, 1), y: area.top + h * clamp(fy, 0, 1) });
  const jitter = () => (rand() - 0.5) * 0.08;
  const out: Pt[] = [];
  if (mode === 'bottom') {
    for (const fx of [0, 0.25, 0.5, 0.75, 1]) out.push(at(fx + (fx > 0 && fx < 1 ? jitter() : 0), 1));
    return out;
  }
  for (const fx of [0, 0.3, 0.55, 0.8, 1]) out.push(at(fx + jitter(), 1)); // the bottom edge
  for (const fy of [0.2, 0.5, 0.8]) out.push(at(1, fy + jitter())); // the right edge
  for (const fx of [0.35, 0.7, 1]) out.push(at(fx + jitter(), 0)); // under the top bar
  for (const fy of [0.35, 0.75]) out.push(at(0, fy + jitter())); // beside the sidebar
  for (let i = 0; i < inner; i++) out.push(at(0.15 + rand() * 0.7, 0.15 + rand() * 0.7));
  return out;
}

export interface SpotContext {
  size: Size;
  /** Where Flurry is now. */
  from: Pt;
  /** Places it must not land on: the field you're typing in, open menus, the assistant. */
  avoid: Box[];
  /** The pointer, if it's over the page. */
  pointer: Pt | null;
  /** Spots it rested on lately (it doesn't go straight back). */
  recent: Pt[];
  /** Somewhere to get away from (the field you just started typing in). */
  flee?: Box | null;
}

/**
 * How good a resting spot is: higher is better, -Infinity if it's not allowed. `busy` is how much
 * of the page's content would be under Flurry there (0 = empty space … 1 = covering text or
 * controls), measured by the caller.
 */
export function scoreSpot(p: Pt, busy: number, ctx: SpotContext): number {
  const me = boxAt(p, ctx.size);
  if (ctx.avoid.some((b) => boxesOverlap(me, b, 16))) return -Infinity;
  const c = centre(p, ctx.size);
  if (ctx.pointer && dist(c, ctx.pointer) < 110) return -Infinity; // never land under the pointer
  let score = 1 - busy * 2.5;
  // A worthwhile hop, not a twitch and not across the whole screen every time.
  const d = dist(ctx.from, p);
  score += d < 90 ? -1.5 : ctx.flee ? 0 : 0.6 - Math.abs(clamp(d, 90, 1000) - 420) / 700;
  for (const r of ctx.recent) if (dist(r, p) < 140) score -= 1.2;
  if (ctx.pointer) score += Math.min(1, dist(c, ctx.pointer) / 600) * 0.3; // a little room from where you're looking
  if (ctx.flee) {
    const fc = { x: (ctx.flee.left + ctx.flee.right) / 2, y: (ctx.flee.top + ctx.flee.bottom) / 2 };
    score += Math.min(1.5, dist(c, fc) / 400);
  }
  return score;
}

/** Picks the next resting spot: one of the best few, so the route isn't the same every time. */
export function pickSpot(cands: Pt[], busyOf: (p: Pt) => number, ctx: SpotContext, rand: () => number): Pt | null {
  const scored = cands.map((p) => ({ p, s: scoreSpot(p, busyOf(p), ctx) })).filter((x) => Number.isFinite(x.s));
  if (!scored.length) return null;
  scored.sort((a, b) => b.s - a.s);
  const top = scored.slice(0, 3).filter((x) => x.s > scored[0].s - 0.8);
  return top[Math.min(top.length - 1, Math.floor(rand() * top.length))].p;
}

export interface Flight {
  from: Pt;
  to: Pt;
  ctrl: Pt;
  duration: number;
}

/** A soft arc from one spot to the next, rising a little on the way (Flurry floats; it doesn't slide). */
export function planFlight(from: Pt, to: Pt, rand: () => number): Flight {
  const d = dist(from, to);
  const mx = (from.x + to.x) / 2;
  const my = (from.y + to.y) / 2;
  const nx = d ? -(to.y - from.y) / d : 0;
  const ny = d ? (to.x - from.x) / d : 0;
  const bend = d * (0.12 + rand() * 0.16) * (rand() < 0.5 ? -1 : 1);
  return { from, to, ctrl: { x: mx + nx * bend, y: my + ny * bend - Math.min(90, d * 0.18) }, duration: clamp(650 + d * 1.5, 800, 2600) };
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Where Flurry is `t` (0 … 1) of the way through a flight, and how far it banks (degrees). */
export function flightAt(f: Flight, t: number): { p: Pt; tilt: number } {
  const u = easeInOut(clamp(t, 0, 1));
  const m = 1 - u;
  const p = { x: m * m * f.from.x + 2 * m * u * f.ctrl.x + u * u * f.to.x, y: m * m * f.from.y + 2 * m * u * f.ctrl.y + u * u * f.to.y };
  // Bank into the direction of travel, most in the middle of the flight.
  const tx = 2 * m * (f.ctrl.x - f.from.x) + 2 * u * (f.to.x - f.ctrl.x);
  const speed = Math.sin(Math.PI * clamp(t, 0, 1));
  const tilt = clamp((tx / 600) * 14, -14, 14) * speed;
  return { p, tilt };
}

/** Which way Flurry's eyes turn to look at `target`, in drawing units (at most `max`). */
export function gazeOffset(from: Pt, target: Pt | null, max = 2.6): Pt {
  if (!target) return { x: 0, y: 0 };
  const dx = target.x - from.x;
  const dy = target.y - from.y;
  const d = Math.hypot(dx, dy);
  if (d < 1) return { x: 0, y: 0 };
  const k = (max * Math.min(1, d / 220)) / d;
  return { x: dx * k, y: dy * k * 0.75 };
}

/**
 * Where Flurry perches when it's called: sitting on the assistant's top edge (a little behind it),
 * or, when there's no room above, just beside the panel on the side with more room. Always inside
 * the window.
 */
export function perchBeside(panel: Box, size: Size, view: Size, gap = 12, minTop = 8): Pt {
  const onTop = panel.top - size.height + 10;
  if (onTop >= minTop) return { x: clamp(panel.left + 14, 8, view.width - size.width - 8), y: onTop };
  const roomLeft = panel.left;
  const roomRight = view.width - panel.right;
  const x = roomLeft >= size.width + gap || roomLeft >= roomRight ? panel.left - size.width - gap : panel.right + gap;
  return { x: clamp(x, 8, view.width - size.width - 8), y: clamp(panel.top + 6, minTop, view.height - size.height - 8) };
}

// ------------------------------------------------------------------------------------------ resting spots

/** One of the few places Flurry rests in the app. */
export interface RestingSpot {
  id: 'home' | 'bottom-right' | 'right' | 'top-right' | 'bottom-left' | 'sidebar';
  p: Pt;
}

/**
 * The few safe places Flurry rests in the app (top-left points): its home corner, the bottom-right
 * corner, halfway up the right edge, under the top bar on the right, beside the sidebar at the bottom,
 * and, on large screens, a perch on the sidebar itself. Duplicates (closer than 40 px) are dropped.
 */
export function restingSpots(view: Size, size: Size, frame: { left: number; top: number; gap: number; home: Pt; sidebarPerch?: Pt | null }): RestingSpot[] {
  const { left, top, gap } = frame;
  const right = view.width - size.width - gap;
  const bottom = view.height - size.height - gap;
  const all: RestingSpot[] = [
    { id: 'home', p: frame.home },
    { id: 'bottom-right', p: { x: right, y: bottom } },
    { id: 'right', p: { x: right, y: Math.round((top + view.height) / 2 - size.height / 2) } },
    { id: 'top-right', p: { x: right, y: top + gap } },
    { id: 'bottom-left', p: { x: left + gap, y: bottom } },
    ...(frame.sidebarPerch ? [{ id: 'sidebar' as const, p: frame.sidebarPerch }] : []),
  ];
  const out: RestingSpot[] = [];
  for (const s of all) {
    const p = { x: Math.max(8, s.p.x), y: Math.max(8, s.p.y) };
    if (!out.some((o) => dist(o.p, p) < 40)) out.push({ id: s.id, p });
  }
  return out;
}

export interface RestContext {
  size: Size;
  from: Pt;
  /** How much of the page's content would be under Flurry at a point (0 … 1). */
  busyOf: (p: Pt) => number;
  /** Places it must not land on: the field you're typing in, open menus, the assistant. */
  avoid: Box[];
  pointer: Pt | null;
  /** Spots it rested on lately. */
  recent: Pt[];
}

/**
 * The next resting spot, or null if none is free: never where it is, on something open, under the
 * pointer or over content (more than a third of it covered); the sidebar perch now and then; spots
 * it just visited less often.
 */
export function pickResting(spots: readonly RestingSpot[], ctx: RestContext, rand: () => number): RestingSpot | null {
  const ok = spots.filter((s) => {
    if (dist(s.p, ctx.from) < 60) return false;
    const me = boxAt(s.p, ctx.size);
    if (ctx.avoid.some((b) => boxesOverlap(me, b, 16))) return false;
    if (ctx.pointer && dist(centre(s.p, ctx.size), ctx.pointer) < 110) return false;
    return ctx.busyOf(s.p) <= (s.id === 'home' ? 0.45 : 0.34);
  });
  if (!ok.length) return null;
  const weight = (s: RestingSpot) => (s.id === 'sidebar' ? 0.35 : 1) * (ctx.recent.some((r) => dist(r, s.p) < 40) ? 0.3 : 1);
  const total = ok.reduce((a, s) => a + weight(s), 0);
  let r = rand() * total;
  for (const s of ok) {
    r -= weight(s);
    if (r <= 0) return s;
  }
  return ok[ok.length - 1];
}

// ------------------------------------------------------------------------------------------ carrying and pointing

/**
 * One step of Flurry following the pointer while it's carried: it trails a little behind (an
 * exponential approach, the same at any frame rate) and sways with the speed it's moved at.
 * `dt` in seconds. Returns where it is now and its sway in degrees.
 */
export function followStep(pos: Pt, target: Pt, dt: number): { p: Pt; sway: number } {
  const k = 1 - Math.exp(-18 * clamp(dt, 0, 0.1));
  const p = { x: pos.x + (target.x - pos.x) * k, y: pos.y + (target.y - pos.y) * k };
  const vx = dt > 0 ? (p.x - pos.x) / dt : 0;
  return { p, sway: clamp(-vx * 0.03, -16, 16) };
}

/**
 * How Flurry points at something from where it is: whether to face left (the figure is mirrored),
 * how far below the horizontal to aim its arm (degrees) and where its eyes look (px, vertical).
 */
export function aimAt(from: Pt, target: Pt): { flip: boolean; aim: number; lookY: number } {
  const dx = target.x - from.x;
  const dy = target.y - from.y;
  const aim = clamp((Math.atan2(dy, Math.max(1, Math.abs(dx))) * 180) / Math.PI, -50, 60);
  return { flip: dx < 0, aim: Math.round(aim), lookY: Math.round(clamp(aim / 25, -2, 2.4) * 10) / 10 };
}

/**
 * Where Flurry goes to be beside something on the page (a milestone, a task): level with its middle,
 * on the side with more room, never over it, and inside the window below `minTop`.
 */
export function besideBox(box: Box, size: Size, view: Size, gap = 12, minTop = 8): Pt {
  const roomLeft = box.left;
  const roomRight = view.width - box.right;
  const left = roomLeft >= size.width + gap && (roomLeft >= roomRight || roomRight < size.width + gap);
  const x = left ? box.left - size.width - gap : box.right + gap;
  const y = (box.top + box.bottom) / 2 - size.height / 2;
  return { x: clamp(x, 8, Math.max(8, view.width - size.width - 8)), y: clamp(y, minTop, Math.max(minTop, view.height - size.height - 8)) };
}

/** Just under a box, centred on it (inside the window), for a note that shouldn't cover the row the box is in. */
export function belowBox(box: Box, size: Size, view: Size, gap = 10, minTop = 8): Pt {
  const x = (box.left + box.right) / 2 - size.width / 2;
  const y = box.bottom + gap;
  return { x: clamp(x, 8, Math.max(8, view.width - size.width - 8)), y: clamp(y, minTop, Math.max(minTop, view.height - size.height - 8)) };
}

/**
 * Where Flurry's note goes: beside it, towards the middle of the window; growing upwards from its
 * bottom edge when Flurry is in the lower half of the window, downwards from its top edge otherwise.
 */
export function noteSide(p: Pt, size: Size, view: Size): { side: 'left' | 'right'; above: boolean } {
  return { side: p.x + size.width / 2 > view.width / 2 ? 'left' : 'right', above: p.y + size.height / 2 > view.height / 2 };
}
