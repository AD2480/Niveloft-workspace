import { useSyncExternalStore } from 'react';
import { ANALYTICS_CONFIGURED, STORAGE_KEYS } from '@/config';
import { startAnalytics, stopAnalytics, trackPage } from '@/features/analytics/analytics';
import { rememberAttribution } from '@/lib/attribution';
import { readStorage, writeStorage } from '@/lib/storage';

/**
 * The visitor's cookie choice. Essential storage (staying signed in, theme, view settings) needs
 * no consent and isn't a choice. Analytics are off until the visitor says yes, and the choice can
 * be changed at any time from "Cookie settings" in the footer.
 */
export interface ConsentChoice {
  analytics: boolean;
  /** ISO time of the choice. */
  at: string;
  /** Bumped if the choices on offer change, so people are asked again. */
  version: 1;
}

function read(): ConsentChoice | null {
  try {
    const raw = readStorage(STORAGE_KEYS.consent);
    const parsed = raw ? (JSON.parse(raw) as ConsentChoice) : null;
    return parsed && parsed.version === 1 && typeof parsed.analytics === 'boolean' ? parsed : null;
  } catch {
    return null;
  }
}

let state = { choice: read(), settingsOpen: false };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function decideConsent(analytics: boolean): void {
  const choice: ConsentChoice = { analytics, at: new Date().toISOString(), version: 1 };
  writeStorage(STORAGE_KEYS.consent, JSON.stringify(choice));
  state = { choice, settingsOpen: false };
  rememberAttribution(analytics);
  if (analytics && ANALYTICS_CONFIGURED) {
    startAnalytics();
    trackPage(window.location.pathname); // this page, now that it may be counted
  } else stopAnalytics();
  emit();
}

export function openCookieSettings(): void {
  state = { ...state, settingsOpen: true };
  emit();
}

export function closeCookieSettings(): void {
  state = { ...state, settingsOpen: false };
  emit();
}

/** Starts analytics on page load if the visitor already agreed. */
export function applyStoredConsent(): void {
  rememberAttribution(!!state.choice?.analytics);
  if (state.choice?.analytics && ANALYTICS_CONFIGURED) startAnalytics();
}

export function useConsent() {
  return useSyncExternalStore(subscribe, () => state, () => state);
}
