import { API_BASE_URL, USE_TEST_API } from '@/config';
import { singleFlight } from './keptSignIn';

/**
 * Renews the browser's kept sign-in ("keep me signed in") from its HttpOnly cookie: one request at
 * a time, shared. The cookie goes with the request (credentials: include), even when the API is on
 * another site than the app; the app never sees its value.
 */
export const renewKeptSignIn = singleFlight(async () => {
  if (USE_TEST_API) {
    const { handleMockRequest } = await import('@/mock/server');
    const res = await handleMockRequest({ method: 'POST', url: '/auth/refresh', token: null });
    return { status: res.status, body: res.body };
  }
  const res = await fetch(`${API_BASE_URL}/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
});
