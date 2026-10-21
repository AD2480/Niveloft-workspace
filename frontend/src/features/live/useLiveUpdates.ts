import { useEffect, useState } from 'react';
import type { TagDescription } from '@reduxjs/toolkit/query';
import { api, TAGS } from '@/api/baseApi';
import { useAppDispatch, useAppSelector } from '@/app/store';
import { API_BASE_URL, USE_TEST_API } from '@/config';

type Tag = TagDescription<(typeof TAGS)[number]>;
export type LiveStatus = 'connecting' | 'live' | 'reconnecting' | 'offline' | 'local';

interface ProjectEvent {
  projectId: number;
  taskId: number | null;
  actorId: number | null;
  kind: string;
}

/** Everything a change in one project can affect. Events carry ids only; data is refetched with the user's own permissions. */
function tagsFor(e: ProjectEvent): Tag[] {
  const tags: Tag[] = [
    { type: 'Project', id: e.projectId },
    { type: 'ProjectList', id: 'LIST' },
    { type: 'TaskList', id: e.projectId },
    { type: 'TaskList', id: 'MINE' },
    { type: 'Analytics', id: e.projectId },
    { type: 'Milestone', id: e.projectId },
    { type: 'Activity', id: e.projectId },
    { type: 'Dependency', id: e.projectId },
    { type: 'Member', id: e.projectId },
    { type: 'Invitation', id: e.projectId },
    'Dashboard',
    'Calendar',
  ];
  if (e.taskId) {
    tags.push({ type: 'Task', id: e.taskId }, { type: 'Submission', id: e.taskId }, { type: 'Comment', id: e.taskId }, { type: 'Activity', id: `TASK-${e.taskId}` });
  }
  return tags;
}

/**
 * Live updates. Against the backend: a one-time ticket, then a Server-Sent Events stream with
 * exponential-backoff reconnects; after a gap everything visible is refetched to catch up.
 * With the automated tests' in-browser API there is no server, so changes are shared between tabs
 * of this browser only.
 */
export function useLiveUpdates(): LiveStatus {
  const dispatch = useAppDispatch();
  const token = useAppSelector((s) => s.auth.token);
  const [status, setStatus] = useState<LiveStatus>(USE_TEST_API ? 'local' : 'connecting');

  useEffect(() => {
    if (!token) return;
    const pending = new Map<string, Tag>();
    let flushTimer: ReturnType<typeof setTimeout> | undefined;
    const queue = (tags: readonly Tag[]) => {
      for (const t of tags) pending.set(JSON.stringify(t), t);
      clearTimeout(flushTimer);
      // Debounce: one request usually produces several events.
      flushTimer = setTimeout(() => {
        dispatch(api.util.invalidateTags([...pending.values()]));
        pending.clear();
      }, 250);
    };
    const everything = () => queue([...TAGS]);

    if (USE_TEST_API) {
      // Loaded lazily: the test API's database is never part of a production bundle.
      let disposed = false;
      const onStorage = (e: StorageEvent) => {
        void import('@/mock/store').then(({ MOCK_DB_STORAGE_KEY, forgetCachedDb }) => {
          if (disposed || e.key !== MOCK_DB_STORAGE_KEY) return;
          forgetCachedDb();
          everything();
        });
      };
      window.addEventListener('storage', onStorage);
      return () => {
        disposed = true;
        window.removeEventListener('storage', onStorage);
        clearTimeout(flushTimer);
      };
    }

    let source: EventSource | null = null;
    let retryMs = 1000;
    let hadConnection = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    const scheduleReconnect = () => {
      if (stopped) return;
      setStatus(navigator.onLine ? 'reconnecting' : 'offline');
      reconnectTimer = setTimeout(() => void connect(), retryMs);
      retryMs = Math.min(retryMs * 2, 30_000);
    };

    const connect = async () => {
      if (stopped) return;
      try {
        const res = await fetch(`${API_BASE_URL}/events/ticket`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
        if (res.status === 401) {
          setStatus('offline'); // the session ended; the app's own 401 handling signs the user out
          return;
        }
        if (!res.ok) throw new Error(`ticket ${res.status}`);
        const body = (await res.json()) as { data: { ticket: string } };
        if (stopped) return;
        source = new EventSource(`${API_BASE_URL}/events/stream?ticket=${encodeURIComponent(body.data.ticket)}`);
        source.addEventListener('ready', () => {
          setStatus('live');
          if (hadConnection) everything(); // catch up on anything missed while disconnected
          hadConnection = true;
          retryMs = 1000;
        });
        source.addEventListener('project', (e) => {
          try {
            queue(tagsFor(JSON.parse((e as MessageEvent<string>).data) as ProjectEvent));
          } catch {
            everything();
          }
        });
        source.addEventListener('notification', () => queue(['Notification']));
        source.onerror = () => {
          // Tickets are single-use, so let the browser's own retry go and start over with a new ticket.
          source?.close();
          source = null;
          scheduleReconnect();
        };
      } catch {
        scheduleReconnect();
      }
    };

    const onOnline = () => {
      if (!source) {
        clearTimeout(reconnectTimer);
        retryMs = 1000;
        void connect();
      }
    };
    window.addEventListener('online', onOnline);
    void connect();
    return () => {
      stopped = true;
      source?.close();
      clearTimeout(reconnectTimer);
      clearTimeout(flushTimer);
      window.removeEventListener('online', onOnline);
    };
  }, [token, dispatch]);

  return status;
}
