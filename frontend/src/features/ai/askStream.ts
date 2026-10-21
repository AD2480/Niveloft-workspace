import { getErrorMessage } from '@/api/errors';
import type { AiAnswer, AiAskRequest, ApiErrorBody } from '@/api/types';
import { API_BASE_URL, USE_TEST_API } from '@/config';
import { AskStopped, followAnswer, type AskProgress } from './answerEvents';

export { AskStopped, type AskProgress } from './answerEvents';

/*
 * Asking Flurry with the answer followed as it's written (see answerEvents). Stopping aborts the
 * request and tells the server, which closes the provider's stream so it stops generating.
 */

/**
 * The server refused the question before answering it (or couldn't be reached): nothing ran, so
 * asking again another way is safe. {@code status} is 0 when no response came at all.
 */
export class AskRefused extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    message: string,
  ) {
    super(message);
    this.name = 'AskRefused';
  }
}

export interface StreamAskOptions {
  projectId: number;
  body: AiAskRequest;
  token: string | null;
  /** Chosen here, so the stop button can name the question. */
  requestId: string;
  signal: AbortSignal;
  onProgress: (p: AskProgress) => void;
}

/** Asks and follows the answer as it's written. Resolves with the checked answer; throws AskStopped, AskRefused or an Error. */
export async function streamAsk(o: StreamAskOptions): Promise<AiAnswer> {
  const path = `/projects/${o.projectId}/ai/ask/stream?requestId=${encodeURIComponent(o.requestId)}`;
  if (USE_TEST_API) {
    // The in-browser test API has no AI: it refuses, as the server would without a provider.
    const { handleMockRequest } = await import('@/mock/server');
    const res = await handleMockRequest({ method: 'POST', url: `/api${path}`, body: o.body, token: o.token });
    const b = res.body as ApiErrorBody;
    throw new AskRefused(res.status, b?.code ?? null, getErrorMessage({ status: res.status, data: b }));
  }
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', ...(o.token ? { Authorization: `Bearer ${o.token}` } : {}) },
      body: JSON.stringify(o.body),
      signal: o.signal,
    });
  } catch {
    if (o.signal.aborted) throw new AskStopped();
    throw new AskRefused(0, null, getErrorMessage({ status: 'FETCH_ERROR', error: 'unreachable' }));
  }
  if (!res.ok || !(res.headers.get('content-type') ?? '').includes('text/event-stream')) {
    const b = (await res.json().catch(() => null)) as ApiErrorBody | null;
    throw new AskRefused(res.status, b?.code ?? null, getErrorMessage({ status: res.status, data: b ?? undefined }));
  }
  if (!res.body) throw new Error('This browser can’t read answers as they’re written. Nothing was changed; ask again.');
  return followAnswer(res.body, o.signal, o.onProgress);
}

/** Tells the server to stop the asker's question (best effort: the aborted request stops it too). */
export function stopAsk(projectId: number, requestId: string, token: string | null): void {
  if (USE_TEST_API) return;
  void fetch(`${API_BASE_URL}/projects/${projectId}/ai/ask/${encodeURIComponent(requestId)}`, {
    method: 'DELETE',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    keepalive: true,
  }).catch(() => undefined);
}
