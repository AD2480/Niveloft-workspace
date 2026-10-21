import { describe, expect, it } from 'vitest';
import {
  announceSignOut,
  isKept,
  KEPT_KEY,
  markKept,
  moveLegacySignIn,
  renewOnce,
  SIGNED_OUT_KEY,
  signedOutAccount,
  singleFlight,
  type RefreshCall,
} from './keptSignIn';

/**
 * Runs a test with its own in-memory localStorage and sessionStorage, then puts back whatever was
 * there (other test files install their own).
 */
async function withStorage(test: (s: { local: Map<string, string>; session: Map<string, string> }) => Promise<void> | void) {
  const g = globalThis as { localStorage?: unknown; sessionStorage?: unknown };
  const before = { local: g.localStorage, session: g.sessionStorage };
  const make = () => {
    const m = new Map<string, string>();
    return {
      m,
      api: {
        getItem: (k: string) => m.get(k) ?? null,
        setItem: (k: string, v: string) => void m.set(k, String(v)),
        removeItem: (k: string) => void m.delete(k),
        key: (i: number) => [...m.keys()][i] ?? null,
        get length() {
          return m.size;
        },
      },
    };
  };
  const local = make();
  const session = make();
  g.localStorage = local.api;
  g.sessionStorage = session.api;
  try {
    await test({ local: local.m, session: session.m });
  } finally {
    g.localStorage = before.local;
    g.sessionStorage = before.session;
  }
}

const KEYS = { token: 'projectflow.token', user: 'projectflow.user' };
const USER = { id: 7, name: 'Kim', email: 'kim@example.org' };
const answer = (status: number, body: unknown): RefreshCall => async () => ({ status, body });

describe('keep me signed in: what the browser keeps', () => {
  it('keeps only a note that there is a kept sign-in, never a token', () =>
    withStorage(({ local }) => {
      expect(isKept()).toBe(false);
      markKept(true);
      expect(isKept()).toBe(true);
      expect(local.get(KEPT_KEY)).toMatch(/^\d+$/);
      markKept(false);
      expect(isKept()).toBe(false);
      expect(local.size).toBe(0);
    }));

  it('moves a token an earlier release left in localStorage into this tab, and removes it there', () =>
    withStorage(({ local, session }) => {
      local.set(KEYS.token, 'eyJhbGciOiJIUzM4NCJ9.old.sig');
      local.set(KEYS.user, JSON.stringify(USER));
      expect(moveLegacySignIn(KEYS)).toBe(true);
      expect(local.has(KEYS.token)).toBe(false);
      expect(local.has(KEYS.user)).toBe(false);
      expect(session.get(KEYS.token)).toBe('eyJhbGciOiJIUzM4NCJ9.old.sig');
      expect(JSON.parse(session.get(KEYS.user)!)).toEqual(USER);
      expect(isKept()).toBe(false); // it has no cookie: the next visit asks for the password
    }));

  it('keeps the tab’s own newer sign-in over an old stored one', () =>
    withStorage(({ local, session }) => {
      session.set(KEYS.token, 'tab-token');
      local.set(KEYS.token, 'old-token');
      local.set(KEYS.user, '{"id":1}');
      moveLegacySignIn(KEYS);
      expect(session.get(KEYS.token)).toBe('tab-token');
      expect(local.size).toBe(0);
    }));

  it('has nothing to move when there’s nothing stored', () =>
    withStorage(({ session }) => {
      expect(moveLegacySignIn(KEYS)).toBe(false);
      expect(session.size).toBe(0);
    }));

  it('tells other tabs which account signed out', () =>
    withStorage(({ local }) => {
      announceSignOut(7);
      expect(signedOutAccount(local.get(SIGNED_OUT_KEY) ?? null)).toBe(7);
      announceSignOut(null);
      expect(signedOutAccount(local.get(SIGNED_OUT_KEY) ?? null)).toBe(7);
      expect(signedOutAccount(null)).toBeNull();
      expect(signedOutAccount('nonsense')).toBeNull();
      expect(signedOutAccount('-3:1')).toBeNull();
    }));
});

describe('keep me signed in: renewing from the cookie', () => {
  it('a usable cookie: the new token and the account', () =>
    withStorage(async () => {
      markKept(true);
      const renewed = await renewOnce(answer(200, { success: true, data: { token: 't-2', user: USER } }));
      expect(renewed).toEqual({ token: 't-2', user: USER });
      expect(isKept()).toBe(true);
    }));

  it('no usable cookie (401), or not from the app (403): nothing, and the note goes', () =>
    withStorage(async () => {
      markKept(true);
      expect(await renewOnce(answer(401, { message: 'This browser isn’t kept signed in any more.' }))).toBeNull();
      expect(isKept()).toBe(false);
      markKept(true);
      expect(await renewOnce(answer(403, null))).toBeNull();
      expect(isKept()).toBe(false);
    }));

  it('the API busy or unreachable: an error, and the kept sign-in stays (it may be fine)', () =>
    withStorage(async () => {
      markKept(true);
      await expect(renewOnce(answer(503, null))).rejects.toThrow();
      await expect(renewOnce(answer(200, { data: { token: '' } }))).rejects.toThrow();
      await expect(
        renewOnce(async () => {
          throw new TypeError('Failed to fetch');
        }),
      ).rejects.toThrow();
      expect(isKept()).toBe(true);
    }));

  it('one request at a time, shared by everyone who asks meanwhile', () =>
    withStorage(async () => {
      let calls = 0;
      let release: () => void = () => undefined;
      const renew = singleFlight(async () => {
        calls++;
        await new Promise<void>((r) => (release = r));
        return { status: 200, body: { data: { token: `t-${calls}`, user: USER } } };
      });
      const all = [renew(), renew(), renew()];
      await Promise.resolve();
      release();
      const results = await Promise.all(all);
      expect(calls).toBe(1);
      expect(results.map((r) => r?.token)).toEqual(['t-1', 't-1', 't-1']);
      const later = renew();
      await Promise.resolve();
      release();
      expect((await later)?.token).toBe('t-2'); // a later need asks again
    }));
});
