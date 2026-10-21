import type { User } from '@/api/types';
import { readSession, readStorage, writeSession, writeStorage } from '@/lib/storage';

/**
 * "Keep me signed in".
 *
 * Sign-in tokens live only in the tab (sessionStorage) and end with it. A kept sign-in is remembered
 * by an HttpOnly cookie that the API sets and page scripts can't read. This browser only notes that
 * there is one ({@link KEPT_KEY}, which isn't a secret), so a tab opened later, or one whose token
 * has expired, asks the API for a new token (POST /auth/refresh, with the cookie) instead of
 * showing the sign-in page.
 */
export const KEPT_KEY = 'projectflow.kept';
/** Written when someone signs out in a tab, so the browser's other tabs of that account sign out too. */
export const SIGNED_OUT_KEY = 'projectflow.signedOut';

export function isKept(): boolean {
  return readStorage(KEPT_KEY) !== null;
}

/** Notes (or forgets) that this browser has a kept sign-in. A new value tells the other tabs. */
export function markKept(kept: boolean): void {
  writeStorage(KEPT_KEY, kept ? String(Date.now()) : null);
}

/** Tells the browser's other tabs that this account signed out here. */
export function announceSignOut(userId: number | null | undefined): void {
  if (userId != null) writeStorage(SIGNED_OUT_KEY, `${userId}:${Date.now()}`);
}

/** The account a sign-out announcement is about, or null. */
export function signedOutAccount(value: string | null): number | null {
  const id = Number((value ?? '').split(':')[0]);
  return value && Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * Earlier releases kept "keep me signed in" tokens in localStorage, where any script on the page
 * could read them for 14 days. This moves such a token into this tab (where it lasts at most a
 * day, like any token) and removes it from localStorage. Its sign-in has no cookie, so once the tab
 * closes, the next visit asks for the password again. Returns whether one was moved.
 */
export function moveLegacySignIn(keys: { token: string; user: string }): boolean {
  const token = readStorage(keys.token);
  const user = readStorage(keys.user);
  if (token === null && user === null) return false;
  if (token !== null && readSession(keys.token) === null) {
    writeSession(keys.token, token);
    writeSession(keys.user, user);
  }
  writeStorage(keys.token, null);
  writeStorage(keys.user, null);
  return token !== null;
}

/** A renewed sign-in, or null when this browser has no kept sign-in any more. */
export type Renewed = { token: string; user: User } | null;

/** POST /auth/refresh: its status and JSON body. Throws when the API can't be reached. */
export type RefreshCall = () => Promise<{ status: number; body: unknown }>;

/**
 * Asks once for a new token for the kept sign-in. 2xx: the token and account. 401 or 403: there's
 * no usable kept sign-in (signed out, expired, ended elsewhere, or the browser dropped the cookie),
 * so the note is removed. Anything else, or no answer, throws: the kept sign-in may still be fine.
 */
export async function renewOnce(call: RefreshCall): Promise<Renewed> {
  const { status, body } = await call();
  if (status >= 200 && status < 300) {
    const data = (body as { data?: { token?: unknown; user?: unknown } } | null)?.data;
    if (data && typeof data.token === 'string' && data.token && data.user && typeof data.user === 'object') {
      return { token: data.token, user: data.user as User };
    }
    throw new Error('The sign-in renewal answered without a token.');
  }
  if (status === 401 || status === 403) {
    markKept(false);
    return null;
  }
  throw new Error(`The sign-in couldn’t be renewed right now (HTTP ${status}).`);
}

/**
 * One renewal at a time: everything that needs one while it's under way (the start-up, requests
 * that got 401 together, another tab's sign-in) shares it.
 */
export function singleFlight(call: RefreshCall): () => Promise<Renewed> {
  let running: Promise<Renewed> | null = null;
  return () => {
    if (!running) {
      running = renewOnce(call).finally(() => {
        running = null;
      });
    }
    return running;
  };
}
