import { ServerCrash } from 'lucide-react';
import { useEffect, useSyncExternalStore } from 'react';
import { USE_TEST_API } from '@/config';
import { Spinner } from '@/components/ui/Spinner';
import { backendStartup } from './backendStartup';

/** Explain cold starts promptly; the form and this banner share the same bounded check. */
export function BackendStatus() {
  const state = useSyncExternalStore(backendStartup.subscribe, backendStartup.getState);
  useEffect(() => {
    if (!USE_TEST_API) void backendStartup.check();
  }, []);

  if (USE_TEST_API || state === 'idle' || state === 'checking' || state === 'ready') return null;
  const starting = state === 'starting';
  return (
    <div role="status" aria-live="polite" className="mb-6 border border-warning/40 bg-warning-soft px-4 py-3 text-[13px] text-ink-2">
      <p className="flex items-center gap-2 font-semibold text-warning">
        {starting ? <Spinner className="size-4 shrink-0" /> : <ServerCrash className="size-4 shrink-0" aria-hidden="true" />}
        {starting ? 'Starting Niveloft…' : 'Niveloft is temporarily unavailable'}
      </p>
      <p className="mt-1.5 leading-relaxed">
        {starting
          ? 'The server is waking up after being idle. This can take a few minutes. You can fill in the form; your request will continue automatically when it’s ready.'
          : state === 'unhealthy'
            ? 'The server can’t connect to a service it needs. Your details are still in this form. Please try again in a moment.'
            : 'The server hasn’t responded yet. Your details are still in this form. Please try connecting again.'}
      </p>
      {!starting && (
        <button type="button" className="mt-2 font-medium text-accent underline underline-offset-2" onClick={() => void backendStartup.check()}>
          Try connecting again
        </button>
      )}
    </div>
  );
}
