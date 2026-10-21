import { ServerCrash } from 'lucide-react';
import { useEffect, useState } from 'react';
import { API_BASE_URL, USE_TEST_API } from '@/config';

type State = 'checking' | 'up' | 'down' | 'unhealthy';

/** Where Spring Boot's health endpoint is, given the API base ("/api" through the Vite proxy, or an absolute URL). */
function healthUrl(): string {
  const base = new URL(API_BASE_URL, window.location.origin);
  return `${base.origin}/actuator/health`;
}

/**
 * Where the server is, for the message, unless this is local development through the Vite proxy
 * (then the message says how to start the backend instead).
 */
function hostedBackend(): string | null {
  const base = new URL(API_BASE_URL, window.location.origin);
  return base.origin === window.location.origin && import.meta.env.DEV ? null : base.origin;
}

/**
 * On the sign-in pages: checks that the API is reachable and healthy before
 * anyone types a password, and says exactly what to do if it isn't. Rechecks every few seconds
 * until the backend is up, so the message disappears on its own once it starts.
 */
export function BackendStatus() {
  const [state, setState] = useState<State>('checking');

  useEffect(() => {
    if (USE_TEST_API) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = async () => {
      let next: State;
      try {
        const res = await fetch(healthUrl(), { headers: { Accept: 'application/json' }, cache: 'no-store' });
        const body = (await res.json().catch(() => null)) as { status?: string; code?: string } | null;
        if (res.ok && body?.status === 'UP') next = 'up';
        else if (body?.code === 'BACKEND_UNAVAILABLE' || res.status === 502 || res.status === 504) next = 'down';
        else next = 'unhealthy'; // Spring answered, but reports DOWN (usually the database)
      } catch {
        next = 'down';
      }
      if (cancelled) return;
      setState(next);
      if (next !== 'up') timer = setTimeout(() => void check(), 4000);
    };
    void check();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  if (USE_TEST_API || state === 'checking' || state === 'up') return null;
  const hosted = hostedBackend();
  if (hosted) {
    return (
      <div role="status" className="mb-6 border border-warning/40 bg-warning-soft px-4 py-3 text-[13px] text-ink-2">
        <p className="flex items-center gap-2 font-semibold text-warning">
          <ServerCrash className="size-4 shrink-0" aria-hidden="true" />
          {state === 'down' ? 'The Niveloft server isn’t answering' : 'The Niveloft server is running but not healthy'}
        </p>
        <p className="mt-1.5 leading-relaxed">
          {state === 'down'
            ? `It may be starting up, since some hosts pause idle servers, or it may be down. Server: ${hosted}.`
            : 'It usually means the server can’t reach its database. Check the database and the server’s logs with whoever runs it.'}
        </p>
        <p className="mt-1.5 text-xs text-muted">This page keeps checking, and the message disappears once the server answers.</p>
      </div>
    );
  }
  return (
    <div role="status" className="mb-6 border border-warning/40 bg-warning-soft px-4 py-3 text-[13px] text-ink-2">
      <p className="flex items-center gap-2 font-semibold text-warning">
        <ServerCrash className="size-4 shrink-0" aria-hidden="true" />
        {state === 'down' ? 'The backend isn’t running' : 'The backend is running but not healthy'}
      </p>
      {state === 'down' ? (
        <p className="mt-1.5 leading-relaxed">
          Start it in a second terminal and wait for <em>Started ProjectFlowApplication</em>:
          <code className="mt-1.5 block bg-surface px-2 py-1 text-xs text-ink">cd backend &amp;&amp; docker compose up -d &amp;&amp; ./mvnw spring-boot:run</code>
        </p>
      ) : (
        <p className="mt-1.5 leading-relaxed">
          Spring Boot started but reports <strong>DOWN</strong>, which usually means MySQL isn’t reachable. Run{' '}
          <code className="bg-surface px-1 text-xs text-ink">docker compose up -d</code> in <code className="text-xs">backend</code>, then restart the backend.
        </p>
      )}
      <p className="mt-1.5 text-xs text-muted">This message disappears on its own once the backend answers.</p>
    </div>
  );
}
