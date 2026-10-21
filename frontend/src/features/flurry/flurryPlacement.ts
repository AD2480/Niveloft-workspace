/**
 * Where Flurry rests: pure geometry, kept free of React so it can be tested on its own.
 */

/** Flurry's home corner: where it rests when it isn't roaming, and where it naps. */
export type FlurryCorner = 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
export const FLURRY_CORNERS: readonly FlurryCorner[] = ['bottom-right', 'bottom-left', 'top-right', 'top-left'];

/** The corner nearest to a point (the centre of Flurry where a drag ended). */
export function nearestCorner(x: number, y: number, viewport: { width: number; height: number }): FlurryCorner {
  const top = y < viewport.height / 2;
  const left = x < viewport.width / 2;
  return `${top ? 'top' : 'bottom'}-${left ? 'left' : 'right'}` as FlurryCorner;
}

/** The corner across from this one on the same edge (where Flurry steps aside to). */
export function oppositeCorner(c: FlurryCorner): FlurryCorner {
  const [v, h] = c.split('-') as ['top' | 'bottom', 'left' | 'right'];
  return `${v}-${h === 'left' ? 'right' : 'left'}` as FlurryCorner;
}

/** Whether two rectangles overlap once `a` is grown by `pad` on every side. */
export function overlaps(a: { left: number; top: number; right: number; bottom: number }, b: { left: number; top: number; right: number; bottom: number }, pad = 0): boolean {
  return a.left - pad < b.right && a.right + pad > b.left && a.top - pad < b.bottom && a.bottom + pad > b.top;
}
