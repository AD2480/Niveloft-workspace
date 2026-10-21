import { useEffect, useRef, useState } from 'react';
import { TURNSTILE_SITE_KEY } from '@/config';

interface TurnstileApi {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  reset: (id?: string) => void;
  remove: (id?: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
let loading: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SCRIPT;
    s.async = true;
    s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('Turnstile did not load')));
    s.onerror = () => {
      loading = null;
      reject(new Error('Turnstile could not be loaded'));
    };
    document.head.appendChild(s);
  });
  return loading;
}

/**
 * Cloudflare Turnstile, the check that a person (not a bot) is filling in the form. Shown only when
 * VITE_TURNSTILE_SITE_KEY is set; most people just see a tick. The token goes to the backend,
 * which verifies it with Cloudflare. `resetKey` changes after a failed submit, for a fresh token.
 */
export function Turnstile({ onToken, resetKey = 0, serverRequiresIt = false }: { onToken: (token: string | null) => void; resetKey?: number; serverRequiresIt?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const cb = useRef(onToken);
  cb.current = onToken;

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY || !box.current) return;
    let id: string | undefined;
    let cancelled = false;
    loadTurnstile()
      .then((t) => {
        if (cancelled || !box.current) return;
        id = t.render(box.current, {
          sitekey: TURNSTILE_SITE_KEY,
          theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light',
          callback: (token: string) => cb.current(token),
          'expired-callback': () => cb.current(null),
          'error-callback': () => cb.current(null),
        });
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
      cb.current(null);
      if (id && window.turnstile) window.turnstile.remove(id);
    };
  }, [resetKey]);

  if (!TURNSTILE_SITE_KEY) {
    return serverRequiresIt ? (
      <p className="border border-danger/30 bg-danger-soft px-3 py-2 text-[12.5px] text-danger" role="alert">
        This server checks for bots, but this site isn’t set up with the matching key (VITE_TURNSTILE_SITE_KEY), so the form can’t be sent. Please tell whoever runs it.
      </p>
    ) : null;
  }
  return (
    <div>
      <div ref={box} className="min-h-[65px]" aria-label="Check that you’re not a bot" />
      {failed && (
        <p className="mt-1 text-[12px] text-danger" role="alert">
          The bot check couldn’t load. Check your connection or ad blocker, then reload the page.
        </p>
      )}
    </div>
  );
}

/**
 * A field people never see or fill in; bots that fill in every field give themselves away.
 * It's off-screen rather than display:none, which some bots skip, and hidden from screen readers.
 */
export function Honeypot({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute -left-[10000px] h-px w-px overflow-hidden opacity-0">
      <label>
        Website (leave empty)
        <input type="text" name="website" tabIndex={-1} autoComplete="off" value={value} onChange={(e) => onChange(e.target.value)} />
      </label>
    </div>
  );
}
