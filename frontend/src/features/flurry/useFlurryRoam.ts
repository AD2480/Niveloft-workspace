import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { boxAt, boxesOverlap, candidateSpots, centre, clampInto, flightAt, gazeOffset, pickResting, pickSpot, planFlight, type Box, type Flight, type Pt, type RestingSpot, type RoamMode, type Size } from './roam';

/**
 * Flurry's comings and goings: rests a while, then flies to another spot; naps after a long quiet
 * spell; holds still while you point at it, focus it or open its menu; and goes wherever it's
 * anchored (beside the assistant when called, or its corner when it isn't roaming).
 *
 * Moves are drawn by writing the element's transform directly (no re-render per frame). Without
 * motion (reduced motion, "Keep Flurry still") every move is a jump and the eyes don't follow.
 */

export type RoamPhase = 'rest' | 'flying' | 'anchored' | 'nap';

export interface RoamOptions {
  /** The element that moves: fixed, at the top left, positioned by transform. */
  el: RefObject<HTMLElement | null>;
  size: Size;
  /** Wander from spot to spot (otherwise it stays at `anchor`). */
  roam: boolean;
  /** Animate moves and follow the pointer with the eyes. */
  motion: boolean;
  mode: RoamMode;
  /** Where it may go. */
  area: () => Box;
  /** Somewhere to be and stay; null to roam. */
  anchor: Pt | null;
  /** Hold still where it is (pointed at, focused, its menu open, being dragged). */
  hold: boolean;
  /** Places it must not land on right now. */
  avoid: () => Box[];
  /** How much of the page's content a box would cover (0 … 1). */
  busy: (b: Box) => number;
  /** Its home spot: always allowed, and where it naps. */
  home: () => Pt;
  /** Quiet time before a nap, in ms (0: never). */
  napAfter?: number;
  /** How long it rests on a spot, in ms. */
  restMs?: [number, number];
  /** Only move on while the person has been away this long (ms): no roaming while they work. */
  idleBeforeRoam?: number;
  /** A fixed list of resting spots to choose from (otherwise spots anywhere along the edges). */
  spots?: () => RestingSpot[];
  /** Calm motion: moves are a short fade out and in, not a flight. */
  fade?: boolean;
  /** Checked before every move: true holds it where it is for now (a menu is open, a drag is on). */
  pause?: () => boolean;
}

const now = () => performance.now();

