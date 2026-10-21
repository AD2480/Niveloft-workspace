import { Check, CheckCircle2, Clock, RotateCcw, Send, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router';
import type { Review } from '@/api/types';
import type { Submission } from '@/api/types';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/States';
import { formatDateTime, timeAgo } from '@/lib/dates';
import { SubmissionEvidence } from './SubmissionEvidence';
import { RichText } from '@/components/RichText';
import { cn } from '@/lib/cn';

const STATUS = {
  PENDING: { label: 'Awaiting review', tone: 'warning' as const, icon: Clock },
  APPROVED: { label: 'Approved', tone: 'success' as const, icon: CheckCircle2 },
  CHANGES_REQUESTED: { label: 'Changes requested', tone: 'warning' as const, icon: RotateCcw },
};

/** The reviewer's verdict on each acceptance criterion, as submitted. */
export function CriterionResults({ review }: { review: Review }) {
  if (review.results.length === 0) return null;
  return (
    <ul className="mt-2 space-y-1" aria-label="Acceptance criteria results">
      {review.results.map((r) => (
        <li key={r.submissionCriterionId} className="flex items-start gap-2 text-[13px]">
          {r.met ? (
            <Check className="mt-0.5 size-3.5 shrink-0 text-success" aria-label="Met" />
          ) : (
            <X className="mt-0.5 size-3.5 shrink-0 text-danger" aria-label="Not met" />
          )}
          <span className="text-ink-2">
            {r.text}
            {r.note && <span className="block text-xs text-muted">{r.note}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Full, immutable history of submissions and their reviews (newest first). */
export function SubmissionHistory({ submissions, loading }: { submissions: Submission[] | undefined; loading: boolean }) {
  const { hash } = useLocation();
  const [highlighted, setHighlighted] = useState<string | null>(null);

  // A link to one submission or review (from Flurry's "How I found this") scrolls to it and marks it for a moment.
  useEffect(() => {
    const m = /^#(submission|review)-(\d+)$/.exec(hash);
    if (!m || !submissions) return;
    const id = Number(m[2]);
    const exists = m[1] === 'submission' ? submissions.some((s) => s.id === id) : submissions.some((s) => s.review?.id === id);
    if (!exists) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.getElementById(`${m[1]}-${id}`)?.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
    setHighlighted(`${m[1]}-${id}`);
    const t = window.setTimeout(() => setHighlighted(null), 2600);
    return () => window.clearTimeout(t);
  }, [hash, submissions]);

  if (loading) return <Skeleton className="h-28 w-full" />;
  if (!submissions || submissions.length === 0) {
    return <EmptyState icon={Send} title="No submissions yet" description="When the assignee finishes, they submit the work here for review." compact />;
  }
  return (
    <ol className="space-y-4">
      {submissions.map((s) => {
        const st = STATUS[s.status];
        return (
          <li
            key={s.id}
            id={`submission-${s.id}`}
            className={cn('scroll-mt-24 overflow-hidden rounded-lg border border-line transition-shadow', highlighted === `submission-${s.id}` && 'ring-2 ring-accent/60')}
          >
            <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface-2/60 px-4 py-2">
              <span className="text-[13px] font-semibold text-ink">Version {s.version}</span>
              <Badge tone={st.tone}>
                <st.icon aria-hidden="true" />
                {st.label}
              </Badge>
              <time className="ml-auto text-xs text-muted" dateTime={s.createdAt} title={formatDateTime(s.createdAt)}>
                {timeAgo(s.createdAt)}
              </time>
            </div>
            <div className="px-4 py-3">
              <SubmissionEvidence submission={s} />
            </div>
            {s.review && (
              <div
                id={`review-${s.review.id}`}
                className={cn(
                  'scroll-mt-24 border-t border-line px-4 py-3',
                  s.review.decision === 'APPROVED' ? 'bg-success-soft/60' : 'bg-warning-soft/60',
                  highlighted === `review-${s.review.id}` && 'ring-2 ring-inset ring-accent/60',
                )}
              >
                <div className="flex items-center gap-2 text-xs text-muted">
                  <Avatar user={s.review.reviewer} size="sm" />
                  <span>
                    <span className="font-medium text-ink">{s.review.reviewer.name}</span>{' '}
                    {s.review.decision === 'APPROVED' ? 'approved this submission' : 'requested changes'}, {timeAgo(s.review.createdAt)}
                  </span>
                </div>
                {s.review.feedback && <RichText text={s.review.feedback} size="sm" className="mt-2" />}
                <CriterionResults review={s.review} />
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
