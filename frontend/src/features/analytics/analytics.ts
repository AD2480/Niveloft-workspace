import { ANALYTICS } from '@/config';
import { campaignQuery } from '@/lib/attribution';
import { redactPath, redactTitle } from './redact';

/**
 * Analytics, loaded only after the visitor agrees in the cookie banner, and only the services the
 * operator configured:
 * - Vercel Web Analytics (VITE_ANALYTICS=vercel): no cookies; page views are counted in aggregate.
 * - Google Analytics 4 (VITE_GA_MEASUREMENT_ID): uses cookies; page views only, advertising off.
 * Both only ever see a redacted path (ids and query strings removed, see redact.ts).
 */

type Queue = ((...args: unknown[]) => void) & { q?: unknown[] };

declare global {
  interface Window {
    va?: Queue;
    vaq?: unknown[];
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
    [key: `ga-disable-${string}`]: boolean | undefined;
  }
}

let active = false;
/** The visit's campaign tags go with the first page view only (the address bar no longer has them). */
let campaignSent = false;

function addScript(src: string, attrs: Record<string, string> = {}) {
  if (document.head.querySelector(`script[src="${src}"]`)) return;
  const s = document.createElement('script');
  s.src = src;
  s.defer = true;
  for (const [k, v] of Object.entries(attrs)) s.setAttribute(k, v);
  document.head.appendChild(s);
}

export function analyticsActive(): boolean {
  return active;
}

export function startAnalytics(): void {
  if (active || typeof window === 'undefined') return;
  active = true;
  if (ANALYTICS.vercel) {
    window.va =
      window.va ||
      function (...args: unknown[]) {
        (window.vaq = window.vaq || []).push(args);
      };
    // Every event passes through here first: drop it after consent is withdrawn, redact it otherwise.
    window.va('beforeSend', (event: { url: string }) => (active ? { ...event, url: `${window.location.origin}${redactPath(event.url)}` } : null));
    addScript('/_vercel/insights/script.js');
  }
  if (ANALYTICS.ga4) {
    window[`ga-disable-${ANALYTICS.ga4}`] = false;
    window.dataLayer = window.dataLayer || [];
    window.gtag =
      window.gtag ||
      function () {
        // gtag.js reads the arguments object itself, so push it unchanged.
        // eslint-disable-next-line prefer-rest-params
        window.dataLayer!.push(arguments);
      };
    window.gtag('consent', 'default', { analytics_storage: 'granted', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' });
    window.gtag('js', new Date());
    window.gtag('config', ANALYTICS.ga4, { send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false });
    const s = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(ANALYTICS.ga4)}`;
    if (!document.head.querySelector(`script[src="${s}"]`)) {
      const el = document.createElement('script');
      el.async = true;
      el.src = s;
      document.head.appendChild(el);
    }
  }
}

/** Consent withdrawn: nothing more is sent, and Google Analytics' cookies are removed. */
export function stopAnalytics(): void {
  active = false;
  if (ANALYTICS.ga4) {
    window[`ga-disable-${ANALYTICS.ga4}`] = true;
    for (const name of document.cookie.split(';').map((c) => c.split('=')[0].trim())) {
      if (name === '_ga' || name.startsWith('_ga_') || name === '_gid') {
        const host = window.location.hostname;
        for (const domain of ['', `; domain=${host}`, `; domain=.${host.split('.').slice(-2).join('.')}`]) {
          document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/${domain}`;
        }
      }
    }
  }
}

/** Google Analytics page views (Vercel's script follows route changes by itself). */
export function trackPage(pathname: string): void {
  if (!active || !ANALYTICS.ga4 || !window.gtag) return;
  const path = redactPath(pathname);
  const campaign = campaignSent ? '' : campaignQuery();
  campaignSent = true;
  const page = { page_location: `${window.location.origin}${path}${campaign}`, page_path: path, page_title: redactTitle(pathname) };
  // Set on the tag too, so GA's own automatic events (engagement, history page views) carry the
  // redacted address and title, not the real one.
  window.gtag('set', page);
  window.gtag('event', 'page_view', page);
}