export function useFlurryRoam(o: RoamOptions) {
  const opts = useRef(o);
  opts.current = o;
  const pos = useRef<Pt | null>(null);
  const [phase, setPhaseState] = useState<RoamPhase>('rest');
  const phaseRef = useRef<RoamPhase>('rest');
  const [curious, setCurious] = useState(false);
  const flight = useRef<{ f: Flight; start: number; raf: number; timer?: number; after: RoamPhase } | null>(null);
  const timer = useRef(0);
  const recent = useRef<Pt[]>([]);
  const pointer = useRef<Pt | null>(null);
  const lastInput = useRef(now());
  const rand = useRef(Math.random);
  /** A glance at something (a task you selected, what Flurry points at) overrides the pointer until then. */
  const glanceUntil = useRef(0);

  const setPhase = useCallback((p: RoamPhase) => {
    phaseRef.current = p;
    setPhaseState(p);
  }, []);

  const apply = useCallback((p: Pt, tilt = 0) => {
    pos.current = p;
    const el = opts.current.el.current;
    if (!el) return;
    el.style.transform = `translate3d(${Math.round(p.x)}px, ${Math.round(p.y)}px, 0)`;
    el.style.setProperty('--tilt', `${tilt.toFixed(2)}deg`);
    el.style.visibility = 'visible';
  }, []);

  const stopFlight = useCallback(() => {
    if (flight.current) {
      cancelAnimationFrame(flight.current.raf);
      if (flight.current.timer) window.clearTimeout(flight.current.timer);
      const el = opts.current.el.current;
      if (el && el.style.opacity === '0') el.style.opacity = '1';
    }
    flight.current = null;
  }, []);

  const fly = useCallback(
    (to: Pt, after: RoamPhase) => {
      stopFlight();
      const from = pos.current;
      if (!from || !opts.current.motion || Math.hypot(to.x - from.x, to.y - from.y) < 2) {
        apply(to);
        setPhase(after);
        return;
      }
      const el = opts.current.el.current;
      if (opts.current.fade && el) {
        // Calm: fade out, appear there, fade back in.
        const state: { f: Flight; start: number; raf: number; timer?: number; after: RoamPhase } = { f: planFlight(from, to, rand.current), start: now(), raf: 0, after };
        flight.current = state;
        setPhase('flying');
        el.style.transition = 'opacity 160ms ease';
        el.style.opacity = '0';
        state.timer = window.setTimeout(() => {
          if (flight.current !== state) return;
          flight.current = null;
          apply(to, 0);
          el.style.opacity = '1';
          window.setTimeout(() => {
            if (el.style.opacity === '1') el.style.transition = '';
          }, 200);
          setPhase(after);
        }, 170);
        return;
      }
      const f = planFlight(from, to, rand.current);
      const state = { f, start: now(), raf: 0, after };
      flight.current = state;
      setPhase('flying');
      const tick = () => {
        if (flight.current !== state) return;
        const t = Math.min(1, (now() - state.start) / f.duration);
        const at = flightAt(f, t);
        apply(at.p, at.tilt);
        if (t < 1) state.raf = requestAnimationFrame(tick);
        else {
          flight.current = null;
          apply(to, 0);
          setPhase(after);
        }
      };
      state.raf = requestAnimationFrame(tick);
    },
    [apply, setPhase, stopFlight],
  );

  /** Picks a new spot and flies there. `flee`: a box to get well away from (a field being typed in). */
  const hop = useCallback(
    (flee: Box | null = null) => {
      const c = opts.current;
      const from = pos.current;
      if (!from) return false;
      const area = c.area();
      const size = c.size;
      const home = clampInto(c.home(), area, size);
      const avoid = c.avoid();
      if (c.spots) {
        const spot = pickResting(c.spots(), { size, from, busyOf: (p) => c.busy(boxAt(p, size)), avoid: flee ? [...avoid, flee] : avoid, pointer: pointer.current, recent: recent.current }, rand.current);
        if (!spot) return false;
        recent.current = [from, ...recent.current].slice(0, 2);
        fly(spot.p, 'rest');
        return true;
      }
      const cands = [...candidateSpots(area, size, c.mode, rand.current), home];
      const busyOf = (p: Pt) => {
        const b = c.busy(boxAt(p, size));
        // Its home corner is always an acceptable place to be.
        return p === home ? Math.min(b, 0.25) : b > 0.6 ? 10 : b;
      };
      const next = pickSpot(cands, busyOf, { size, from, avoid: flee ? [...avoid, flee] : avoid, pointer: pointer.current, recent: recent.current, flee }, rand.current);
      if (!next) return false;
      recent.current = [from, ...recent.current].slice(0, 3);
      fly(next, 'rest');
      return true;
    },
    [fly],
  );

  /**
   * The least busy of its resting spots that's clearly better than `here` (how busy where it is now
   * is), or null. Used to keep it off content: it never stays on buttons, fields, text or chart labels
   * when there's somewhere emptier to be (the sidebar perch, when nothing else is free).
   */
  const clearerSpot = useCallback((here: number): Pt | null => {
    const c = opts.current;
    if (!c.spots || !pos.current) return null;
    const from = pos.current;
    const avoid = c.avoid();
    const best = c
      .spots()
      .filter((s) => Math.hypot(s.p.x - from.x, s.p.y - from.y) >= 40 && !avoid.some((b) => boxesOverlap(boxAt(s.p, c.size), b, 16)))
      .map((s) => ({ p: s.p, b: c.busy(boxAt(s.p, c.size)) + (s.id === 'sidebar' ? 0.05 : 0) }))
      .filter((x) => x.b <= here - 0.11)
      .sort((a, b) => a.b - b.b)[0];
    return best?.p ?? null;
  }, []);

  /** If it's covering content (a page loaded or scrolled under it), move somewhere clearer. Returns whether it moved. */
  const settleClear = useCallback((): boolean => {
    const c = opts.current;
    if (!pos.current || c.anchor || flight.current || c.hold || c.pause?.() || phaseRef.current === 'flying') return false;
    // Even two of its nine sample points on text or a control is too much to sit on.
    const here = c.busy(boxAt(pos.current, c.size));
    if (here < 0.2) return false;
    const to = clearerSpot(here);
    if (!to) return false;
    fly(to, phaseRef.current === 'nap' ? 'nap' : 'rest');
    return true;
  }, [clearerSpot, fly]);

  const schedule = useCallback(
    (delay?: number) => {
      window.clearTimeout(timer.current);
      const [lo, hi] = opts.current.restMs ?? [6500, 14000];
      timer.current = window.setTimeout(
        () => {
          const c = opts.current;
          const idle = now() - lastInput.current;
          const blocked = !c.roam || c.anchor || c.hold || document.hidden || flight.current || phaseRef.current === 'nap' || c.pause?.();
          if (blocked) {
            schedule(4000);
            return;
          }
          // A long quiet spell: go home and nap until something happens.
          if (c.napAfter && idle > c.napAfter) {
            const home = clampInto(c.home(), c.area(), c.size);
            const busyHome = c.busy(boxAt(home, c.size));
            fly(busyHome >= 0.2 ? (clearerSpot(busyHome) ?? home) : home, 'nap');
            return;
          }
          // Still while the person works: move on only once they've been away a while.
          if (c.idleBeforeRoam && idle < c.idleBeforeRoam) {
            schedule(Math.max(1500, c.idleBeforeRoam - idle + 200));
            return;
          }
          hop();
          schedule();
        },
        delay ?? lo + rand.current() * (hi - lo),
      );
    },
    [clearerSpot, fly, hop],
  );

  // Where it starts: its anchor, or home.
  useLayoutEffect(() => {
    if (!pos.current) apply(o.anchor ?? clampInto(o.home(), o.area(), o.size));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Its size became known (or changed): settle into place again.
  useEffect(() => {
    const c = opts.current;
    if (!pos.current || flight.current || c.anchor) return;
    const home = clampInto(c.home(), c.area(), c.size);
    apply(Math.hypot(pos.current.x - home.x, pos.current.y - home.y) < 32 ? home : clampInto(pos.current, c.area(), c.size));
  }, [o.size.width, o.size.height, apply]);
  // Re-apply after renders (React doesn't own the transform).
  useLayoutEffect(() => {
    if (pos.current && !flight.current) apply(pos.current);
  });

  // Anchored: go there and stay. Unanchored: roam (or rest where it is).
  const ax = o.anchor?.x;
  const ay = o.anchor?.y;
  useEffect(() => {
    const c = opts.current;
    if (ax !== undefined && ay !== undefined) {
      window.clearTimeout(timer.current);
      fly({ x: ax, y: ay }, 'anchored');
      return;
    }
    if (phaseRef.current === 'anchored') setPhase('rest');
    if (c.roam) schedule(phaseRef.current === 'rest' ? 2500 : undefined);
    return () => window.clearTimeout(timer.current);
  }, [ax, ay, o.roam, fly, schedule, setPhase]);

  // Held: stop where it is (unless it's on its way somewhere it was sent, like the assistant).
  useEffect(() => {
    if (!o.hold || !flight.current || flight.current.after === 'anchored') return;
    stopFlight();
    if (pos.current) apply(pos.current, 0);
    setPhase('rest');
  }, [o.hold, apply, setPhase, stopFlight]);

  // Input: wakes it from a nap; the pointer is watched for the eyes and for where not to land.
  useEffect(() => {
    let raf = 0;
    const wake = () => {
      lastInput.current = now();
      if (phaseRef.current === 'nap') {
        setPhase('rest');
        schedule(5000);
      }
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      pointer.current = { x: e.clientX, y: e.clientY };
      wake();
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const c = opts.current;
        const el = c.el.current;
        const p = pos.current;
        if (!el || !p) return;
        const me = centre(p, c.size);
        const target = pointer.current;
        const near = !!target && Math.hypot(target.x - me.x, target.y - me.y) < 160;
        setCurious((was) => (was === near ? was : near));
        if (!c.motion || phaseRef.current === 'nap' || now() < glanceUntil.current) return;
        const g = gazeOffset(me, target);
        el.style.setProperty('--gx', `${g.x.toFixed(2)}px`);
        el.style.setProperty('--gy', `${g.y.toFixed(2)}px`);
      });
    };
    const onLeave = () => {
      pointer.current = null;
      setCurious(false);
      opts.current.el.current?.style.setProperty('--gx', '0px');
      opts.current.el.current?.style.setProperty('--gy', '0px');
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerdown', wake, { passive: true });
    window.addEventListener('keydown', wake);
    window.addEventListener('wheel', wake, { passive: true });
    document.documentElement.addEventListener('pointerleave', onLeave);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', wake);
      window.removeEventListener('keydown', wake);
      window.removeEventListener('wheel', wake);
      document.documentElement.removeEventListener('pointerleave', onLeave);
    };
  }, [schedule, setPhase]);

  // The window changes size: stay inside it.
  useEffect(() => {
    const onResize = () => {
      const c = opts.current;
      if (!pos.current || c.anchor) return;
      stopFlight();
      apply(clampInto(pos.current, c.area(), c.size));
      if (phaseRef.current === 'flying') setPhase('rest');
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [apply, setPhase, stopFlight]);

  // A hidden tab: nothing moves.
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) {
        window.clearTimeout(timer.current);
        stopFlight();
        if (pos.current) apply(pos.current);
        if (phaseRef.current === 'flying') setPhase('rest');
      } else if (opts.current.roam && !opts.current.anchor) schedule(3000);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [apply, schedule, setPhase, stopFlight]);

  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
      stopFlight();
    },
    [stopFlight],
  );

  /** Get out of the way now (a field it covers got focus), even while held. */
  const moveNow = useCallback(
    (flee: Box | null = null) => {
      if (opts.current.anchor) return;
      if (!hop(flee) && flee) {
        // Nowhere better: go home.
        const c = opts.current;
        fly(clampInto(c.home(), c.area(), c.size), 'rest');
      }
      if (opts.current.roam) schedule();
    },
    [fly, hop, schedule],
  );

  /** Put it somewhere at once (while it's being dragged). */
  const place = useCallback(
    (p: Pt) => {
      stopFlight();
      apply(p);
    },
    [apply, stopFlight],
  );

  /** Look at a point for a while (its eyes only), instead of at the pointer. */
  const lookAt = useCallback((p: Pt | null, ms = 2200) => {
    const c = opts.current;
    const el = c.el.current;
    if (!el || !pos.current || !c.motion) return;
    const g = p ? gazeOffset(centre(pos.current, c.size), p, 3) : { x: 0, y: 0.6 };
    glanceUntil.current = now() + ms;
    el.style.setProperty('--gx', `${g.x.toFixed(2)}px`);
    el.style.setProperty('--gy', `${g.y.toFixed(2)}px`);
  }, []);

  /** Whether it currently covers a box. */
  const covers = useCallback((b: Box, pad = 24) => !!pos.current && boxesOverlap(boxAt(pos.current, opts.current.size), b, pad), []);

  return { phase, curious, pos, moveNow, place, covers, lookAt, settleClear, idleFor: () => now() - lastInput.current };
}

