/**
 * Asking Flurry to show something: a page (the delivery outlook, when you select a milestone) or
 * Flurry's own menu ("My next task") sets a cue, and Flurry goes to stand beside what it's about
 * (when it's allowed to move), points at what matters, and shows a short note with at most two
 * actions. One cue at a time; a new one replaces the last. Clearing it (Not now, Escape, the page
 * going away) lets Flurry carry on as before.
 *
 * Also a tiny event channel for moments Flurry reacts to: something you did worked (a task approved,
 * a change saved through Flurry), or you selected a task (Flurry glances at it).
 *
 * A cue never changes data; its actions only navigate or call what the page passes in.
 */
import { useSyncExternalStore } from 'react';

export interface FlurryNoteAction {
  label: string;
  /** Go somewhere in the app. */
  to?: string;
  onSelect?: () => void;
  primary?: boolean;
}

export interface FlurryCue {
  /** Identifies what it's about (a new cue with the same id just updates it). */
  id: string;
  /** A short heading: the task's key and state, say. */
  title?: string;
  /** One or two short sentences. */
  text: string;
  actions?: FlurryNoteAction[];
  /** Go and stand beside this element, when Flurry may move (Roam). */
  anchor?: () => Element | null;
  /** Where to stand: beside the anchor (the default), or just under it, so the note opens below a row of controls instead of over it. */
  stand?: 'beside' | 'below';
  /** Point at this element. */
  target?: () => Element | null;
  /** Who started it: the person (by selecting or asking) or Flurry (speaking up on its own). */
  by: 'person' | 'flurry';
  tone?: 'neutral' | 'attention';
  /** Called when it's dismissed (Not now, Escape) rather than replaced. */
  onDismiss?: () => void;
}

let current: FlurryCue | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export function showFlurryCue(cue: FlurryCue): void {
  current = cue;
  notify();
}

/** Clears the cue (only if it's still the one with this id, when one is given). */
export function clearFlurryCue(id?: string, dismissed = false): void {
  if (!current || (id && current.id !== id)) return;
  const was = current;
  current = null;
  notify();
  if (dismissed) was.onDismiss?.();
}

export function currentFlurryCue(): FlurryCue | null {
  return current;
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useFlurryCue(): FlurryCue | null {
  return useSyncExternalStore(subscribe, () => current, () => null);
}

// ------------------------------------------------------------------------------------------ moments

export type FlurryMoment = { kind: 'happy' } | { kind: 'glance'; at: { x: number; y: number } };

const momentListeners = new Set<(m: FlurryMoment) => void>();

export function flurryMoment(m: FlurryMoment): void {
  momentListeners.forEach((l) => l(m));
}

export function onFlurryMoment(l: (m: FlurryMoment) => void): () => void {
  momentListeners.add(l);
  return () => momentListeners.delete(l);
}

// ------------------------------------------------------------------------------------------ coming back

let entrance: { x: number; y: number } | null = null;

/** Called back from the sidebar: Flurry should come out from there (its top-left point). */
export function setFlurryEntrance(p: { x: number; y: number } | null): void {
  entrance = p;
}

/** Where Flurry should appear from, once (then it's forgotten). */
export function takeFlurryEntrance(): { x: number; y: number } | null {
  const p = entrance;
  entrance = null;
  return p;
}

/** Things that need the person, worth Flurry's indicator: reviews to make, changes requested, their blocked or late work, and late work holding others up. */
export const FLURRY_ATTENTION_KINDS = ['REVIEW_WAITING', 'CHANGES_REQUESTED', 'BLOCKED', 'BLOCKING', 'OVERDUE'] as const;

export function flurryAttention<T extends { kind: string; severity: 'HIGH' | 'MEDIUM' | 'LOW' }>(items: readonly T[]): T[] {
  const rank = { HIGH: 0, MEDIUM: 1, LOW: 2 } as const;
  return items.filter((x) => (FLURRY_ATTENTION_KINDS as readonly string[]).includes(x.kind)).sort((a, b) => rank[a.severity] - rank[b.severity]);
}
