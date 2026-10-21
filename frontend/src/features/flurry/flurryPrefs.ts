/**
 * Flurry's settings, per person on this browser:
 *
 * - **mode**: *Roam* (it moves between a few safe resting spots while you're away from the keyboard),
 *   *Stay here* (it stays where you put it) or *Hide* (it retreats into a small icon in the sidebar
 *   until you call it back). `lastMode` is where it goes back to when it's called.
 * - **size** and **motion**: how big it is, and how much it moves (Full: floats, looks around,
 *   roams and reacts; Calm: reacts, but no idle floating and no flying, moves are short fades;
 *   Off: completely still). The system's reduced-motion setting always means Off.
 * - **spot**: where it was put (Stay here), as fractions of the window, so it survives resizing.
 * - **speakUp**: whether it may show a short note on its own when something needs you. Off by
 *   default: notes appear only when you ask (click it, or choose something from its menu).
 * - **corner**: home, where it rests and naps, and where the conversation opens as a card.
 * - **pinned**: the conversation is docked beside the page. **sounds**: small chimes.
 *
 * A tiny external store (useSyncExternalStore), so the companion, the sidebar, the assistant
 * panel and the settings page all see the same values at once.
 */
import { useSyncExternalStore } from 'react';
import { readJson, writeStorage } from '@/lib/storage';
import { FLURRY_CORNERS, type FlurryCorner } from './flurryPlacement';

export { FLURRY_CORNERS, nearestCorner, oppositeCorner, overlaps, type FlurryCorner } from './flurryPlacement';

export type FlurryMode = 'roam' | 'stay' | 'hide';
export type FlurrySize = 'small' | 'medium' | 'large';
export type FlurryMotion = 'full' | 'calm' | 'off';

export const FLURRY_MODES: { value: FlurryMode; label: string; hint: string }[] = [
  { value: 'roam', label: 'Roam', hint: 'Moves between a few quiet spots while you’re away; still while you work.' },
  { value: 'stay', label: 'Stay here', hint: 'Stays where you put it.' },
  { value: 'hide', label: 'Hide', hint: 'Waits in the sidebar until you call it back.' },
];
export const FLURRY_SIZES: { value: FlurrySize; label: string; px: number }[] = [
  { value: 'small', label: 'Small', px: 44 },
  { value: 'medium', label: 'Medium', px: 56 },
  { value: 'large', label: 'Large', px: 72 },
];
export const FLURRY_MOTIONS: { value: FlurryMotion; label: string; hint: string }[] = [
  { value: 'full', label: 'Full', hint: 'Floats, looks around, flies between spots and reacts.' },
  { value: 'calm', label: 'Calm', hint: 'Reacts, but doesn’t float or fly; it fades from spot to spot.' },
  { value: 'off', label: 'Off', hint: 'Completely still.' },
];

/** The figure's size in pixels. */
export const flurryPx = (size: FlurrySize) => FLURRY_SIZES.find((s) => s.value === size)?.px ?? 56;

export interface FlurrySpot {
  /** Centre of Flurry, as a fraction of the window's width and height. */
  fx: number;
  fy: number;
}

export interface FlurryPrefs {
  mode: FlurryMode;
  /** Where Flurry goes back to when it's called back from the sidebar. */
  lastMode: Exclude<FlurryMode, 'hide'>;
  size: FlurrySize;
  motion: FlurryMotion;
  /** Where you put it (Stay here); null: its home corner. */
  spot: FlurrySpot | null;
  /** May show a short note on its own when something needs you (otherwise only when asked). */
  speakUp: boolean;
  /** Small sounds when Flurry opens, finishes or hits a problem. Off unless turned on. */
  sounds: boolean;
  /** Home: where it rests at first, naps, and where the conversation opens as a card. */
  corner: FlurryCorner;
  /** The conversation is docked beside the page (which makes room for it) instead of floating. */
  pinned: boolean;
}

export const DEFAULT_FLURRY_PREFS: FlurryPrefs = {
  mode: 'roam',
  lastMode: 'roam',
  size: 'medium',
  motion: 'full',
  spot: null,
  speakUp: false,
  sounds: false,
  corner: 'bottom-right',
  pinned: false,
};

