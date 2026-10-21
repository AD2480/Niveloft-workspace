import type { FetchBaseQueryError } from '@reduxjs/toolkit/query';
import type { SerializedError } from '@reduxjs/toolkit';
import { API_BASE_URL } from '@/config';
import type { ApiErrorBody, ApiErrorCode } from './types';

type AnyError = FetchBaseQueryError | SerializedError | undefined | null | unknown;

function body(error: AnyError): ApiErrorBody | null {
  if (error && typeof error === 'object' && 'data' in error) {
    const data = (error as { data: unknown }).data;
    if (data && typeof data === 'object' && 'message' in data) return data as ApiErrorBody;
  }
  return null;
}

export function errorStatus(error: AnyError): number | string | null {
  if (error && typeof error === 'object' && 'status' in error) return (error as { status: number | string }).status;
  return null;
}

/** A user-friendly message for any RTK Query error. */
export function getErrorMessage(error: AnyError, fallback = 'Something went wrong. Please try again.'): string {
  const b = body(error);
  // Server errors carry the request id, which leads straight to the server's log lines.
  if (b?.message) return b.status >= 500 && b.requestId ? `${b.message} (Reference: ${b.requestId})` : b.message;
  const status = errorStatus(error);
  if (status === 'FETCH_ERROR') {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'You’re offline. Nothing was sent; try again when you’re back online.';
    return `Can’t reach the server at ${API_BASE_URL}. Check that the backend is running.`;
  }
  if (status === 429) return 'Too many requests in a short time. Please wait a few seconds and try again.';
  if (status === 'TIMEOUT_ERROR') return 'The server took too long to respond, even after retrying. Please try again in a moment.';
  // The Vite dev proxy answers 5xx with an empty or HTML body when Spring Boot isn't running.
  if (status === 'PARSING_ERROR' || (typeof status === 'number' && status >= 502 && status <= 504)) {
    return 'Can’t reach the Niveloft API. Start the backend (port 8080) and try again.';
  }
  if (status === 403) return 'You don’t have permission to do that.';
  if (status === 404) return 'We couldn’t find what you were looking for.';
  // A 5xx without our JSON body: usually Spring's default error page or a proxy failure.
  if (typeof status === 'number' && status >= 500) {
    return 'The server failed without explaining why. Check the backend terminal for the error, then try again.';
  }
  if (error && typeof error === 'object' && 'message' in error && typeof (error as SerializedError).message === 'string') {
    return (error as SerializedError).message!;
  }
  return fallback;
}

/** The server's request id for an error (it leads to the server's log lines), if it sent one. */
export function getRequestId(error: AnyError): string | null {
  const id = body(error)?.requestId;
  return typeof id === 'string' && /^[A-Za-z0-9._-]{4,64}$/.test(id) ? id : null;
}

/** Field-level validation errors from a 400/409 response. */
export function getFieldErrors(error: AnyError): Record<string, string> {
  return body(error)?.fieldErrors ?? {};
}

/** True when the server rejected a save because the record changed since it was loaded. */
export function isEditConflict(error: AnyError): boolean {
  return getErrorCode(error) === 'EDIT_CONFLICT';
}

/** The machine-readable error code (e.g. WORKFLOW_VIOLATION), if the server sent one. */
export function getErrorCode(error: AnyError): ApiErrorCode | null {
  return body(error)?.code ?? null;
}
