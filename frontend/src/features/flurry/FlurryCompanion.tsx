import { ArrowRightCircle, Check, MessageCircle, Mic, Route, SlidersHorizontal } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { endpoints, useDashboardQuery, useMyTasksQuery, useProjectsQuery } from '@/api/endpoints';
import type { AttentionItem, Dependency } from '@/api/types';
import { useAppDispatch, useAppSelector } from '@/app/store';
import { Menu, MenuContent, MenuItem, MenuLabel, MenuRadioGroup, MenuRadioItem, MenuSeparator, MenuTrigger } from '@/components/ui/Menu';
import { useAssistant } from '@/features/assistant/assistantContext';
import { cn } from '@/lib/cn';
import { useMediaQuery } from '@/lib/hooks';
import { clearFlurryCue, flurryAttention, onFlurryMoment, showFlurryCue, takeFlurryEntrance, useFlurryCue } from './flurryCues';
import { FlurryFigure, type FlurryMood } from './FlurryFigure';
import { FlurryNote } from './FlurryNote';
import { FLURRY_MODES, flurryPx, isStill, useFlurryPrefs, type FlurryCorner, type FlurryMode } from './flurryPrefs';
import { nextTaskFor } from './nextTask';
import { aimAt, belowBox, besideBox, centre, clampInto, followStep, noteSide, perchBeside, restingSpots, type Box, type Pt, type Size } from './roam';
import { busyUnder, overlayRects, useFlurryRoam } from './useFlurryRoam';

/** A press that moves less than this is a click, not a drag. */
const DRAG_THRESHOLD = 5;
/** Space between Flurry and the window's edges (and the sidebar, and the top bar). */
export const CORNER_GAP = 20;
/** The top bar's height: top corners sit below it. */
export const TOP_BAR = 56;
/** Roaming: Flurry moves on only after you've been away from the keyboard and mouse this long. */
const ROAM_AFTER_IDLE = 30_000;
/** A quiet spell this long and Flurry naps in its home corner. */
const NAP_AFTER = 180_000;
/** Typing: Flurry holds still until this long after the last key. */
const TYPING_PAUSE = 4000;

export const CORNER_LABEL: Record<FlurryCorner, string> = {
  'bottom-right': 'Bottom right',
  'bottom-left': 'Bottom left',
  'top-right': 'Top right',
  'top-left': 'Top left',
};

/** Where the left edge of the page is (beside the sidebar on large screens). */
export function pageLeft(): number {
  if (typeof window === 'undefined' || !window.matchMedia('(min-width: 1024px)').matches) return 0;
  return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--app-sidebar')) || 0;
}

/** The top-left point for something of `size` resting in `corner`. */
export function cornerPoint(corner: FlurryCorner, size: { width: number; height: number }): { x: number; y: number } {
  const [v, h] = corner.split('-');
  const x = h === 'left' ? pageLeft() + CORNER_GAP : window.innerWidth - size.width - CORNER_GAP;
  const y = v === 'top' ? TOP_BAR + CORNER_GAP : window.innerHeight - size.height - CORNER_GAP;
  return { x: Math.max(8, x), y: Math.max(8, y) };
}

const isField = (el: Element | null): el is HTMLElement =>
  el instanceof HTMLElement && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) && (el as HTMLInputElement).type !== 'checkbox' && (el as HTMLInputElement).type !== 'radio';

const rectOf = (el: Element): Box => {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
};
const visibleBox = (b: Box) => b.right > 0 && b.bottom > 0 && b.left < window.innerWidth && b.top < window.innerHeight && b.right - b.left > 0;

/** Where Flurry perches on the sidebar: sitting on the line above its footer, on the right. */
function sidebarPerch(size: Size): Pt | null {
  const item = document.querySelector('[data-app-sidebar] [data-sidebar-flurry-row]');
  const footer = item?.parentElement;
  if (!footer || !window.matchMedia('(min-width: 1024px)').matches) return null;
  const f = footer.getBoundingClientRect();
  const side = document.querySelector('[data-app-sidebar]')!.getBoundingClientRect();
  if (f.top < 200) return null;
  return { x: side.right - size.width - 14, y: f.top - size.height + 8 };
}

