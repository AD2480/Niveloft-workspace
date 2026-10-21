import type { AiMistake } from '@/api/types';
import { API_BASE_URL, USE_TEST_API } from '@/config';

/** The kinds of mistake, in the order they're offered, with the words people see. */
export const MISTAKES: [AiMistake, string][] = [
  ['wrong-facts', 'Said something the records contradict'],
  ['missed-record', 'Missed something that is in the records'],
  ['unknown-as-no', 'Treated missing information as a no'],
  ['wrong-task', 'Talked about the wrong task, person or project'],
  ['overstepped', 'Claimed or suggested something it may not do'],
  ['unclear', 'Hard to follow, or too long'],
  ['slow', 'Too slow'],
  ['other', 'Something else'],
];

/**
 * Downloads a project's corrected answers as draft eval cases (JSON lines, owners and managers), for
 * the ml/ tool-calling eval. Throws an Error with a readable message when it can't.
 */
export async function downloadCorrections(projectId: number, projectKey: string, token: string | null): Promise<void> {
  const path = `/projects/${projectId}/ai/feedback/cases.jsonl`;
  let text: string;
  if (USE_TEST_API) {
    const { handleMockRequest } = await import('@/mock/server');
    const res = await handleMockRequest({ method: 'GET', url: `/api${path}`, body: undefined, token });
    if (res.status !== 200) throw new Error((res.body as { message?: string }).message ?? 'Couldn’t prepare the file. Try again.');
    text = (res.body as { data: string }).data;
  } else {
    const res = await fetch(`${API_BASE_URL}${path}`, {
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), Accept: 'application/x-ndjson' },
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      throw new Error(body?.message ?? (res.status === 403 ? 'Only the project’s owners and managers can download corrections.' : 'Couldn’t download the file. Try again.'));
    }
    text = await res.text();
  }
  const url = URL.createObjectURL(new Blob([text], { type: 'application/x-ndjson;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${projectKey}-flurry-corrections.jsonl`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
