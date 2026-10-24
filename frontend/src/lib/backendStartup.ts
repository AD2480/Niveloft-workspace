import { withRequestDeadline } from './requestDeadline';

export type BackendState = 'idle' | 'checking' | 'starting' | 'ready' | 'unhealthy' | 'unavailable';
const STARTUP_TIMEOUT_MS = 300_000;
const PROBE_TIMEOUT_MS = 12_000;
const RETRY_MS = 2000;
const READY_FRESH_MS = 10_000;

/** One readiness check shared by the banner and authentication requests. Never sends credentials. */
export function createBackendStartup(healthUrl: string) {
  let state: BackendState = 'idle';
  let checkedAt = 0;
  let running: Promise<boolean> | null = null;
  const listeners = new Set<() => void>();
  const update = (next: BackendState) => {
    if (state === next) return;
    state = next;
    listeners.forEach((listener) => listener());
  };
  const probe = async (): Promise<boolean> => {
    update('checking');
    const deadline = Date.now() + STARTUP_TIMEOUT_MS;
    const slow = setTimeout(() => { if (state === 'checking') update('starting'); }, 2000);
    try {
      while (Date.now() < deadline) {
        try {
          const result = await withRequestDeadline(async (signal) => {
            const res = await fetch(healthUrl, { headers: { Accept: 'application/json' }, cache: 'no-store', signal });
            const body = await res.json().catch(() => null) as { status?: string } | null;
            return { ok: res.ok, status: body?.status };
          }, Math.min(PROBE_TIMEOUT_MS, deadline - Date.now()));
          if (result.ok && result.status === 'UP') {
            checkedAt = Date.now();
            update('ready');
            return true;
          }
          if (result.status === 'DOWN' || result.status === 'OUT_OF_SERVICE') {
            update('unhealthy');
            return false;
          }
        } catch {
          // A sleeping host may time out or return a non-JSON startup page. Probe again.
        }
        update('starting');
        const remaining = deadline - Date.now();
        if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, Math.min(RETRY_MS, remaining)));
      }
      update('unavailable');
      return false;
    } finally {
      clearTimeout(slow);
    }
  };
  return {
    getState: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    check: () => {
      if (running) return running;
      if (state === 'ready' && Date.now() - checkedAt < READY_FRESH_MS) return Promise.resolve(true);
      running = probe().finally(() => { running = null; });
      return running;
    },
  };
}
