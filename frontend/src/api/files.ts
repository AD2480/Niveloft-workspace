import { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import { API_BASE_URL, USE_TEST_API } from '@/config';
import type { Attachment } from './types';

interface StateWithAuth {
  auth: { token: string | null };
}

/**
 * Evidence files are served by `GET /api/files/{id}` to project members only, so a plain
 * `<img src>` or `<a href>` can't carry the bearer token. This resolves an attachment to a
 * URL the browser can use: a short-lived object URL for a blob fetched with the token (with the
 * automated tests' in-browser API, the stored data URL).
 */
function apiUrl(url: string): string {
  // Attachment URLs are "/api/files/12"; API_BASE_URL may be "/api" or "http://host:8080/api".
  return `${API_BASE_URL}${url.replace(/^\/api/, '')}`;
}

export async function fetchFileBlob(file: Attachment, token: string | null): Promise<Blob> {
  // Files can be up to 10 MB: allow two minutes, then give up with a clear error.
  const res = await fetch(apiUrl(file.url), { headers: token ? { Authorization: `Bearer ${token}` } : {}, signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(res.status === 403 ? 'You don’t have access to this file.' : res.status === 404 ? 'This file is no longer available.' : 'Could not load the file.');
  return res.blob();
}

export type FileUrlState = { status: 'idle' | 'loading' } | { status: 'ready'; url: string } | { status: 'error'; message: string };

/** Object URL for an evidence file (for image previews). Revoked on unmount. */
export function useAuthorizedFileUrl(file: Attachment | null | undefined, enabled = true): FileUrlState {
  const token = useSelector((s: StateWithAuth) => s.auth.token);
  const [state, setState] = useState<FileUrlState>({ status: 'idle' });
  const mockUrl = USE_TEST_API ? (file?.url ?? '') : '';

  useEffect(() => {
    if (!file || !enabled || USE_TEST_API) return;
    let objectUrl: string | null = null;
    let cancelled = false;
    setState({ status: 'loading' });
    fetchFileBlob(file, token)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setState({ status: 'ready', url: objectUrl });
      })
      .catch((e: unknown) => {
        if (!cancelled) setState({ status: 'error', message: e instanceof Error ? e.message : 'Could not load the file.' });
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file, enabled, token]);

  if (USE_TEST_API) {
    return mockUrl ? { status: 'ready', url: mockUrl } : { status: 'error', message: 'The in-browser test API keeps only files under 512 KB; this one wasn’t stored.' };
  }
  return state;
}

/** Download an evidence file with the bearer token and save it under its original name. */
export async function downloadFile(file: Attachment, token: string | null): Promise<void> {
  let href = file.url;
  let revoke = false;
  if (!USE_TEST_API) {
    href = URL.createObjectURL(await fetchFileBlob(file, token));
    revoke = true;
  } else if (!href) {
    throw new Error('The in-browser test API keeps only files under 512 KB; this one wasn’t stored.');
  }
  const a = document.createElement('a');
  a.href = href;
  a.download = file.fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  if (revoke) setTimeout(() => URL.revokeObjectURL(href), 10_000);
}
