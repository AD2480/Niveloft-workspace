import { readSession, readStorage, writeSession, writeStorage } from '@/lib/storage';

/** Where the retired in-browser demo kept its copy of everything (the test API still uses it in tests). */
export const RETIRED_DEMO_DB_KEY = 'projectflow.mockdb.v1';

/**
 * Preferences kept per account or per project id. The demo's accounts and projects had ids of their
 * own, which real accounts and projects reuse (1, 2, 3 …), so the demo's would land on them.
 */
const ID_KEYED = /^projectflow\.(persona|flurry|flurry\.spoke|assistant\.wake|assistant\.speak|firststeps\.hidden|firststeps\.ticked|plan)\.\d+$/;

function storedKeys(): string[] {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k) keys.push(k);
    }
    return keys;
  } catch {
    return [];
  }
}

/**
 * Removes what the retired in-browser demo left in this browser: its sign-in (demo tokens start
 * with "mock."), its copy of the sample data, and, where it ran, the preferences kept under ids
 * (start page, Flurry's place, first steps, what-if plans), which would otherwise attach to real
 * accounts and projects with the same ids. Runs before the stored sign-in is read, so a demo token
 * is never sent to the real API, where it could only fail and look like an expired session. A real
 * sign-in is left alone. Returns whether a demo sign-in was removed.
 */
export function forgetRetiredDemo(keys: { token: string; user: string }): boolean {
  const token = readStorage(keys.token) ?? readSession(keys.token);
  const demo = token !== null && token.startsWith('mock.');
  if (demo) {
    for (const write of [writeStorage, writeSession]) {
      write(keys.token, null);
      write(keys.user, null);
    }
  }
  if (readStorage(RETIRED_DEMO_DB_KEY) !== null) {
    for (const k of storedKeys()) if (ID_KEYED.test(k)) writeStorage(k, null);
    writeStorage(RETIRED_DEMO_DB_KEY, null);
  }
  return demo;
}
