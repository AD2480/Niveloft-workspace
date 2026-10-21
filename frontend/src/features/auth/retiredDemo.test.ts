import { describe, expect, it } from 'vitest';
import { forgetRetiredDemo, RETIRED_DEMO_DB_KEY } from './retiredDemo';
import { MOCK_DB_STORAGE_KEY } from '@/mock/store';

/**
 * Runs a test with its own in-memory localStorage and sessionStorage, then puts back whatever was
 * there (other test files install their own).
 */
function withStorage(test: (s: { local: Map<string, string>; session: Map<string, string> }) => void) {
  const g = globalThis as { localStorage?: unknown; sessionStorage?: unknown };
  const before = { local: g.localStorage, session: g.sessionStorage };
  const make = () => {
    const m = new Map<string, string>();
    return {
      m,
      api: {
        getItem: (k: string) => m.get(k) ?? null,
        setItem: (k: string, v: string) => void m.set(k, v),
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
    test({ local: local.m, session: session.m });
  } finally {
    g.localStorage = before.local;
    g.sessionStorage = before.session;
  }
}
const KEYS = { token: 'projectflow.token', user: 'projectflow.user' };

describe('what the retired demo left in this browser', () => {
  it('removes a demo sign-in and the demo’s data, so they never reach the real API', () =>
    withStorage(({ local }) => {
      local.set(KEYS.token, 'mock.eyJzdWIiOjF9.signature');
      local.set(KEYS.user, '{"id":1}');
      local.set(RETIRED_DEMO_DB_KEY, '{"users":[]}');
      local.set('projectflow.theme', 'dark');
      expect(forgetRetiredDemo(KEYS)).toBe(true);
      expect([...local.keys()]).toEqual(['projectflow.theme']);
    }));

  it('also finds a demo sign-in kept only for this tab', () =>
    withStorage(({ session }) => {
      session.set(KEYS.token, 'mock.eyJzdWIiOjJ9.signature');
      session.set(KEYS.user, '{"id":2}');
      expect(forgetRetiredDemo(KEYS)).toBe(true);
      expect(session.size).toBe(0);
    }));

  it('leaves a real sign-in alone', () =>
    withStorage(({ session }) => {
      session.set(KEYS.token, 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIzIn0.c2lnbmF0dXJl');
      session.set(KEYS.user, '{"id":3}');
      expect(forgetRetiredDemo(KEYS)).toBe(false);
      expect(session.get(KEYS.token)).toMatch(/^eyJ/);
      expect(session.get(KEYS.user)).toBe('{"id":3}');
    }));

  it('drops preferences kept under the demo’s ids where the demo ran, and keeps the rest', () =>
    withStorage(({ local }) => {
      local.set(RETIRED_DEMO_DB_KEY, '{}');
      for (const k of ['projectflow.persona.1', 'projectflow.flurry.1', 'projectflow.flurry.spoke.2', 'projectflow.assistant.wake.1', 'projectflow.firststeps.ticked.3', 'projectflow.plan.4'])
        local.set(k, 'x');
      for (const k of ['projectflow.theme', 'projectflow.consent', 'projectflow.persona.pending', 'projectflow.taskView']) local.set(k, 'kept');
      expect(forgetRetiredDemo(KEYS)).toBe(false);
      expect([...local.keys()].sort()).toEqual(['projectflow.consent', 'projectflow.persona.pending', 'projectflow.taskView', 'projectflow.theme']);
    }));

  it('leaves preferences alone in a browser that never ran the demo', () =>
    withStorage(({ local }) => {
      local.set('projectflow.persona.1', 'OWNER');
      local.set('projectflow.plan.4', '[]');
      forgetRetiredDemo(KEYS);
      expect([...local.keys()].sort()).toEqual(['projectflow.persona.1', 'projectflow.plan.4']);
    }));

  it('names the same storage the test API uses', () => {
    expect(RETIRED_DEMO_DB_KEY).toBe(MOCK_DB_STORAGE_KEY);
  });
});
