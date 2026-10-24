/*
 * How the app talks to the API when things go wrong: how long to wait, what to retry, and how
 * to make retries safe. Pure functions, so they're easy to test.
 *
 * - Timeouts: 20 s for ordinary calls, 45 s for sign-in/up, 2 min for uploads, 200 s for AI.
 * - Retries: up to twice, with growing waits, for a lost connection, a timeout, a busy server
 *   (502/503/504) or a rate limit (429, waiting as long as the server asks, up to 10 s).
 *   Reads are always safe to retry; changes only because each carries an Idempotency-Key, so
 *   the server does them once however often they arrive. AI requests are never retried: each one
 *   costs, and the person can ask again.
 */

export const TIMEOUT_MS = { default: 20_000, auth: 45_000, upload: 120_000, ai: 200_000 };
export const MAX_RETRIES = 2;
const MAX_RETRY_AFTER_MS = 10_000;

export function isAiUrl(url: string): boolean {
  return /\/ai\//.test(url) && !/\/ai\/status/.test(url);
}

export function timeoutFor(url: string, body: unknown): number {
  if (/\/auth\/(login|register)(?:\?|$)/.test(url)) return TIMEOUT_MS.auth;
  if (isAiUrl(url)) return TIMEOUT_MS.ai;
  if (typeof FormData !== 'undefined' && body instanceof FormData) return TIMEOUT_MS.upload;
  return TIMEOUT_MS.default;
}

export interface RetryInput {
  status: number | string | undefined;
  method: string;
  url: string;
  attempt: number;
  hasIdempotencyKey: boolean;
  /** Seconds from a Retry-After header, if any. */
  retryAfter?: number | null;
}

/** Milliseconds to wait before retrying, or null to give up. */
export function retryDelay({ status, method, url, attempt, hasIdempotencyKey, retryAfter }: RetryInput): number | null {
  // Auth writes aren't covered by the signed-in idempotency store. Never replay credentials or
  // registration after an ambiguous timeout; readiness is retried before sending them instead.
  if (/\/auth\/(login|register)(?:\?|$)/.test(url)) return null;
  if (attempt >= MAX_RETRIES || isAiUrl(url)) return null;
  const read = method === 'GET' || method === 'HEAD';
  if (!read && !hasIdempotencyKey) return null;
  const transient = status === 'FETCH_ERROR' || status === 'TIMEOUT_ERROR' || status === 502 || status === 503 || status === 504;
  if (status === 429) {
    const wait = (retryAfter ?? 2) * 1000;
    return wait > MAX_RETRY_AFTER_MS ? null : wait;
  }
  if (!transient) return null;
  if (retryAfter) return Math.min(MAX_RETRY_AFTER_MS, retryAfter * 1000);
  // 0.5 s, then 1 s, with a little jitter so many tabs don't retry in step.
  return 500 * 2 ** attempt + Math.floor(Math.random() * 200);
}

/** A fresh key for one action a person started (reused only by that action's own retries). */
export function newIdempotencyKey(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `k-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

type HeaderInit = Headers | string[][] | Record<string, string | undefined> | undefined;

/** Adds a header to whatever shape of headers a request already has. */
export function withHeader(headers: HeaderInit, name: string, value: string): Headers | string[][] | Record<string, string | undefined> {
  if (typeof Headers !== 'undefined' && headers instanceof Headers) {
    const h = new Headers(headers);
    h.set(name, value);
    return h;
  }
  if (Array.isArray(headers)) return [...headers, [name, value]];
  return { ...(headers ?? {}), [name]: value };
}