/** The sidebar's "Ask Flurry" item, where Flurry waits while it's hidden (or the menu button on smaller screens). */
function sidebarHome(size: Size): Pt {
  const item = document.querySelector('[data-app-sidebar] [data-sidebar-flurry]') ?? document.querySelector('[data-mobile-menu-button]');
  if (!item) return { x: 8, y: 8 };
  const r = item.getBoundingClientRect();
  return { x: r.left + 4, y: r.top + r.height / 2 - size.height / 2 };
}

/**
 * Flurry in the app: a small floating snow creature on every signed-in page.
 *
 * - **Idle**, it floats near an edge and looks around; now and then it settles on the sidebar.
 * - **Roam** (the default): it moves between a few safe resting spots, but only while you're away
 *   from the keyboard and mouse. It holds still while you type, drag tasks or use a menu, and never
 *   lands on buttons, fields, chart labels or text.
 * - **Dragged**, it follows the pointer with a little lag, stretching, and settles where you let go.
 * - **Clicked**, it turns to you and opens a compact menu: Ask Flurry · My next task · Delivery
 *   outlook, what needs you (when something does), and Roam · Stay here · Hide.
 * - **Working**, it thinks (two flakes circling) while a real request is processed; when something
 *   you did works it gives a brief happy reaction; when something needs you a small indicator shows,
 *   and the menu says exactly what (the review or the blocker).
 * - **Hidden**, it retreats into the sidebar's Flurry item until you call it back.
 * - Pages can ask it to show something (the delivery outlook, for a milestone you select): it goes
 *   beside it, points at what matters and shows a short note. Notes appear only when you asked,
 *   unless you let it speak up in Settings.
 * - On phones it has one fixed spot, and expands into its menu when tapped.
 * - Size and motion are yours to set (Settings → Flurry); reduced motion keeps it completely still.
 */
