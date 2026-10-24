import { afterEach, describe, expect, it, vi } from 'vitest';
import { withRequestDeadline } from './requestDeadline';

afterEach(() => vi.useRealTimers());

describe('whole-request deadlines', () => {
  it('finishes even when a transport ignores abort and never settles', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const request = withRequestDeadline((s) => { signal = s; return new Promise(() => {}); }, 1000);
    const rejection = expect(request).rejects.toMatchObject({ name: 'TimeoutError' });
    await vi.advanceTimersByTimeAsync(1000);
    await rejection;
    expect(signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears the deadline after success and propagates cancellation', async () => {
    vi.useFakeTimers();
    expect(await withRequestDeadline(async () => 'done', 1000)).toBe('done');
    expect(vi.getTimerCount()).toBe(0);
    const parent = new AbortController();
    const request = withRequestDeadline(() => new Promise(() => {}), 1000, parent.signal);
    const rejection = expect(request).rejects.toMatchObject({ name: 'AbortError' });
    parent.abort();
    await rejection;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not start a request that was already cancelled', async () => {
    const request = vi.fn(async () => 'sent');
    await expect(withRequestDeadline(request, 1000, AbortSignal.abort())).rejects.toMatchObject({ name: 'AbortError' });
    expect(request).not.toHaveBeenCalled();
  });
});
