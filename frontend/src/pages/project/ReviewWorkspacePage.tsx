import { ArrowLeft, Check, CheckCircle2, CircleDashed, Clock, Info, RotateCcw, ShieldAlert, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { useReviewSubmissionMutation, useSubmissionsQuery, useTaskQuery } from '@/api/endpoints';
import { errorStatus, getErrorMessage, getFieldErrors } from '@/api/errors';
import type { ReviewDecision, Submission, SubmissionStatus } from '@/api/types';
import { StatusBadge } from '@/components/domain';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { FormError, Textarea } from '@/components/ui/Form';
import { Skeleton } from '@/components/ui/Spinner';
import { EmptyState, ErrorState } from '@/components/ui/States';
import { useCurrentUserId, useProjectContext } from '@/features/projects/projectContext';
import { AiReviewNotes } from '@/features/ai/AiPanels';
import { CriterionResults } from '@/features/tasks/SubmissionHistory';
import { SubmissionEvidence } from '@/features/tasks/SubmissionEvidence';
import { cn } from '@/lib/cn';
import { formatDateTime, timeAgo } from '@/lib/dates';
import { useDocumentTitle } from '@/lib/hooks';
import { can } from '@/lib/permissions';
import { NotFoundPage } from '../NotFoundPage';
import { useTrackedForm } from '@/lib/useTrackedForm';
import { RichText } from '@/components/RichText';

const STATUS: Record<SubmissionStatus, { label: string; tone: 'warning' | 'success' | 'danger'; icon: typeof Clock }> = {
  PENDING: { label: 'Awaiting review', tone: 'warning', icon: Clock },
  APPROVED: { label: 'Approved', tone: 'success', icon: CheckCircle2 },
  CHANGES_REQUESTED: { label: 'Changes requested', tone: 'danger', icon: RotateCcw },
};

type Verdict = { met: boolean | null; note: string };

/**
 * Review workspace: the evidence on the left, the acceptance criteria on the right,
 * every version one click away. The reviewer marks each criterion met or not met;
 * approval is only possible when all are met (the server enforces the same rule).
 */
export function ReviewWorkspacePage() {
  const { taskId } = useParams();
  const id = Number(taskId);
  const { project } = useProjectContext();
  const me = useCurrentUserId();
  const navigate = useNavigate();
  const [search, setSearch] = useSearchParams();

  const { data: task, isLoading: loadingTask, error: taskError, refetch } = useTaskQuery(id, { skip: !Number.isFinite(id) });
  const { data: submissions, isLoading: loadingSubs } = useSubmissionsQuery(id, { skip: !Number.isFinite(id) });
  const [review, reviewState] = useReviewSubmissionMutation();
  const track = useTrackedForm('review');

  const latest = submissions?.[0];
  const selectedVersion = Number(search.get('v')) || latest?.version;
  const selected = submissions?.find((s) => s.version === selectedVersion) ?? latest;
  const previous = selected ? submissions?.find((s) => s.version === selected.version - 1) : undefined;

  const [verdicts, setVerdicts] = useState<Record<number, Verdict>>({});
  const [feedback, setFeedback] = useState('');
  const [errors, setErrors] = useState<{ feedback?: string; results?: string; form?: string }>({});
  const feedbackRef = useRef<HTMLTextAreaElement>(null);

  // Reset the form whenever the pending submission changes.
  const pendingId = submissions?.find((s) => s.status === 'PENDING')?.id;
  useEffect(() => {
    setVerdicts({});
    setFeedback('');
    setErrors({});
  }, [pendingId]);

  // Arriving from a "request changes" drag on the board: focus the feedback box.
  useEffect(() => {
    if (search.get('intent') === 'changes' && pendingId) feedbackRef.current?.focus();
  }, [search, pendingId]);

  useDocumentTitle(task ? `Review ${task.key}` : 'Review');

  const counts = useMemo(() => {
    const list = selected?.criteria ?? [];
    const met = list.filter((c) => verdicts[c.id]?.met === true).length;
    const unmet = list.filter((c) => verdicts[c.id]?.met === false).length;
    return { total: list.length, met, unmet, unmarked: list.length - met - unmet };
  }, [selected, verdicts]);

  if (!Number.isFinite(id)) return <NotFoundPage />;
  if (loadingTask || loadingSubs) {
    return (
      <div className="mx-auto max-w-7xl space-y-4 px-4 py-6 sm:px-6 lg:px-10">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-8 w-1/2" />
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
          <Skeleton className="h-96" />
          <Skeleton className="h-96" />
        </div>
      </div>
    );
  }
  if (taskError || !task) {
    if (errorStatus(taskError) === 404) return <NotFoundPage title="Task not found" description="It may have been deleted." />;
    return <ErrorState error={taskError} onRetry={refetch} className="min-h-[50vh]" />;
  }
  if (task.projectId !== project.id) return <NotFoundPage title="Task not found in this project" />;

  const taskUrl = `/projects/${project.id}/tasks/${task.id}`;
  const isPending = selected?.status === 'PENDING';
  const ownWork = !!selected && selected.submittedBy.id === me;
  const canReview = !!selected && isPending && can.reviewSubmission(project.myRole, selected.submittedBy.id, me);
  const allMet = counts.total === 0 || counts.met === counts.total;

  const setVerdict = (criterionId: number, patch: Partial<Verdict>) =>
    setVerdicts((v) => ({ ...v, [criterionId]: { met: v[criterionId]?.met ?? null, note: v[criterionId]?.note ?? '', ...patch } }));

  const decide = async (decision: ReviewDecision) => {
    if (!selected) return;
    const next: typeof errors = {};
    if (decision === 'APPROVED' && counts.unmarked > 0) next.results = 'Mark every criterion before approving.';
    else if (decision === 'APPROVED' && !allMet) next.results = 'Every criterion must be met to approve. Request changes instead.';
    if (decision === 'CHANGES_REQUESTED' && feedback.trim().length < 10) next.feedback = 'Explain what needs to change (at least 10 characters).';
    setErrors(next);
    if (Object.keys(next).length > 0) {
      track.invalid();
      if (next.feedback) feedbackRef.current?.focus();
      return;
    }
    const results = selected.criteria
      .filter((c) => verdicts[c.id]?.met !== null && verdicts[c.id]?.met !== undefined)
      .map((c) => ({ submissionCriterionId: c.id, met: verdicts[c.id].met === true, note: verdicts[c.id].note.trim() || null }));
    track.submitted();
    try {
      await review({ submissionId: selected.id, taskId: task.id, projectId: project.id, decision, feedback: feedback.trim() || null, results }).unwrap();
      track.succeeded();
      toast.success(decision === 'APPROVED' ? `${task.key} approved and marked Done` : `Changes requested on ${task.key}`, {
        description: decision === 'APPROVED' ? 'The submitter has been notified.' : 'The task moved back to In progress and the submitter was notified.',
      });
      navigate(taskUrl);
    } catch (e) {
      track.failed(e);
      const fe = getFieldErrors(e);
      setErrors({ feedback: fe.feedback, results: fe.results, form: getErrorMessage(e) });
    }
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-10">
      <Link to={taskUrl} className="mb-3 inline-flex items-center gap-1 text-[13px] text-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden="true" /> Back to {task.key}
      </Link>

      <header className="flex flex-col gap-3 border-b border-line pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-semibold tracking-[-0.03em] break-words text-ink sm:text-[28px]">
            Review <span className="font-normal text-muted tabular">{task.key}</span> {task.title}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px] text-ink-2">
            <StatusBadge status={task.status} late={task.overdue} />
            {task.assignee && (
              <span className="inline-flex items-center gap-1.5">
                <Avatar user={task.assignee} size="sm" /> {task.assignee.name}
              </span>
            )}
          </div>
        </div>
        {submissions && submissions.length > 1 && (
          <nav aria-label="Submission versions" className="flex flex-wrap gap-1">
            {submissions
              .slice()
              .reverse()
              .map((s) => {
                const st = STATUS[s.status];
                const active = s.id === selected?.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() =>
                      setSearch(
                        (p) => {
                          if (s.id === latest?.id) p.delete('v');
                          else p.set('v', String(s.version));
                          return p;
                        },
                        { replace: true },
                      )
                    }
                    aria-current={active ? 'true' : undefined}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1 text-xs font-medium',
                      active ? 'border-ink bg-ink text-canvas' : 'border-line text-ink-2 hover:border-line-strong',
                    )}
                    title={`${st.label}, ${formatDateTime(s.createdAt)}`}
                  >
                    <st.icon className="size-3.5" aria-hidden="true" />v{s.version}
                  </button>
                );
              })}
          </nav>
        )}
      </header>

      {!selected ? (
        <EmptyState
          className="mt-10"
          icon={CircleDashed}
          title="Nothing to review yet"
          description={task.assignee ? `${task.assignee.name} hasn’t submitted this task.` : 'This task hasn’t been submitted.'}
          action={
            <Link to={taskUrl} className="text-[13px] font-medium text-accent hover:underline">
              Back to the task
            </Link>
          }
        />
      ) : (
        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_420px]">
          {/* Evidence ------------------------------------------------------------ */}
          <div className="min-w-0 space-y-6">
            <Card>
              <CardHeader
                title={
                  <span className="flex flex-wrap items-center gap-2">
                    Version {selected.version}
                    <Badge tone={STATUS[selected.status].tone}>
                      {(() => {
                        const Icon = STATUS[selected.status].icon;
                        return <Icon aria-hidden="true" />;
                      })()}
                      {STATUS[selected.status].label}
                    </Badge>
                  </span>
                }
                description={
                  <span className="inline-flex items-center gap-1.5">
                    <Avatar user={selected.submittedBy} size="sm" />
                    {selected.submittedBy.name} submitted it {timeAgo(selected.createdAt)}
                  </span>
                }
              />
              <CardBody>
                <SubmissionEvidence submission={selected} compact />
              </CardBody>
            </Card>

            <p className="flex items-start gap-2 text-xs text-muted">
              <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              Niveloft stores the links and files but doesn’t open, run or verify them. Check the repository and deployment yourself before marking a criterion as met.
            </p>

            {canReview && <AiReviewNotes taskId={task.id} onUseDraft={(text) => setFeedback(text)} />}

            {previous?.review && (
              <Card>
                <CardHeader title={`What was asked in version ${previous.version}`} description={`${previous.review.reviewer.name}, ${timeAgo(previous.review.createdAt)}`} />
                <CardBody>
                  {previous.review.feedback && <RichText text={previous.review.feedback} projectId={task.projectId} size="sm" />}
                  <CriterionResults review={previous.review} />
                </CardBody>
              </Card>
            )}
          </div>

          {/* Criteria and decision ----------------------------------------------- */}
          <aside className="space-y-4 lg:sticky lg:top-32 lg:self-start">
            {canReview ? (
              <ReviewForm
                submission={selected}
                verdicts={verdicts}
                setVerdict={setVerdict}
                feedback={feedback}
                setFeedback={setFeedback}
                feedbackRef={feedbackRef}
                counts={counts}
                errors={errors}
                busy={reviewState.isLoading}
                onDecide={decide}
                allMet={allMet}
              />
            ) : (
              <Card>
                <CardHeader title="Acceptance criteria" description={selected.criteria.length === 0 ? 'None were defined when this version was submitted.' : undefined} />
                <CardBody className="space-y-4">
                  {selected.review ? (
                    <>
                      <CriterionResults review={selected.review} />
                      <div className="border-t border-line pt-3 text-[13px]">
                        <p className="flex items-center gap-2 text-xs text-muted">
                          <Avatar user={selected.review.reviewer} size="sm" />
                          {selected.review.reviewer.name} {selected.review.decision === 'APPROVED' ? 'approved it' : 'requested changes'},{' '}
                          {formatDateTime(selected.review.createdAt)}
                        </p>
                        {selected.review.feedback && <RichText text={selected.review.feedback} projectId={task.projectId} size="sm" className="mt-2" />}
                      </div>
                    </>
                  ) : (
                    <>
                      <ol className="list-decimal space-y-1.5 pl-5 text-[13px] text-ink-2">
                        {selected.criteria.map((c) => (
                          <li key={c.id}>{c.text}</li>
                        ))}
                      </ol>
                      <p className="flex items-start gap-2 rounded-md bg-surface-2 px-3 py-2 text-[13px] text-ink-2">
                        <ShieldAlert className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden="true" />
                        {ownWork
                          ? 'You submitted this version, so another manager or the owner must review it.'
                          : 'Only owners and managers can review submissions. This version is waiting for one of them.'}
                      </p>
                    </>
                  )}
                </CardBody>
              </Card>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}

interface ReviewFormProps {
  submission: Submission;
  verdicts: Record<number, Verdict>;
  setVerdict: (criterionId: number, patch: Partial<Verdict>) => void;
  feedback: string;
  setFeedback: (v: string) => void;
  feedbackRef: RefObject<HTMLTextAreaElement | null>;
  counts: { total: number; met: number; unmet: number; unmarked: number };
  errors: { feedback?: string; results?: string; form?: string };
  busy: boolean;
  allMet: boolean;
  onDecide: (d: ReviewDecision) => Promise<void>;
}

function ReviewForm({ submission, verdicts, setVerdict, feedback, setFeedback, feedbackRef, counts, errors, busy, allMet, onDecide }: ReviewFormProps) {
  const canApprove = counts.unmarked === 0 && allMet;
  return (
    <Card>
      <CardHeader
        title="Your review"
        description={
          counts.total === 0
            ? 'This version has no acceptance criteria. Judge it from the notes and evidence.'
            : `${counts.met} met, ${counts.unmet} not met, ${counts.unmarked} to check`
        }
      />
      <CardBody className="space-y-5">
        <FormError message={errors.form} />
        {counts.total > 0 && (
          <fieldset>
            <legend className="sr-only">Acceptance criteria</legend>
            <ol className="space-y-3">
              {submission.criteria.map((c, i) => {
                const v = verdicts[c.id];
                const name = `criterion-${c.id}`;
                return (
                  <li key={c.id} className={cn('rounded-md border px-3 py-2.5', v?.met === false ? 'border-danger/40' : v?.met ? 'border-success/40' : 'border-line')}>
                    <p className="text-[13px] leading-snug text-ink">
                      <span className="mr-1.5 text-muted tabular">{i + 1}.</span>
                      {c.text}
                    </p>
                    <div role="radiogroup" aria-label={`Criterion ${i + 1}`} className="mt-2 flex gap-1.5">
                      {([true, false] as const).map((met) => (
                        <label
                          key={String(met)}
                          className={cn(
                            'inline-flex cursor-pointer items-center gap-1 rounded-sm border px-2 py-1 text-xs font-medium has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent',
                            v?.met === met
                              ? met
                                ? 'border-success bg-success text-white dark:text-canvas'
                                : 'border-danger bg-danger text-white dark:text-canvas'
                              : 'border-line text-ink-2 hover:border-line-strong',
                          )}
                        >
                          <input type="radio" name={name} className="sr-only" checked={v?.met === met} onChange={() => setVerdict(c.id, { met })} />
                          {met ? <Check className="size-3.5" aria-hidden="true" /> : <X className="size-3.5" aria-hidden="true" />}
                          {met ? 'Met' : 'Not met'}
                        </label>
                      ))}
                    </div>
                    {v?.met === false && (
                      <input
                        type="text"
                        aria-label={`What is missing for criterion ${i + 1}`}
                        placeholder="What’s missing? (optional)"
                        maxLength={1000}
                        value={v.note}
                        onChange={(e) => setVerdict(c.id, { note: e.target.value })}
                        className="mt-2 h-8 w-full rounded-sm border border-line bg-surface px-2 text-xs text-ink placeholder:text-muted focus:border-accent focus:outline-none"
                      />
                    )}
                  </li>
                );
              })}
            </ol>
            {errors.results && (
              <p className="mt-2 text-xs font-medium text-danger" role="alert">
                {errors.results}
              </p>
            )}
          </fieldset>
        )}

        <div className="space-y-1.5">
          <label htmlFor="review-feedback" className="block text-[13px] font-medium text-ink-2">
            Feedback <span className="font-normal text-muted">(required when requesting changes)</span>
          </label>
          <Textarea
            id="review-feedback"
            ref={feedbackRef}
            rows={4}
            value={feedback}
            maxLength={5000}
            onChange={(e) => setFeedback(e.target.value)}
            aria-invalid={!!errors.feedback}
            aria-describedby={errors.feedback ? 'review-feedback-error' : undefined}
            placeholder="What works, what needs to change, and how to verify it."
          />
          {errors.feedback && (
            <p id="review-feedback-error" className="text-xs font-medium text-danger" role="alert">
              {errors.feedback}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <Button variant="secondary" className="flex-1" leftIcon={<RotateCcw />} onClick={() => void onDecide('CHANGES_REQUESTED')} disabled={busy}>
            Request changes
          </Button>
          <Button className="flex-1" leftIcon={<CheckCircle2 />} onClick={() => void onDecide('APPROVED')} loading={busy} disabled={!canApprove}>
            Approve
          </Button>
        </div>
        {!canApprove && (
          <p className="text-xs text-muted">
            {counts.unmarked > 0 ? 'Approve unlocks when every criterion is marked met.' : 'At least one criterion isn’t met, so this version can’t be approved.'}
          </p>
        )}
      </CardBody>
    </Card>
  );
}