// ------------------------------------------------------------------------------------------ measuring the page

const CONTENT = 'a,button,input,select,textarea,label,summary,img,svg,canvas,video,table,[role="button"],[role="link"],[role="tab"],[role="checkbox"],[role="switch"],[role="slider"],[role="gridcell"],[role="row"],[contenteditable="true"]';

function hasOwnText(el: Element): boolean {
  for (const n of el.childNodes) if (n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim()) return true;
  return false;
}

const CONTROLS = 'a[href],button,input,select,textarea,summary,[role="button"],[role="tab"],[role="checkbox"],[role="switch"],[role="slider"],[role="menuitem"]';

/**
 * Whether any control (a link, button, field…) reaches into a box, even by a corner: sampling
 * points can miss the edge of a button, and half a button under Flurry is still a button you can't
 * press. `self` is ignored, and so is anything too small to be a visible control.
 */
export function controlUnder(b: Box, self: Element | null, pad = 6): boolean {
  for (const el of document.querySelectorAll(CONTROLS)) {
    if (self?.contains(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    if (r.right > b.left - pad && r.left < b.right + pad && r.bottom > b.top - pad && r.top < b.bottom + pad) return true;
  }
  return false;
}

/**
 * How much of the page's content is under a box, by looking at what's on top at nine points in
 * it: controls, text, pictures and charts count; empty background doesn't. A control reaching into
 * the box at all makes it nearly full. `self` is ignored.
 */
export function busyUnder(b: Box, self: Element | null): number {
  let busy = 0;
  for (const fx of [0.2, 0.5, 0.8]) {
    for (const fy of [0.2, 0.5, 0.8]) {
      const x = b.left + (b.right - b.left) * fx;
      const y = b.top + (b.bottom - b.top) * fy;
      const hit = document.elementsFromPoint(x, y).find((e) => !self?.contains(e));
      if (!hit || hit === document.documentElement || hit === document.body) continue;
      if (hit.closest(CONTENT) || hasOwnText(hit) || hit.closest('[data-assistant-panel],[role="dialog"],[data-radix-popper-content-wrapper]')) busy++;
    }
  }
  return controlUnder(b, self) ? Math.max(busy / 9, 0.9) : busy / 9;
}

/** How much of a box is covered by any of these rectangles (0 … 1). */
export function busyFromRects(b: Box, rects: Box[]): number {
  const area = Math.max(1, (b.right - b.left) * (b.bottom - b.top));
  let covered = 0;
  for (const r of rects) {
    const w = Math.min(b.right, r.right) - Math.max(b.left, r.left);
    const h = Math.min(b.bottom, r.bottom) - Math.max(b.top, r.top);
    if (w > 0 && h > 0) covered += w * h;
  }
  return Math.min(1, covered / area);
}

/** Things Flurry must never land on: open menus, popovers, dialogs and notices. */
export function overlayRects(): Box[] {
  const out: Box[] = [];
  for (const el of document.querySelectorAll('[data-radix-popper-content-wrapper], [role="dialog"], [role="alertdialog"], [data-sonner-toast], [data-assistant-panel]')) {
    const r = el.getBoundingClientRect();
    if (r.width && r.height) out.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
  }
  return out;
}
