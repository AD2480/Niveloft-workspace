import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { User } from '@/api/types';
import { STORAGE_KEYS, USE_TEST_API } from '@/config';
import { readSession, writeSession } from '@/lib/storage';
import { isKept, markKept, moveLegacySignIn } from './keptSignIn';
import { forgetRetiredDemo } from './retiredDemo';

export interface AuthState {
  token: string | null;
  user: User | null;
  /**
   * True once the tab's token has been validated against /auth/me, or the kept sign-in renewed, or
   * there was nothing to restore. False with no token: the kept sign-in is being renewed.
   */
  initialized: boolean;
  /** Set when the API rejected the token so the login page can explain why. */
  sessionExpired: boolean;
  /** This tab's sign-in is the browser's kept one ("keep me signed in"), renewed from its cookie when its token expires. */
  kept: boolean;
}

// A sign-in left by the retired in-browser demo would only fail against the real API.
if (!USE_TEST_API) forgetRetiredDemo(STORAGE_KEYS);
// Earlier releases kept "keep me signed in" tokens in localStorage, readable by any script on the page.
moveLegacySignIn(STORAGE_KEYS);

/** Whether this tab's token is the kept sign-in's (so a reload still knows). */
const TAB_KEPT = 'projectflow.token.kept';

/**
 * Sign-in tokens live only in this tab (sessionStorage) and end with it. "Keep me signed in" is an
 * HttpOnly cookie the API sets, which page scripts can't read (see keptSignIn.ts); a tab without a
 * token renews it at start-up (main.tsx).
 */
const storedToken = readSession(STORAGE_KEYS.token);

function parseUser(raw: string | null): User | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as User;
  } catch {
    return null;
  }
}

function persist(token: string | null, user: User | null, kept: boolean) {
  writeSession(STORAGE_KEYS.token, token);
  writeSession(STORAGE_KEYS.user, user ? JSON.stringify(user) : null);
  writeSession(TAB_KEPT, token && kept ? '1' : null);
}

const initialState: AuthState = {
  token: storedToken,
  user: storedToken ? parseUser(readSession(STORAGE_KEYS.user)) : null,
  initialized: !storedToken && !isKept(),
  sessionExpired: false,
  kept: storedToken !== null && readSession(TAB_KEPT) !== null,
};

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    /** Signed in here (or signed up). "Keep me signed in" is remembered by the API's cookie; this browser just notes it. */
    credentialsReceived(state, action: PayloadAction<{ token: string; user: User; remember?: boolean }>) {
      const kept = action.payload.remember ?? false;
      state.token = action.payload.token;
      state.user = action.payload.user;
      state.initialized = true;
      state.sessionExpired = false;
      state.kept = kept;
      persist(action.payload.token, action.payload.user, kept);
      markKept(kept);
    },
    /**
     * A new token for this tab: renewed from the kept sign-in's cookie ({@code kept: true}), or after
     * a password change (a new session, kept or not as before).
     */
    tokenRefreshed(state, action: PayloadAction<{ token: string; user: User; kept?: boolean }>) {
      state.token = action.payload.token;
      state.user = action.payload.user;
      state.initialized = true;
      state.sessionExpired = false;
      if (action.payload.kept !== undefined) state.kept = action.payload.kept;
      persist(action.payload.token, action.payload.user, state.kept);
    },
    /** There was no kept sign-in to renew after all (or the API couldn't be reached): show the sign-in page. */
    restoreFinished(state) {
      if (!state.token) state.initialized = true;
    },
    userUpdated(state, action: PayloadAction<User>) {
      state.user = action.payload;
      state.initialized = true;
      if (readSession(STORAGE_KEYS.token) !== null) writeSession(STORAGE_KEYS.user, JSON.stringify(action.payload));
    },
    loggedOut(state) {
      state.token = null;
      state.user = null;
      state.initialized = true;
      state.sessionExpired = false;
      state.kept = false;
      persist(null, null, false);
      markKept(false);
    },
    sessionExpired(state) {
      const hadSession = state.token !== null;
      state.token = null;
      state.user = null;
      state.initialized = true;
      state.sessionExpired = hadSession;
      state.kept = false;
      persist(null, null, false);
    },
  },
});

export const { credentialsReceived, tokenRefreshed, restoreFinished, userUpdated, loggedOut, sessionExpired } = authSlice.actions;
export default authSlice.reducer;
