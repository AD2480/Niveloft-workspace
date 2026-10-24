import { describe, expect, it } from 'vitest';
import { newIdempotencyKey, retryDelay, timeoutFor, TIMEOUT_MS, withHeader } from './requestPolicy';

const base = { method: 'GET', url: '/projects/1', attempt: 0, hasIdempotencyKey: false };

describe('request policy', () => {
  it('gives AI and uploads longer timeouts', () => {
    expect(timeoutFor('/projects/1/ai/ask', undefined)).toBe(TIMEOUT_MS.ai);
    expect(timeoutFor('/ai/status', undefined)).toBe(TIMEOUT_MS.default);
    expect(timeoutFor('/tasks/1/submissions', new FormData())).toBe(TIMEOUT_MS.upload);
    expect(timeoutFor('/projects', { a: 1 })).toBe(TIMEOUT_MS.default);
    expect(timeoutFor('/auth/login', {})).toBe(TIMEOUT_MS.auth);
    expect(timeoutFor('/auth/register', {})).toBe(TIMEOUT_MS.auth);
  });

  it('retries reads on lost connections, timeouts and busy servers, twice at most', () => {
    expect(retryDelay({ ...base, status: 'FETCH_ERROR' })).toBeGreaterThan(0);
    expect(retryDelay({ ...base, status: 'TIMEOUT_ERROR' })).toBeGreaterThan(0);
    expect(retryDelay({ ...base, status: 503 })).toBeGreaterThan(0);
    expect(retryDelay({ ...base, status: 503, attempt: 2 })).toBeNull();
    expect(retryDelay({ ...base, status: 404 })).toBeNull();
    expect(retryDelay({ ...base, status: 500 })).toBeNull();
  });

  it('retries changes only when they carry an idempotency key', () => {
    expect(retryDelay({ ...base, method: 'POST', status: 'FETCH_ERROR' })).toBeNull();
    expect(retryDelay({ ...base, method: 'POST', status: 'FETCH_ERROR', hasIdempotencyKey: true })).toBeGreaterThan(0);
  });

  it('never retries AI requests', () => {
    expect(retryDelay({ ...base, url: '/projects/1/ai/ask', method: 'POST', status: 'TIMEOUT_ERROR', hasIdempotencyKey: true })).toBeNull();
  });

  it('never resends credentials or registration after an ambiguous response', () => {
    for (const url of ['/auth/login', '/auth/register']) {
      for (const status of ['FETCH_ERROR', 'TIMEOUT_ERROR', 503, 429]) {
        expect(retryDelay({ ...base, url, method: 'POST', status, hasIdempotencyKey: true })).toBeNull();
      }
    }
  });

  it('waits as long as a 429 asks, but not more than 10 seconds', () => {
    expect(retryDelay({ ...base, status: 429, retryAfter: 3 })).toBe(3000);
    expect(retryDelay({ ...base, status: 429, retryAfter: 60 })).toBeNull();
  });

  it('makes unique keys and adds headers to any header shape', () => {
    expect(newIdempotencyKey()).not.toBe(newIdempotencyKey());
    expect(withHeader(undefined, 'A', '1')).toEqual({ A: '1' });
    expect(withHeader({ B: '2' }, 'A', '1')).toEqual({ B: '2', A: '1' });
    expect(withHeader([['B', '2']], 'A', '1')).toEqual([['B', '2'], ['A', '1']]);
    expect((withHeader(new Headers({ B: '2' }), 'A', '1') as Headers).get('A')).toBe('1');
  });
});
