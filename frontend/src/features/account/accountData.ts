import { API_BASE_URL, USE_TEST_API } from '@/config';

/**
 * Downloads everything Niveloft holds about the signed-in person, as JSON. Throws an Error with a
 * readable message when it can't.
 */
export async function downloadAccountCopy(token: string | null): Promise<void> {
  const path = '/users/me/export';
  let body: unknown;
  if (USE_TEST_API) {
    const { handleMockRequest } = await import('@/mock/server');
    const res = await handleMockRequest({ method: 'GET', url: `/api${path}`, body: undefined, token });
    if (res.status !== 200) throw new Error((res.body as { message?: string }).message ?? 'The copy couldn’t be prepared. Try again.');
    body = (res.body as { data: unknown }).data;
  } else {
    const res = await fetch(`${API_BASE_URL}${path}`, {
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), Accept: 'application/json' },
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => null)) as { message?: string } | null;
      throw new Error(err?.message ?? 'The copy couldn’t be downloaded. Try again.');
    }
    body = await res.json();
  }
  const url = URL.createObjectURL(new Blob([JSON.stringify(body, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `niveloft-account-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