const listeners = new Set<() => void>();
const cache = new Map<string, FlurryPrefs>();

const key = (userId: number) => `projectflow.flurry.${userId}`;

/** Settings as stored by earlier versions (hidden/minimised/still/roam flags, a free position). */
type Stored = Partial<FlurryPrefs> & { hidden?: boolean; minimised?: boolean; still?: boolean; roam?: boolean; position?: { right: number; bottom: number } | null };

const oneOf = <T extends string>(v: unknown, values: readonly T[], fallback: T): T => (values.includes(v as T) ? (v as T) : fallback);
const fraction = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : null);

export function sanitiseFlurryPrefs(raw: Stored | null): FlurryPrefs {
  const r = raw ?? {};
  // Earlier versions: hidden → Hide; roaming off or minimised → Stay here; still → motion off.
  const legacyMode: FlurryMode | undefined = r.hidden ? 'hide' : r.roam === false || r.minimised ? 'stay' : undefined;
  const mode = oneOf(r.mode ?? legacyMode, ['roam', 'stay', 'hide'] as const, 'roam');
  const lastMode = oneOf(r.lastMode ?? (mode === 'hide' ? (r.roam === false ? 'stay' : 'roam') : mode), ['roam', 'stay'] as const, 'roam');
  let corner: FlurryCorner = FLURRY_CORNERS.includes(r.corner as FlurryCorner) ? (r.corner as FlurryCorner) : 'bottom-right';
  // Settings saved before corners: a free position becomes the nearest bottom corner.
  if (!r.corner && r.position && Number.isFinite(r.position.right) && typeof window !== 'undefined') {
    corner = r.position.right > window.innerWidth / 2 ? 'bottom-left' : 'bottom-right';
  }
  const fx = fraction(r.spot?.fx);
  const fy = fraction(r.spot?.fy);
  return {
    mode,
    lastMode,
    size: oneOf(r.size, ['small', 'medium', 'large'] as const, 'medium'),
    motion: oneOf(r.motion ?? (r.still ? 'off' : undefined), ['full', 'calm', 'off'] as const, 'full'),
    spot: fx !== null && fy !== null ? { fx, fy } : null,
    speakUp: !!r.speakUp,
    sounds: !!r.sounds,
    corner,
    pinned: !!r.pinned,
  };
}

export function readFlurryPrefs(userId: number): FlurryPrefs {
  const k = key(userId);
  let v = cache.get(k);
  if (!v) {
    v = sanitiseFlurryPrefs(readJson<Stored>(k));
    cache.set(k, v);
  }
  return v;
}

export function updateFlurryPrefs(userId: number, change: Partial<FlurryPrefs>): FlurryPrefs {
  const current = readFlurryPrefs(userId);
  const merged: FlurryPrefs = { ...current, ...change };
  // Leaving Roam or Stay here for Hide remembers where to come back to.
  if (change.mode && change.mode !== 'hide') merged.lastMode = change.mode;
  const next = sanitiseFlurryPrefs(merged);
  const k = key(userId);
  cache.set(k, next);
  writeStorage(k, JSON.stringify(next));
  for (const l of listeners) l();
  return next;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // Another tab changed the settings.
  const onStorage = (e: StorageEvent) => {
    if (e.key && e.key.startsWith('projectflow.flurry.')) {
      cache.delete(e.key);
      listener();
    }
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

export function useFlurryPrefs(userId: number): [FlurryPrefs, (change: Partial<FlurryPrefs>) => void] {
  const prefs = useSyncExternalStore(subscribe, () => readFlurryPrefs(userId), () => DEFAULT_FLURRY_PREFS);
  return [prefs, (change) => updateFlurryPrefs(userId, change)];
}

/** Whether Flurry is still: its own motion setting, or the system's reduced-motion setting. */
export const isStill = (prefs: Pick<FlurryPrefs, 'motion'>, reduceMotion: boolean) => reduceMotion || prefs.motion === 'off';
