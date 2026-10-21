/**
 * UTM tracking: which campaign or site brought a visitor. On the first page of a visit the
 * utm_source, utm_medium, utm_campaign, utm_term and utm_content tags (or, without them, the
 * referring site) are read and the tags are removed from the address bar, so links copied from
 * it stay clean. They're sent with a new account (and with contact messages) so the operator can
 * see which campaigns bring sign-ups; nothing else identifies the visit.
 *
 * They're kept in memory for the visit. Only with analytics consent are they also kept in this
 * tab's session storage, so they survive a reload.
 */

export const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'] as const;

export interface Attribution {
  source: string;
  medium: string | null;
  campaign: string | null;
  term: string | null;
  content: string | null;
  /** The site the visitor came from (host only), when it wasn't this one. */
  referrer: string | null;
  /** The first page of the visit (path only). */
  landingPath: string;
}

const SESSION_KEY = 'projectflow.attribution';
let current: Attribution | null = null;

/** Trimmed, one line, printable, at most 100 characters; empty becomes null. */
export function cleanTag(v: string | null | undefined): string | null {
  if (!v) return null;
  const s = v
    .replace(/\s+/g, ' ')
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .replace(/[<>"`]/g, '')
    .trim()
    .slice(0, 100);
  return s || null;
}

/** Reads a visit's attribution from its address and referrer. Pure: no side effects. */
export function readAttribution(href: string, referrer: string, ownHost: string): Attribution | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  const get = (k: string) => cleanTag(url.searchParams.get(k));
  const source = get('utm_source');
  let refHost: string | null = null;
  try {
    refHost = referrer ? new URL(referrer).hostname.toLowerCase() : null;
  } catch {
    refHost = null;
  }
  if (refHost === ownHost.toLowerCase()) refHost = null;
  if (!source && !refHost) return null;
  return {
    source: source ?? refHost!,
    medium: get('utm_medium') ?? (source ? null : 'referral'),
    campaign: get('utm_campaign'),
    term: get('utm_term'),
    content: get('utm_content'),
    referrer: refHost,
    landingPath: url.pathname.slice(0, 200),
  };
}

/** The address without its utm_ tags (other parameters and the #hash are kept). */
export function withoutUtm(href: string): string {
  const url = new URL(href);
  for (const k of UTM_KEYS) url.searchParams.delete(k);
  return `${url.pathname}${url.search}${url.hash}`;
}

/** Call once when the app starts. */
export function captureAttribution(): void {
  if (typeof window === 'undefined') return;
  const found = readAttribution(window.location.href, document.referrer, window.location.hostname);
  if (found) {
    // The first campaign of the visit wins; a later internal link can't overwrite it.
    current = current ?? restore() ?? found;
    if (UTM_KEYS.some((k) => new URL(window.location.href).searchParams.has(k))) {
      window.history.replaceState(window.history.state, '', withoutUtm(window.location.href));
    }
  } else {
    current = current ?? restore();
  }
}

export function attribution(): Attribution | null {
  return current;
}

/** Called when analytics consent is given or withdrawn. */
export function rememberAttribution(allowed: boolean): void {
  try {
    if (allowed && current) sessionStorage.setItem(SESSION_KEY, JSON.stringify(current));
    else if (!allowed) sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* storage blocked: memory only */
  }
}

function restore(): Attribution | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    const a = raw ? (JSON.parse(raw) as Attribution) : null;
    return a && typeof a.source === 'string' ? a : null;
  } catch {
    return null;
  }
}

/** The campaign as a query string for analytics' first page view ("?utm_source=…"), or "". */
export function campaignQuery(): string {
  const a = current;
  // A plain referral has no tags; analytics sees the referring site by itself.
  if (!a || (a.medium === 'referral' && !a.campaign)) return '';
  const q = new URLSearchParams();
  q.set('utm_source', a.source);
  if (a.medium) q.set('utm_medium', a.medium);
  if (a.campaign) q.set('utm_campaign', a.campaign);
  if (a.term) q.set('utm_term', a.term);
  if (a.content) q.set('utm_content', a.content);
  return `?${q.toString()}`;
}

/** For tests. */
export function setAttributionForTesting(a: Attribution | null): void {
  current = a;
}
