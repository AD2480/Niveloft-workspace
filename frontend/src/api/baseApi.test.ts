import { configureStore } from '@reduxjs/toolkit';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/config', () => ({ API_BASE_URL: 'https://api.example/api', USE_TEST_API: false, MOCK_LATENCY_MS: [0, 0], STORAGE_KEYS: {} }));

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.resetModules(); });

describe('authentication during a backend cold start', () => {
  it('waits for readiness before sending credentials and does not replay a failed registration', async () => {
    vi.useFakeTimers();
    let finishStartup: ((response: Response) => void) | undefined;
    const requests: string[] = [];
    const fetcher = vi.fn((request: string | Request) => {
      if (typeof request === 'string') return new Promise<Response>((resolve) => { finishStartup = resolve; });
      requests.push(request.url);
      return Promise.resolve(new Response(JSON.stringify({ message: 'Server busy' }), { status: 503 }));
    });
    vi.stubGlobal('fetch', fetcher);
    const { api } = await import('./baseApi');
    const endpoints = api.injectEndpoints({ endpoints: (build) => ({
      register: build.mutation<unknown, void>({ query: () => ({ url: '/auth/register', method: 'POST', body: { email: 'test@example.test', password: 'synthetic-test-password' } }) }),
    }) });
    const store = configureStore({
      reducer: { api: endpoints.reducer, auth: () => ({ token: null, user: null }) },
      middleware: (getDefault) => getDefault().concat(endpoints.middleware),
    });
    const action = store.dispatch(endpoints.endpoints.register.initiate());
    await vi.advanceTimersByTimeAsync(10_000);
    expect(requests).toEqual([]);
    expect(finishStartup).toBeTypeOf('function');
    finishStartup!(new Response(JSON.stringify({ status: 'UP' })));
    await vi.advanceTimersByTimeAsync(0);
    const result = await action;
    expect(result.error).toMatchObject({ status: 503 });
    expect(requests).toEqual(['https://api.example/api/auth/register']);
    store.dispatch(endpoints.util.resetApiState());
  });

  it('ends a hung authentication request after the request deadline', async () => {
    vi.useFakeTimers();
    let authSignal: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn((request: string | Request) => {
      if (typeof request === 'string') return Promise.resolve(new Response(JSON.stringify({ status: 'UP' })));
      authSignal = request.signal;
      return new Promise(() => {});
    }));
    const { api } = await import('./baseApi');
    const endpoints = api.injectEndpoints({ endpoints: (build) => ({
      login: build.mutation<unknown, void>({ query: () => ({ url: '/auth/login', method: 'POST', body: {} }) }),
    }) });
    const store = configureStore({
      reducer: { api: endpoints.reducer, auth: () => ({ token: null, user: null }) },
      middleware: (getDefault) => getDefault().concat(endpoints.middleware),
    });
    const action = store.dispatch(endpoints.endpoints.login.initiate());
    await vi.advanceTimersByTimeAsync(45_000);
    const result = await action;
    expect(result.error).toMatchObject({ status: 'TIMEOUT_ERROR' });
    expect(authSignal?.aborted).toBe(true);
    store.dispatch(endpoints.util.resetApiState());
  });
});