export function FlurryCompanion() {
  const a = useAssistant();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const userId = useAppSelector((s) => s.auth.user?.id ?? 0);
  const [prefs, setPrefs] = useFlurryPrefs(userId);
  const compact = !useMediaQuery('(min-width: 640px)');
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const still = isStill(prefs, reduceMotion);
  const calm = !still && prefs.motion === 'calm';
  const cue = useFlurryCue();
  const dashboard = useDashboardQuery(undefined, { pollingInterval: 180_000 });
  const mine = useMyTasksQuery({ status: 'OPEN', size: 100 });
  const projects = useProjectsQuery({ status: 'ACTIVE', size: 50 });
  const attention = useMemo(() => flurryAttention(dashboard.data?.attention ?? []), [dashboard.data]);
  const urgent = attention.filter((x) => x.severity === 'HIGH');

  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const px = compact ? 48 : flurryPx(prefs.size);
  const size = useMemo<Size>(() => ({ width: px, height: px }), [px]);
  const [, setViewport] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [landed, setLanded] = useState(false);
  const [perch, setPerch] = useState<Pt | null>(null);
  const [typing, setTyping] = useState(false);
  const [wave, setWave] = useState(false);
  const [happy, setHappy] = useState(false);
  const [alert, setAlert] = useState(false);
  const [retreating, setRetreating] = useState(false);
  const [aim, setAim] = useState<{ flip: boolean; aim: number; lookY: number } | null>(null);
  const [cueAt, setCueAt] = useState<Pt | null>(null);
  const drag = useRef<{ x: number; y: number; start: Pt; grab: Pt; moved: boolean; id: number; target: Pt; raf: number; last: number } | null>(null);
  const suppressClick = useRef(false);
  const pointerHeld = useRef(false);

  const hidden = prefs.mode === 'hide' && !retreating;
  // On phones the conversation covers the screen, so Flurry steps out while it's open.
  const hiddenNow = hidden || (compact && a.open);
  const roaming = prefs.mode === 'roam' && !still && !compact;

  useEffect(() => {
    const onResize = () => setViewport((n) => n + 1);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const home = useCallback((): Pt => (compact ? { x: window.innerWidth - size.width - 16, y: window.innerHeight - size.height - 16 } : cornerPoint(prefs.corner, size)), [compact, prefs.corner, size]);
  const area = useCallback(
    (): Box =>
      compact
        ? { left: 16, top: TOP_BAR + 16, right: window.innerWidth - 16, bottom: window.innerHeight - 16 }
        : { left: pageLeft() + CORNER_GAP, top: TOP_BAR + CORNER_GAP, right: window.innerWidth - CORNER_GAP, bottom: window.innerHeight - CORNER_GAP },
    [compact],
  );
  const stayPoint = (): Pt => {
    const view = { left: 8, top: 8, right: window.innerWidth - 8, bottom: window.innerHeight - 8 };
    if (prefs.spot) return clampInto({ x: prefs.spot.fx * window.innerWidth - size.width / 2, y: prefs.spot.fy * window.innerHeight - size.height / 2 }, view, size);
    return home();
  };
  const avoid = (): Box[] => {
    const out = overlayRects();
    const f = document.activeElement;
    if (isField(f) && !root.current?.contains(f)) out.push(rectOf(f));
    return out;
  };

  // Where a cue wants Flurry: beside what it's about (only when it may move about: Roam).
  const cueAnchorEl = cue?.anchor?.() ?? null;
  const cueStand = cue?.stand ?? 'beside';
  const mayMoveForCue = !!cue && roaming && !a.open;
  useLayoutEffect(() => {
    if (!mayMoveForCue || !cueAnchorEl) {
      setCueAt(null);
      return;
    }
    const measure = () => {
      const b = rectOf(cueAnchorEl);
      if (!visibleBox(b)) return setCueAt(null);
      const view = { width: window.innerWidth, height: window.innerHeight };
      const next = cueStand === 'below' ? belowBox(b, size, view, 10, TOP_BAR + 8) : besideBox(b, size, view, 10, TOP_BAR + 8);
      setCueAt((p) => (p && Math.abs(p.x - next.x) < 1 && Math.abs(p.y - next.y) < 1 ? p : next));
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [mayMoveForCue, cueAnchorEl, cueStand, size]);

  const anchor: Pt | null = retreating
    ? sidebarHome(size)
    : a.open && perch
      ? perch
      : cueAt
        ? cueAt
        : compact
          ? home()
          : prefs.mode === 'stay' || (still && prefs.mode === 'roam')
            ? stayPoint()
            : null;

  const roam = useFlurryRoam({
    el: root,
    size,
    roam: roaming && !a.open && !cue && !hiddenNow,
    motion: !still,
    fade: calm,
    mode: 'free',
    area,
    anchor,
    hold: hovered || focused || menuOpen || dragging || typing,
    pause: () => pointerHeld.current || !!document.querySelector('[data-radix-popper-content-wrapper], [role="dialog"]:not([data-assistant-panel])'),
    avoid,
    busy: (b) => busyUnder(b, root.current),
    home,
    spots: () => restingSpots({ width: window.innerWidth, height: window.innerHeight }, size, { left: pageLeft(), top: TOP_BAR, gap: CORNER_GAP, home: home(), sidebarPerch: sidebarPerch(size) }),
    idleBeforeRoam: ROAM_AFTER_IDLE,
    napAfter: NAP_AFTER,
    restMs: [16_000, 26_000],
  });

  // Keep clear of the page: when a page loads or fills in, or once scrolling stops, if Flurry is
  // covering buttons, fields, text or chart labels it moves to a clearer resting spot (Roam only;
  // Stay here stays where you put it; never while you type, drag or use a menu). At most once every
  // few seconds, so it never chases the page.
  const lastSettle = useRef(0);
  useEffect(() => {
    if (!roaming || hiddenNow) return;
    let t = 0;
    const check = (delay: number) => {
      window.clearTimeout(t);
      t = window.setTimeout(() => {
        if (performance.now() - lastSettle.current < 5000) return;
        if (roam.settleClear()) lastSettle.current = performance.now();
      }, delay);
    };
    check(1200);
    // Pages fill in as their data loads, and change as you work: look again every few seconds.
    const again = window.setInterval(() => check(0), 4000);
    const onScroll = () => check(700);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.clearTimeout(t);
      window.clearInterval(again);
      window.removeEventListener('scroll', onScroll, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roaming, hiddenNow, location.pathname]);

  // Called back from the sidebar: come out from there.
  useLayoutEffect(() => {
    if (hiddenNow) return;
    const from = takeFlurryEntrance();
    if (from) roam.place(from);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hiddenNow]);

  // Hiding: fly to the sidebar's Flurry item first (no flight without motion), then hide.
  useEffect(() => {
    if (!retreating) return;
    const done = () => {
      setPrefs({ mode: 'hide' });
      setRetreating(false);
    };
    if (still || roam.phase === 'anchored') {
      const t = window.setTimeout(done, still ? 0 : 150);
      return () => window.clearTimeout(t);
    }
    const t = window.setTimeout(done, 2800);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retreating, roam.phase, still]);

  // Called: fly to the conversation and perch beside it while it's open.
  useEffect(() => {
    if (!a.open || compact) {
      setPerch(null);
      return;
    }
    let raf = 0;
    let ro: ResizeObserver | null = null;
    const measure = () => {
      const panel = document.querySelector('[data-assistant-panel]');
      if (!panel) {
        raf = requestAnimationFrame(measure);
        return;
      }
      const next = perchBeside(rectOf(panel), size, { width: window.innerWidth, height: window.innerHeight }, 12, TOP_BAR + 8);
      setPerch((p) => (p && Math.abs(p.x - next.x) < 1 && Math.abs(p.y - next.y) < 1 ? p : next));
      if (!ro && typeof ResizeObserver !== 'undefined') {
        ro = new ResizeObserver(() => measure());
        ro.observe(panel);
      }
    };
    measure();
    const settle = window.setTimeout(measure, 400);
    window.addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(settle);
      ro?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [a.open, compact, size]);

  // The conversation opening ends any note; a wave on arriving.
  useEffect(() => {
    if (!a.open) return;
    clearFlurryCue();
    if (still) return;
    setWave(true);
    const t = window.setTimeout(() => setWave(false), 1600);
    return () => window.clearTimeout(t);
  }, [a.open, still]);

  // A new page ends a note from the menu (a page's own note is cleared by the page).
  useEffect(() => {
    clearFlurryCue('next-task');
  }, [location.pathname]);

  // Pointing at what the note is about.
  const cueTargetEl = cue?.target?.() ?? null;
  useEffect(() => {
    if (!cue || !cueTargetEl || hiddenNow) {
      setAim(null);
      return;
    }
    let raf = 0;
    const measure = () => {
      const p = roam.pos.current;
      const b = rectOf(cueTargetEl);
      if (!p || !visibleBox(b)) return setAim(null);
      const me = centre(p, size);
      const t = { x: (b.left + b.right) / 2, y: (b.top + b.bottom) / 2 };
      const next = aimAt(me, t);
      setAim((prev) => (prev && prev.flip === next.flip && Math.abs(prev.aim - next.aim) < 3 ? prev : next));
      roam.lookAt(t, 4000);
    };
    // After Flurry has arrived beside the anchor (or straight away when it doesn't move).
    const t = window.setTimeout(() => (raf = requestAnimationFrame(measure)), roam.phase === 'flying' ? 400 : 60);
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    return () => {
      window.clearTimeout(t);
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cue, cueTargetEl, hiddenNow, roam.phase, size]);

  // Moments: a brief happy reaction when something you did worked; a glance at a task you select.
  useEffect(() => {
    let t = 0;
    const off = onFlurryMoment((m) => {
      if (m.kind === 'happy') {
        setHappy(true);
        window.clearTimeout(t);
        t = window.setTimeout(() => setHappy(false), 1500);
      } else roam.lookAt(m.at, 2400);
    });
    return () => {
      off();
      window.clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (hiddenNow || still) return;
    const glance = (e: Event) => {
      const el = (e.target as Element | null)?.closest?.('[data-task-key], a[href*="/tasks/"]');
      if (!el || root.current?.contains(el)) return;
      const b = el.getBoundingClientRect();
      roam.lookAt({ x: b.left + b.width / 2, y: b.top + b.height / 2 }, 2400);
    };
    document.addEventListener('click', glance, true);
    document.addEventListener('focusin', glance);
    return () => {
      document.removeEventListener('click', glance, true);
      document.removeEventListener('focusin', glance);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hiddenNow, still]);

  // Something new needs you: a short raised-brows moment (and, only if you allowed it, a note).
  // What was already there when the page loaded isn't new (the indicator shows it anyway).
  const lastUrgent = useRef<string | null>(null);
  useEffect(() => {
    if (!dashboard.data) return;
    const top = urgent[0];
    const sig = urgent.map((x) => x.id).join(',');
    if (lastUrgent.current === null || !top || sig === lastUrgent.current) {
      lastUrgent.current = sig;
      return;
    }
    const isNew = !lastUrgent.current.split(',').includes(top.id);
    lastUrgent.current = sig;
    if (!isNew || hiddenNow) return;
    setAlert(true);
    const t = window.setTimeout(() => setAlert(false), 2600);
    if (prefs.speakUp && !a.open && !cue) {
      const seenKey = `projectflow.flurry.spoke.${userId}`;
      let seen: string[] = [];
      try {
        seen = JSON.parse(sessionStorage.getItem(seenKey) ?? '[]') as string[];
      } catch {
        /* private mode */
      }
      if (!seen.includes(top.id)) {
        try {
          sessionStorage.setItem(seenKey, JSON.stringify([...seen, top.id].slice(-50)));
        } catch {
          /* private mode */
        }
        showFlurryCue({ id: `attention:${top.id}`, by: 'flurry', tone: 'attention', title: top.title, text: top.reason, actions: [{ label: 'Open', to: top.link, primary: true }] });
      }
    }
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urgent.map((x) => x.id).join(','), hiddenNow, !!dashboard.data]);

  // Typing: hold still; if Flurry is over the field, get out of the way first. A held pointer
  // (dragging a task, selecting text) holds it still too.
  useEffect(() => {
    if (hiddenNow) return;
    let quiet = 0;
    const own = (el: Element) => root.current?.contains(el) || !!el.closest('[data-assistant-panel]');
    const onFocusIn = (e: FocusEvent) => {
      const el = e.target as Element | null;
      if (!isField(el) || own(el)) return;
      const field = rectOf(el);
      if (roam.covers(field, 24)) {
        if (roaming) roam.moveNow(field);
        else if (!compact) roam.place(clampInto({ x: field.left - size.width - 24, y: field.top - size.height - 8 }, area(), size));
      }
    };
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as Element | null;
      if (!isField(el) || own(el)) return;
      setTyping(true);
      window.clearTimeout(quiet);
      quiet = window.setTimeout(() => setTyping(false), TYPING_PAUSE);
    };
    const down = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) pointerHeld.current = true;
    };
    const up = () => (pointerHeld.current = false);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('pointerup', up, true);
    document.addEventListener('pointercancel', up, true);
    return () => {
      window.clearTimeout(quiet);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('pointerup', up, true);
      document.removeEventListener('pointercancel', up, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compact, hiddenNow, roaming, size]);

  // When the panel closes with focus inside it (or lost), focus comes back to Flurry.
  const wasOpen = useRef(a.open);
  useEffect(() => {
    if (wasOpen.current && !a.open) {
      const active = document.activeElement;
      const panel = document.querySelector('[data-assistant-panel]');
      if (!active || active === document.body || panel?.contains(active)) button.current?.focus();
    }
    wasOpen.current = a.open;
  }, [a.open]);

  // Clean up a drag in progress if Flurry goes away.
  useEffect(
    () => () => {
      if (drag.current) cancelAnimationFrame(drag.current.raf);
    },
    [],
  );

  // ------------------------------------------------------------------ the menu's actions

  const showNextTask = async () => {
    const tasks = mine.data?.content;
    if (!tasks) {
      showFlurryCue({ id: 'next-task', by: 'person', text: 'I couldn’t load your tasks just now. Try again in a moment.' });
      return;
    }
    // What each of your not-started tasks waits on (the dependencies of their projects).
    const projectIds = [...new Set(tasks.filter((t) => t.status === 'TODO').map((t) => t.projectId))];
    const deps: Dependency[] = [];
    await Promise.all(
      projectIds.map(async (pid) => {
        const r = dispatch(endpoints.endpoints.dependencies.initiate(pid));
        try {
          deps.push(...(await r.unwrap()));
        } catch {
          /* without them, nothing is treated as waiting */
        } finally {
          r.unsubscribe();
        }
      }),
    );
    const next = nextTaskFor(tasks, deps);
    const el = next.task ? document.querySelector(`[data-task-key="${next.task.key}"]`) : null;
    showFlurryCue({
      id: 'next-task',
      by: 'person',
      title: next.title,
      text: next.text,
      anchor: el ? () => document.querySelector(`[data-task-key="${next.task!.key}"]`) : undefined,
      target: el ? () => document.querySelector(`[data-task-key="${next.task!.key}"]`) : undefined,
      actions: next.task ? [{ label: 'Open it', to: `/projects/${next.task.projectId}/tasks/${next.task.id}`, primary: true }] : [{ label: 'OK' }],
    });
  };

  const deliveryProject = (): number | null => {
    const fromRoute = Number(/^\/projects\/(\d+)/.exec(location.pathname)?.[1] ?? NaN);
    if (Number.isFinite(fromRoute)) return fromRoute;
    const risky = (dashboard.data?.attention ?? []).find((x: AttentionItem) => x.kind === 'PROJECT_RISK' || x.kind === 'MILESTONE_RISK' || x.kind === 'BLOCKING');
    return risky?.projectId ?? projects.data?.content[0]?.id ?? null;
  };
  const openDelivery = () => {
    const id = deliveryProject();
    if (id === null) showFlurryCue({ id: 'next-task', by: 'person', text: 'You’re not a member of any active project yet, so there’s no delivery outlook to show.' });
    else navigate(`/projects/${id}/delivery?from=flurry`);
  };

  const chooseMode = (mode: FlurryMode) => {
    if (mode === 'hide') {
      clearFlurryCue();
      setRetreating(true);
      return;
    }
    if (mode === 'stay') {
      // Stay here: right where it is now.
      const p = roam.pos.current;
      if (p) setPrefs({ mode, spot: { fx: (p.x + size.width / 2) / window.innerWidth, fy: (p.y + size.height / 2) / window.innerHeight } });
      else setPrefs({ mode });
      return;
    }
    setPrefs({ mode });
  };

  if (hiddenNow) return null;

  // ------------------------------------------------------------------ dragging

  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    // The menu opens on click, not on press, so a press can become a drag.
    e.preventDefault();
    const at = roam.pos.current;
    if (compact || a.open || e.button !== 0 || !at) return;
    drag.current = { x: e.clientX, y: e.clientY, start: at, grab: { x: e.clientX - at.x, y: e.clientY - at.y }, moved: false, id: e.pointerId, target: at, raf: 0, last: performance.now() };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < DRAG_THRESHOLD) return;
    const clampTo = (p: Pt) => ({ x: Math.min(Math.max(8, p.x), window.innerWidth - size.width - 8), y: Math.min(Math.max(8, p.y), window.innerHeight - size.height - 8) });
    d.target = clampTo({ x: e.clientX - d.grab.x, y: e.clientY - d.grab.y });
    if (d.moved) return;
    d.moved = true;
    setDragging(true);
    setMenuOpen(false);
    clearFlurryCue();
    if (still) return;
    // Follow the pointer with a little lag, swaying with the speed.
    const tick = () => {
      const cur = drag.current;
      if (!cur) return;
      const t = performance.now();
      const pos = roam.pos.current ?? cur.target;
      const step = followStep(pos, cur.target, (t - cur.last) / 1000);
      cur.last = t;
      roam.place(step.p);
      root.current?.style.setProperty('--flurry-sway', `${step.sway.toFixed(1)}deg`);
      cur.raf = requestAnimationFrame(tick);
    };
    d.raf = requestAnimationFrame(tick);
  };
  const endDrag = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    cancelAnimationFrame(d.raf);
    if (!d.moved) return;
    suppressClick.current = true;
    setDragging(false);
    root.current?.style.setProperty('--flurry-sway', '0deg');
    // Settle exactly where it was let go.
    roam.place(d.target);
    if (!still) {
      setLanded(true);
      window.setTimeout(() => setLanded(false), 600);
    }
    // Staying: this is its place now. Roaming: it rests here until it next moves on.
    if (prefs.mode === 'stay' || still) setPrefs({ mode: prefs.mode, spot: { fx: (d.target.x + size.width / 2) / window.innerWidth, fy: (d.target.y + size.height / 2) / window.innerHeight } });
  };

  // ------------------------------------------------------------------ how it looks

  const wakeText = a.wakeActive ? ' Listening for “Hey Flurry”.' : a.wakeEnabled ? ' Wake phrase on, not listening right now.' : '';
  const needs = urgent.length ? ` ${urgent.length === 1 ? 'One thing needs you' : `${urgent.length} things need you`}.` : '';
  const label = `Flurry, your assistant.${needs} Open Flurry’s menu.${wakeText}`;

  // Its expression: being carried first, then what the assistant is doing, then its own moments.
  let mood: FlurryMood = 'idle';
  if (dragging) mood = 'dragged';
  else if (a.mood !== 'idle' && a.mood !== 'settled') mood = a.mood;
  else if (happy) mood = 'success';
  else if (cue && aim) mood = 'point';
  else if (menuOpen) mood = 'curious';
  else if (wave) mood = 'wave';
  else if (alert) mood = 'attention';
  else if (roam.phase === 'nap') mood = 'sleep';
  else if (roam.curious || hovered) mood = 'curious';
  else if (a.mood === 'settled') mood = 'settled';
  const flying = roam.phase === 'flying';
  const flip = mood === 'point' && aim?.flip;
  const pos = roam.pos.current ?? anchor ?? home();
  const note = cue ? noteSide(pos, size, { width: window.innerWidth, height: window.innerHeight }) : null;
  // Standing under a row of controls, the note opens downwards (when there's room), so it doesn't cover the row.
  if (note && cueAt && cueStand === 'below' && pos.y + 190 < window.innerHeight) note.above = false;
  const mini = px <= 48;

  return (
    <div
      ref={root}
      data-print="hide"
      data-flurry-companion={compact ? 'compact' : 'full'}
      data-flurry-mode={prefs.mode}
      data-flurry-phase={roam.phase}
      data-flurry-roaming={roaming ? '' : undefined}
      data-flurry-perched={a.open && perch ? '' : undefined}
      data-flurry-mood={mood}
      data-flurry-size={prefs.size}
      className={cn('invisible fixed top-0 left-0 z-30', dragging && 'select-none')}
      style={{ width: size.width, height: size.height, ['--flurry-aim' as string]: `${aim?.aim ?? 0}deg`, ['--flurry-look-y' as string]: `${aim?.lookY ?? 0}px` }}
      onPointerEnter={(e) => e.pointerType !== 'touch' && setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      // Keyboard focus holds it still (so it's where you left it); a click's focus doesn't.
      onFocus={(e) => setFocused((e.target as Element).matches(':focus-visible'))}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setFocused(false)}
    >
      <Menu open={menuOpen} onOpenChange={setMenuOpen} modal={false}>
        <MenuTrigger asChild>
          <button
            ref={button}
            type="button"
            data-assistant-button=""
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onClick={(e) => {
              if (suppressClick.current) {
                suppressClick.current = false;
                e.preventDefault();
                return;
              }
              setMenuOpen((o) => !o);
            }}
            aria-label={label}
            title={compact ? 'Flurry' : 'Flurry. Click for its menu, or drag to move it.'}
            className={cn(
              'relative flex size-full touch-none items-center justify-center rounded-full',
              compact ? 'border border-line bg-surface shadow-float' : 'ring-line-strong transition-[box-shadow,background-color] duration-300 hover:bg-surface/50 hover:ring-1 data-[state=open]:bg-surface/60 data-[state=open]:ring-1',
              dragging ? 'cursor-grabbing' : 'cursor-pointer',
            )}
          >
            <span className="block size-full" style={{ transform: `rotate(var(--tilt, 0deg))${flip ? ' scaleX(-1)' : ''}` }}>
              <FlurryFigure
                mood={mood}
                still={still}
                glow={!compact}
                mini={mini}
                landed={landed}
                className={cn('size-full', !compact && 'drop-shadow-[0_6px_10px_rgb(23_33_43/0.16)]', compact && 'p-1', flying && 'flurry-flying')}
              />
            </span>
            {urgent.length > 0 && (
              <span
                aria-hidden="true"
                data-flurry-indicator=""
                className={cn('absolute flex size-4 items-center justify-center rounded-full border-2 border-surface bg-warning text-[10px] leading-none font-bold text-white dark:text-canvas', compact ? '-top-0.5 -right-0.5' : 'top-0 right-0')}
              >
                !
              </span>
            )}
            {a.wakeEnabled && <WakeDot active={a.wakeActive} />}
          </button>
        </MenuTrigger>
        <MenuContent side={compact || pos.y > window.innerHeight / 2 ? 'top' : 'bottom'} align={pos.x + size.width / 2 > window.innerWidth / 2 ? 'end' : 'start'} className="w-[min(19rem,calc(100vw-24px))]">
          {attention.length > 0 && (
            <>
              <MenuLabel>Needs you</MenuLabel>
              {attention.slice(0, 2).map((x) => (
                <MenuItem key={x.id} onSelect={() => navigate(x.link)}>
                  <span className={cn('mt-1 size-2 shrink-0 self-start rounded-full', x.severity === 'HIGH' ? 'bg-warning' : 'bg-line-strong')} aria-hidden="true" />
                  <span className="min-w-0" data-flurry-attention={x.kind}>
                    <span className="block truncate font-medium">{x.title}</span>
                    <span className="line-clamp-2 block text-[12px] leading-snug text-muted">{x.reason}</span>
                  </span>
                </MenuItem>
              ))}
              <MenuSeparator />
            </>
          )}
          <MenuItem icon={<MessageCircle />} onSelect={() => a.setOpen(true)}>
            <span className="flex-1">Ask Flurry</span>
            <kbd className="font-sans text-[11.5px] text-subtle">Alt A</kbd>
          </MenuItem>
          <MenuItem icon={<ArrowRightCircle />} onSelect={() => void showNextTask()}>
            My next task
          </MenuItem>
          <MenuItem icon={<Route />} onSelect={openDelivery}>
            Delivery outlook
          </MenuItem>
          <MenuSeparator />
          <MenuLabel>Flurry should</MenuLabel>
          <MenuRadioGroup value={prefs.mode} onValueChange={(v) => chooseMode(v as FlurryMode)} label="Where Flurry stays">
            {FLURRY_MODES.map((m) => (
              <MenuRadioItem key={m.value} value={m.value} hint={m.hint}>
                {m.label}
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
          <MenuSeparator />
          <MenuItem icon={<SlidersHorizontal />} onSelect={() => navigate('/settings?tab=flurry')}>
            Size, motion and more
          </MenuItem>
        </MenuContent>
      </Menu>
      {cue && note && <FlurryNote cue={cue} side={note.side} above={note.above} compact={compact} />}
    </div>
  );
}

/** Shows that the "Hey Flurry" listener is on, so listening is never hidden. */
function WakeDot({ active }: { active: boolean }) {
  return (
    <span className="absolute -bottom-0.5 -left-0.5 flex items-center gap-0.5 rounded-full border border-line bg-surface px-1 py-0.5 shadow-card" aria-hidden="true">
      <Mic className={cn('size-3 text-accent', !active && 'opacity-50')} />
      {active ? <span className="size-1.5 animate-pulse rounded-full bg-[var(--model-review)]" /> : <Check className="size-2.5 text-muted" />}
    </span>
  );
}
