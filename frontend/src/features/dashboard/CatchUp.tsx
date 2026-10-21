import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useCatchUpQuery, useMarkCaughtUpMutation } from '@/api/endpoints';
import { Avatar } from '@/components/ui/Avatar';
import { timeAgo } from '@/lib/dates';
import { catchUpSentence, sinceWords } from './catchUpText';

/** How long Today has to be open before its catch-up counts as seen. */
const SEEN_AFTER_MS = 4000;

/**
 * "Since you were last here": what other people did in your projects since your last visit to
 * Today, counted from the records. A few seconds on Today (or "Got it") counts as seen, so the next
 * visit starts fresh; what's on screen stays until you leave.
 */
export function CatchUp() {
  const { data } = useCatchUpQuery(undefined, { refetchOnMountOrArgChange: true });
  const [markSeen] = useMarkCaughtUpMutation();
  const [dismissed, setDismissed] = useState(false);
  const loaded = !!data;

  useEffect(() => {
    if (!loaded) return;
    const shownAt = Date.now();
    let marked = false;
    const mark = () => {
      if (marked) return;
      marked = true;
      void markSeen();
    };
    const timer = window.setTimeout(mark, SEEN_AFTER_MS);
    return () => {
      window.clearTimeout(timer);
      // Leaving sooner still counts if it was a real look (not a render that's undone at once).
      if (Date.now() - shownAt > 1500) mark();
    };
  }, [loaded, markSeen]);

  if (!data || !data.since || dismissed) return null;
  const sentence = catchUpSentence(data);
  const when = sinceWords(data.since);

  if (!sentence) {
    return (
      <p className="text-[13.5px] text-muted" data-catch-up="empty">
        {data.capped ? 'Nothing new from your projects in the last two weeks.' : `Nothing new from your projects since you were last here ${when}.`}
      </p>
    );
  }

  return (
    <section aria-labelledby="catch-up-heading" data-catch-up="">
      <div className="flex items-baseline justify-between gap-4">
        <h2 id="catch-up-heading" className="text-[15px] font-semibold text-ink">
          {/* Counting stops two weeks back, so a long absence says so instead of naming the day. */}
          {data.capped ? (
            'In the last two weeks'
          ) : (
            <>
              Since you were last here <span className="font-normal text-muted">{when}</span>
            </>
          )}
        </h2>
        <button
          type="button"
          className="shrink-0 text-[13px] font-medium text-accent hover:underline"
          onClick={() => {
            setDismissed(true);
            void markSeen();
          }}
        >
          Got it
        </button>
      </div>
      <p className="mt-1 max-w-[70ch] text-[14px] leading-relaxed text-ink-2">{sentence}</p>
      <ul className="mt-3 divide-y divide-line border-y border-line">
        {data.latest.slice(0, 4).map((a) => (
          <li key={a.id}>
            <Link
              to={a.taskId ? `/projects/${a.projectId}/tasks/${a.taskId}` : `/projects/${a.projectId}`}
              className="group flex items-center gap-2.5 py-2 text-[13px]"
              data-kb-item=""
            >
              <Avatar user={a.actor} size="xs" />
              <span className="min-w-0 flex-1 truncate text-ink-2">
                <span className="font-medium text-ink group-hover:text-accent">{a.actor.name}</span> {a.message}
              </span>
              <span className="hidden shrink-0 text-[12px] text-muted sm:inline">{a.projectName}</span>
              <time className="w-16 shrink-0 text-right text-[12px] text-muted tabular" dateTime={a.createdAt}>
                {timeAgo(a.createdAt)}
              </time>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
