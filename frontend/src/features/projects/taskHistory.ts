import { API_BASE_URL, USE_TEST_API } from '@/config';

/**
 * Downloads a project's task history (CSV, owners and managers) for training a deadline forecast on
 * the team's own work. Throws an Error with a readable message when it can't.
 */
export async function downloadTaskHistory(projectId: number, projectKey: string, token: string | null): Promise<void> {
  const path = `/projects/${projectId}/export/task-history.csv`;
  let csv: string;
  if (USE_TEST_API) {
    const { handleMockRequest } = await import('@/mock/server');
    const res = await handleMockRequest({ method: 'GET', url: `/api${path}`, body: undefined, token });
    if (res.status !== 200) throw new Error((res.body as { message?: string }).message ?? 'Couldn’t prepare the file. Try again.');
    csv = (res.body as { data: string }).data;
  } else {
    const res = await fetch(`${API_BASE_URL}${path}`, {
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), Accept: 'text/csv' },
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      throw new Error(body?.message ?? (res.status === 403 ? 'Only the project’s owners and managers can download its task history.' : 'Couldn’t download the file. Try again.'));
    }
    csv = await res.text();
  }
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${projectKey}-task-history-v1.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
