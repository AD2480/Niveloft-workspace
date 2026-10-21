import {
  createApi,
  fetchBaseQuery,
  type BaseQueryFn,
  type FetchArgs,
  type FetchBaseQueryError,
} from '@reduxjs/toolkit/query/react';
import { API_BASE_URL, MOCK_LATENCY_MS, USE_TEST_API } from '@/config';
import { newIdempotencyKey, retryDelay, timeoutFor, withHeader } from '@/lib/requestPolicy';
import { sessionExpired, tokenRefreshed } from '@/features/auth/authSlice';
import { isKept } from '@/features/auth/keptSignIn';
import { renewKeptSignIn } from '@/features/auth/renewal';
import type { ApiResponse, User } from './types';

interface StateWithAuth {
  auth: { token: string | null; user: User | null };
}

const httpBaseQuery = fetchBaseQuery({
  baseUrl: API_BASE_URL,
  prepareHeaders: (headers, { getState }) => {
    const token = (getState() as StateWithAuth).auth.token;
    if (token) headers.set('Authorization', `Bearer ${token}`);
    headers.set('Accept', 'application/json');
    return headers;
  },
});

function toQueryString(params: Record<string, unknown> | undefined): string {
  if (!params) return '';
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') search.set(k, String(v));
  }
  const s = search.toString();
  return s ? `?${s}` : '';
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Routes requests to the in-browser mock API (src/mock) instead of the network. */
const mockBaseQuery: BaseQueryFn<string | FetchArgs, unknown, FetchBaseQueryError> = async (args, api) => {
  const a: FetchArgs = typeof args === 'string' ? { url: args } : args;
  const { handleMockRequest } = await import('@/mock/server');
  const [min, max] = MOCK_LATENCY_MS;
  await sleep(min + Math.random() * (max - min));
  const token = (api.getState() as StateWithAuth).auth.token;
  const res = await handleMockRequest({
    method: a.method ?? 'GET',
    url: `${a.url}${toQueryString(a.params)}`,
    body: a.body,
    token,
  });
  if (res.status >= 400) return { error: { status: res.status, data: res.body } };
  return { data: res.body };
};

/** A 401 from these isn't an ended sign-in: wrong credentials, or (signing out) nothing left to sign out. */
const PUBLIC_ENDPOINTS = new Set(['login', 'register', 'logout']);

/**
 * Every request: a timeout (longer for uploads and AI), an Idempotency-Key on every change (so a
 * retry or a double click can't do it twice), and up to two retries with growing waits when the
 * connection drops, the request times out, the server is busy or rate-limits (see requestPolicy).
 */
const resilientQuery: BaseQueryFn<string | FetchArgs, unknown, FetchBaseQueryError> = async (args, api, extra) => {
  let a: FetchArgs = typeof args === 'string' ? { url: args } : { ...args };
  const method = (a.method ?? 'GET').toUpperCase();
  const write = method !== 'GET' && method !== 'HEAD';
  if (write) a = { ...a, headers: withHeader(a.headers as Record<string, string> | undefined, 'Idempotency-Key', newIdempotencyKey()) };
  a.timeout ??= timeoutFor(a.url, a.body);
  for (let attempt = 0; ; attempt++) {
    const result = USE_TEST_API ? await mockBaseQuery(a, api, extra) : await httpBaseQuery(a, api, extra);
    if (!result.error) return result;
    const retryAfter = Number((result.meta as { response?: Response } | undefined)?.response?.headers.get('Retry-After') ?? '') || null;
    const wait = retryDelay({ status: result.error.status, method, url: a.url, attempt, hasIdempotencyKey: write, retryAfter });
    if (wait === null || api.signal.aborted) return result;
    await sleep(wait);
  }
};

/**
 * A 401 means this tab's token no longer works. If another request has renewed it meanwhile, the
 * request is retried with the new one. If this browser has a kept sign-in ("keep me signed in") for
 * the same account, it's renewed from its cookie and the request retried once (a token lasts a day
 * at most; the kept sign-in, longer). Otherwise the sign-in has ended, and the sign-in page says so.
 * A request refused with 401 did nothing, so retrying it, even a change, is safe.
 */
const baseQuery: BaseQueryFn<string | FetchArgs, unknown, FetchBaseQueryError> = async (args, api, extra) => {
  const auth = () => (api.getState() as StateWithAuth).auth;
  const usedToken = auth().token;
  const result = await resilientQuery(args, api, extra);
  if (result.error?.status !== 401 || PUBLIC_ENDPOINTS.has(api.endpoint)) return result;
  const current = auth().token;
  if (current && current !== usedToken) return resilientQuery(args, api, extra);
  if (usedToken && isKept()) {
    try {
      const renewed = await renewKeptSignIn();
      const me = auth().user;
      if (renewed && (!me || renewed.user.id === me.id)) {
        api.dispatch(tokenRefreshed({ ...renewed, kept: true }));
        return resilientQuery(args, api, extra);
      }
    } catch {
      return result; // the API couldn't be reached to renew it: keep the sign-in and report the error
    }
  }
  if (auth().token === usedToken) api.dispatch(sessionExpired());
  return result;
};

export const TAGS = [
  'Me',
  'Session',
  'Audit',
  'OpsSwitch',
  'Dashboard',
  'Project',
  'ProjectList',
  'Member',
  'Invitation',
  'MyInvitation',
  'Milestone',
  'Task',
  'TaskList',
  'Comment',
  'Mention',
  'CatchUp',
  'Submission',
  'Activity',
  'Notification',
  'Analytics',
  'Document',
  'AiFeedback',
  'Calendar',
  'Dependency',
  'AiStatus',
  'SiteHealth',
  'Arena',
] as const;

export const api = createApi({
  reducerPath: 'api',
  baseQuery,
  tagTypes: TAGS,
  refetchOnReconnect: true,
  refetchOnFocus: false,
  keepUnusedDataFor: 60,
  endpoints: () => ({}),
});

/** Unwrap the `{ success, data }` envelope. */
export function unwrap<T>(response: ApiResponse<T>): T {
  return response.data;
}
