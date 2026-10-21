import { API_BASE_URL, USE_TEST_API } from '@/config';

/*
 * Sends crashes that happen in the browser to the server's log (POST /api/client-errors), so
 * they're visible next to server errors. Only the message, where it happened (the page address,
 * without its query string) and the stack are sent; never form contents or tokens. At most 10 a
 * page load, and the same message once a minute.
 */

const recent = new Map<string, number>();
let sent = 0;
const MAX_PER_PAGE = 10;

export function reportClientError(kind: string, message: string, stack?: string, requestId?: string): void {
  if (USE_TEST_API || typeof window === 'undefined' || sent >= MAX_PER_PAGE) return;
  const key = `${kind}:${message}`;
  const now = Date.now();
  if ((recent.get(key) ?? 0) > now - 60_000) return;
  recent.set(key, now);
  sent++;
  try {
    void fetch(`${API_BASE_URL}/client-errors`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({
        kind: kind.slice(0, 40),
        message: message.slice(0, 2000),
        stack: stack?.slice(0, 8000),
        url: window.location.pathname.slice(0, 500),
        requestId: requestId?.slice(0, 64),
      }),
    }).catch(() => {});
  } catch {
    /* reporting must never cause an error itself */
  }
}

/** Reports uncaught errors and unhandled promise rejections. Call once at start-up. */
export function installErrorReporting(): void {
  if (typeof window === 'undefined') return;
  window.addEventListener('error', (e) => {
    // Ignore errors from other origins' scripts (browser extensions): they carry no detail.
    if (!e.message || e.message === 'Script error.') return;
    reportClientError('error', e.message, e.error instanceof Error ? e.error.stack : `${e.filename}:${e.lineno}:${e.colno}`);
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    reportClientError('unhandledrejection', r instanceof Error ? r.message : String(r), r instanceof Error ? r.stack : undefined);
  });
}
