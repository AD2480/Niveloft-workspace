import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBackendStartup } from './backendStartup';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
const up = () => new Response(JSON.stringify({ status: 'UP' }), { headers: { 'Content-Type': 'application/json' } });

describe('backend startup', () => {
  it('shares one probe, announces a slow startup, and recovers from a hung host', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockImplementationOnce(() => new Promise(() => {})).mockResolvedValueOnce(up());
    vi.stubGlobal('fetch', fetcher);
    const backend = createBackendStartup('https://api.example/actuator/health');
    const events: string[] = [];
    const unsubscribe = backend.subscribe(() => events.push(backend.getState()));
    const first = backend.check();
    expect(backend.check()).toBe(first);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(backend.getState()).toBe('starting');
    await vi.advanceTimersByTimeAsync(12_000);
    expect(await first).toBe(true);
    expect(events).toEqual(['checking', 'starting', 'ready']);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0][1]).not.toHaveProperty('body');
    expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
    expect(await backend.check()).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(2);
    unsubscribe();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds an outage and allows another attempt without refreshing the page', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(() => new Promise(() => {}));
    vi.stubGlobal('fetch', fetcher);
    const backend = createBackendStartup('https://api.example/actuator/health');
    const result = backend.check();
    await vi.advanceTimersByTimeAsync(300_000);
    expect(await result).toBe(false);
    expect(backend.getState()).toBe('unavailable');
    expect(vi.getTimerCount()).toBe(0);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(up()));
    expect(await backend.check()).toBe(true);
    expect(backend.getState()).toBe('ready');
  });

  it('does not treat a proxy HTML page as a ready API, and reports a database outage', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response('<html>Starting</html>'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'DOWN' }), { status: 503 })));
    const backend = createBackendStartup('https://api.example/actuator/health');
    const result = backend.check();
    await vi.advanceTimersByTimeAsync(2000);
    expect(await result).toBe(false);
    expect(backend.getState()).toBe('unhealthy');
  });
});
