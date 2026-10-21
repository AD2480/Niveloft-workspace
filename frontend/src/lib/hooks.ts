import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';

export function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

/** Sets document.title as "<title> · Niveloft". */
/** Title for pages inside the app (behind sign-in), which search engines should never index. */
export function useDocumentTitle(title: string | undefined) {
  useEffect(() => {
    document.title = title ? `${title} · Niveloft` : 'Niveloft';
    let robots = document.head.querySelector<HTMLMetaElement>('meta[name="robots"]');
    if (!robots) {
      robots = document.createElement('meta');
      robots.name = 'robots';
      document.head.appendChild(robots);
    }
    robots.content = 'noindex, nofollow';
    document.head.querySelector('link[rel="canonical"]')?.remove();
  }, [title]);
}

/**
 * Keep simple filter state in the URL query string so filtered views can be
 * bookmarked, shared and survive reloads. Empty values are removed.
 */
export function useUrlState<T extends Record<string, string>>(defaults: T): [T, (patch: Partial<T>) => void] {
  const [params, setParams] = useSearchParams();
  const state = Object.fromEntries(Object.entries(defaults).map(([k, d]) => [k, params.get(k) ?? d])) as T;
  const update = (patch: Partial<T>) => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(patch)) {
          if (v === undefined || v === '' || v === defaults[k]) next.delete(k);
          else next.set(k, String(v));
        }
        return next;
      },
      { replace: true },
    );
  };
  return [state, update];
}

/** Whether a CSS media query matches, kept up to date (e.g. to skip mounting desktop-only 3D on phones). */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(query).matches);
  useEffect(() => {
    const mq = typeof window !== 'undefined' ? window.matchMedia?.(query) : undefined;
    if (!mq) return;
    const update = () => setMatches(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, [query]);
  return matches;
}
