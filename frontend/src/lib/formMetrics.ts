/*
 * Form success rates. Each form reports four moments: shown, sent, succeeded, failed (with the
 * kind of failure). Only these counts go to the server — never what was typed, and nothing that
 * identifies the person — and the operator sees them as success rates on the Site health page.
 * Events are batched and sent every few seconds, and when the page is hidden.
 */

export const TRACKED_FORMS = [
  'sign-in',
  'sign-up',
  'forgot-password',
  'reset-password',
  'contact',
  'project',
  'task',
  'milestone',
  'invite',
  'submit-work',
  'review',
  'profile',
  'password',
  'comment',
] as const;
export type TrackedForm = (typeof TRACKED_FORMS)[number];

/**
 * view: the form was shown. submit: the person pressed send. success: the server accepted it.
 * invalid: the form's own checks stopped it. rejected: the server refused it (4xx).
 * failed: the server or the connection failed (5xx, network, timeout).
 */
export const FORM_EVENTS = ['view', 'submit', 'success', 'invalid', 'rejected', 'failed'] as const;
export type FormEvent = (typeof FORM_EVENTS)[number];

const pending = new Map<string, number>();
let timer: ReturnType<typeof setTimeout> | null = null;
let installed = false;
let sender: (body: string, final: boolean) => void = defaultSend;

export function trackForm(form: TrackedForm, event: FormEvent): void {
  const key = `${form}|${event}`;
  pending.set(key, (pending.get(key) ?? 0) + 1);
  install();
  if (!timer) timer = setTimeout(() => flushFormMetrics(false), 4000);
}

/** The kind of failure for an API error (see api/errors). */
export function failureKind(error: unknown): FormEvent {
  const status = (error as { status?: unknown } | null)?.status;
  if (typeof status === 'number' && status >= 400 && status < 500 && status !== 408 && status !== 429) return 'rejected';
  return 'failed';
}

export function flushFormMetrics(final: boolean): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (!pending.size) return;
  const events = [...pending].map(([key, count]) => {
    const [form, event] = key.split('|');
    return { form, event, count };
  });
  pending.clear();
  sender(JSON.stringify({ events }), final);
}

function install() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  // The last batch goes out as the page is hidden or closed.
  window.addEventListener('pagehide', () => flushFormMetrics(true));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushFormMetrics(true);
  });
}

function defaultSend(body: string) {
  // Read the configuration when sending (it's already loaded; this keeps the module testable).
  void import('@/config')
    .then(({ API_BASE_URL, USE_TEST_API }) => {
      if (USE_TEST_API) {
        return import('@/mock/server').then(({ handleMockRequest }) => handleMockRequest({ method: 'POST', url: '/api/metrics/forms', body: JSON.parse(body) }));
      }
      // keepalive lets the last batch finish after the page is closed. (Not sendBeacon: it can't
      // send JSON to an API on another domain.)
      return fetch(`${API_BASE_URL}/metrics/forms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true });
    })
    .catch(() => undefined); // counts are best effort
}

/** For tests. */
export function setFormMetricsSender(send: ((body: string, final: boolean) => void) | null): void {
  sender = send ?? defaultSend;
}
