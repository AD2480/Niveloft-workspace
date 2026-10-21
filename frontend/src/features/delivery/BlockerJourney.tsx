import { ArrowRight, Check, ExternalLink, MessageSquare, X } from 'lucide-react';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { useAddCommentMutation, useCommentsQuery, useJourneySummaryQuery, useRecordJourneyMutation, useSubmissionsQuery, useUpdateTaskMutation } from '@/api/endpoints';
import { getErrorMessage } from '@/api/errors';
import type { Dependency, JourneyStepName, ProjectDetail, Task, TaskRequest } from '@/api/types';
import { useAppSelector } from '@/app/store';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Textarea } from '@/components/ui/Form';
import { TaskRef } from '@/features/refs/TaskRef';
import { flurryMoment } from '@/features/flurry/flurryCues';
import { cn } from '@/lib/cn';
import { atLeast } from '@/lib/permissions';
import { chanceText } from '@/lib/forecastText';
import { STATUS_LABEL } from '@/lib/constants';
import { formatDate, timeAgo } from '@/lib/dates';
import type { ProgressForecast } from '@/lib/progressForecast';
import { plainText } from '@/lib/richText';
import { dayToIso, type ProjectModel } from '@/three/projectModel';
import type { MilestoneBlocker } from './deliveryPath';
import { blockerImpact, optionDelta, recoveryOptions, workingDelta, type BlockerImpact, type RecoveryOption } from './recovery';

/*
 * The blocker journey on the Delivery page: what's in the way, the evidence for it, what it costs
 * the deadline, and the responses worth comparing, each previewed before the person confirms it.
 * Its steps are counted (only the step and the kinds, nothing about people, tasks or text) so the
 * team can see whether it helps.
 */

const counted = new Set<string>();

/** Counts a journey step; `once` keeps a step from being counted twice in one visit. */
export function useJourneyStep(projectId: number) {
  const [record] = useRecordJourneyMutation();
  return (step: JourneyStepName, blockerKind: string | null, option?: string | null, once?: string) => {
    if (once) {
      const k = `${projectId}:${step}:${once}`;
      if (counted.has(k)) return;
      counted.add(k);
    }
    void record({ projectId, step, blockerKind, option: option ?? null })
      .unwrap()
      .catch(() => {
        /* counting is best-effort: it never gets in the way */
      });
  };
}

/** What the blocker costs, worked out after the page has drawn (a few forecasts). */
export function useBlockerImpact(model: ProjectModel | null, tasks: readonly Task[] | undefined, project: ProjectDetail, f: ProgressForecast | null, blocker: MilestoneBlocker | null): BlockerImpact | null {
  const [impact, setImpact] = useState<{ key: string; value: BlockerImpact } | null>(null);
  const key = blocker && f ? `${blocker.task.id}:${blocker.task.version}:${f.project.finish?.p50 ?? 'x'}:${tasks?.length ?? 0}` : '';
  useEffect(() => {
    if (!model || !tasks || !f || !blocker || blocker.kind === 'last') return;
    let cancelled = false;
    const t = window.setTimeout(() => {
      const value = blockerImpact(model, tasks, project.members, f, blocker);
      if (!cancelled) setImpact({ key, value });
    }, 40);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, model]);
  return impact && impact.key === key ? impact.value : null;
}

const dateOf = (model: Pick<ProjectModel, 'originMs'>, day: number) => formatDate(dayToIso(model.originMs, day), 'EEE d MMM');
const wd = (n: number) => `${Math.abs(n)} working ${Math.abs(n) === 1 ? 'day' : 'days'}`;

/** One sentence: what it would mean if the blocker were out of the way today. */
export function impactSentence(model: Pick<ProjectModel, 'originMs'>, f: ProgressForecast, impact: BlockerImpact, blocker: Pick<MilestoneBlocker, 'task'>): string {
  const now = f.project.finish?.p50;
  const done = impact.ifDone.project.finish?.p50;
  const review = blocker.task.status === 'IN_REVIEW';
  if (now === undefined || done === undefined) return '';
  if (impact.costDays === 0) {
    return review
      ? `Decided today, the likely finish stays ${dateOf(model, now)}: other work sets the date, though ${blocker.task.key} still holds up what waits on it.`
      : `Done today, the likely finish stays ${dateOf(model, now)}: other work sets the date.`;
  }
  const p0 = f.project.pDeadline;
  const p1 = impact.ifDone.project.pDeadline;
  return (
    `${review ? 'Approved today' : 'Done today'}, the likely finish would be ${dateOf(model, done)} instead of ${dateOf(model, now)}, ${wd(impact.costDays)} sooner` +
    (p0 !== null && p1 !== null ? `, and the chance of making the deadline ${chanceText(p0)} → ${chanceText(p1)}.` : '.')
  );
}

// ------------------------------------------------------------------ the evidence

/** The records behind the blocker, each linked to where it lives. */
export function BlockerEvidence({
  project,
  blocker,
  deps,
  reviewSince,
  usualReview,
  onOpen,
}: {
  project: ProjectDetail;
  blocker: MilestoneBlocker;
  deps: readonly Dependency[];
  reviewSince: string | null;
  usualReview: number;
  onOpen: () => void;
}) {
  const t = blocker.task;
  const [open, setOpen] = useState(false);
  const subs = useSubmissionsQuery(t.id, { skip: !open });
  const comments = useCommentsQuery(t.id, { skip: !open });
  const base = `/projects/${project.id}/tasks/${t.id}`;
  const latest = subs.data?.length ? [...subs.data].sort((a, b) => b.version - a.version)[0] : null;
  const lastReview = subs.data?.filter((s) => s.review).sort((a, b) => b.version - a.version)[0]?.review ?? null;
  const lastComment = comments.data?.length ? comments.data[comments.data.length - 1] : null;
  const waitsOn = deps.filter((d) => d.blocked.id === t.id && d.blocker.status !== 'DONE');
  const reviewDays = reviewSince ? Math.max(0, Math.round((Date.now() - new Date(`${reviewSince}T12:00:00`).getTime()) / 86_400_000)) : null;

  return (
    <details
      className="group rounded-lg border border-line"
      onToggle={(e) => {
        const o = (e.target as HTMLDetailsElement).open;
        setOpen(o);
        if (o) onOpen();
      }}
      data-blocker-evidence=""
    >
      <summary className="cursor-pointer list-none px-3 py-2 text-[13px] font-medium text-ink hover:text-accent">
        <span className="flex items-center justify-between gap-2">
          The evidence
          <ArrowRight className="size-3.5 text-muted transition-transform group-open:rotate-90" aria-hidden="true" />
        </span>
      </summary>
      <ul className="space-y-2 border-t border-line px-3 py-2.5 text-[12.5px] leading-snug text-ink-2">
        <li>
          {t.status === 'IN_REVIEW' && reviewSince
            ? `Waiting for review since ${formatDate(reviewSince, 'EEE d MMM')}${reviewDays !== null ? ` (${reviewDays === 1 ? '1 day' : `${reviewDays} days`})` : ''}. Reviews here usually take about ${Math.max(1, Math.round(usualReview))} ${Math.round(usualReview) <= 1 ? 'day' : 'days'}.`
            : `${STATUS_LABEL[t.status]}${t.startedAt ? ` since ${formatDate(t.startedAt.slice(0, 10), 'EEE d MMM')}` : ''}${t.estimateDays ? `, estimated at ${wd(t.estimateDays)}` : ', with no estimate'}${t.assignee ? `, owned by ${t.assignee.name}` : ', with no owner'}.`}
        </li>
        {blocker.holdsUp.length > 0 && (
          <li>
            Holds up{' '}
            {blocker.holdsUp.slice(0, 6).map((x, i) => (
              <Fragment key={x.id}>
                {i > 0 && ', '}
                <TaskRef taskKey={x.key} />
              </Fragment>
            ))}
            {blocker.holdsUp.length > 6 && ` and ${blocker.holdsUp.length - 6} more`}.
          </li>
        )}
        {waitsOn.length > 0 && (
          <li>
            Itself waits on{' '}
            {waitsOn.map((d, i) => (
              <Fragment key={d.id}>
                {i > 0 && ', '}
                <TaskRef taskKey={d.blocker.key} /> ({STATUS_LABEL[d.blocker.status].toLowerCase()})
              </Fragment>
            ))}
            .
          </li>
        )}
        {subs.isLoading || comments.isLoading ? (
          <li className="text-muted">Reading the submissions and comments…</li>
        ) : (
          <>
            {latest && (
              <li>
                <Link to={`${base}#submission-${latest.id}`} className="text-accent hover:underline">
                  Version {latest.version}
                </Link>{' '}
                submitted by {latest.submittedBy.name}, {timeAgo(latest.createdAt)}
                {latest.evidence.length > 0 && ` with ${latest.evidence.length === 1 ? 'one piece' : `${latest.evidence.length} pieces`} of evidence (not opened here)`}.
              </li>
            )}
            {lastReview && (
              <li>
                <Link to={`${base}#review-${lastReview.id}`} className="text-accent hover:underline">
                  {lastReview.decision === 'APPROVED' ? 'Approved' : 'Changes requested'}
                </Link>{' '}
                by {lastReview.reviewer.name}, {timeAgo(lastReview.createdAt)}.
              </li>
            )}
            {lastComment && (
              <li>
                <Link to={`${base}#comment-${lastComment.id}`} className="text-accent hover:underline">
                  Latest comment
                </Link>{' '}
                by {lastComment.author.name}, {timeAgo(lastComment.createdAt)}: “{plainText(lastComment.body).slice(0, 90)}
                {plainText(lastComment.body).length > 90 ? '…' : ''}”
              </li>
            )}
            {open && !latest && !lastComment && <li className="text-muted">No submissions or comments on it yet.</li>}
          </>
        )}
        <li className="text-muted">From the records. Why it’s where it is isn’t known unless someone wrote it down.</li>
      </ul>
    </details>
  );
}

// ------------------------------------------------------------------ ways forward

function taskBody(t: Task, patch: Partial<TaskRequest>): TaskRequest {
  return {
    title: t.title,
    description: t.description,
    priority: t.priority,
    assigneeId: t.assignee?.id ?? null,
    dueDate: t.dueDate,
    milestoneId: t.milestoneId,
    estimateDays: t.estimateDays,
    version: t.version,
    ...patch,
  };
}

/**
 * Ways forward for one blocker, compared side by side against the forecast as it is, each one
 * previewed before anything changes. The person confirms; nothing is applied for them.
 */
export function RecoveryPanel({
  project,
  model,
  tasks,
  f,
  blocker,
  impact,
  submitterId,
  reviewSince,
  onClose,
}: {
  project: ProjectDetail;
  model: ProjectModel;
  tasks: Task[];
  f: ProgressForecast;
  blocker: MilestoneBlocker;
  impact: BlockerImpact | null;
  submitterId: number | null;
  reviewSince: string | null;
  onClose: (confirmed: boolean) => void;
}) {
  const me = useAppSelector((s) => s.auth.user?.id ?? 0);
  const step = useJourneyStep(project.id);
  const navigate = useNavigate();
  const [options, setOptions] = useState<RecoveryOption[] | null>(null);
  const [preview, setPreview] = useState<RecoveryOption | null>(null);
  const confirmed = useRef(false);
  const manager = atLeast(project.myRole, 'MANAGER');
  const summary = useJourneySummaryQuery({ projectId: project.id, days: 30 }, { skip: !manager });

  useEffect(() => {
    step('impact', blocker.kind, null, `${blocker.task.id}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocker.task.id]);

  useEffect(() => {
    if (!impact) return;
    let cancelled = false;
    const t = window.setTimeout(() => {
      const list = recoveryOptions({
        projectId: project.id,
        model,
        tasks,
        members: project.members,
        forecast: f,
        blocker,
        impact,
        me: { id: me, role: project.myRole },
        submitterId,
        inReviewSince: reviewSince ? formatDate(reviewSince, 'EEE d MMM') : null,
      });
      if (!cancelled) setOptions(list);
    }, 30);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [impact, blocker.task.id, blocker.task.version, me]);

  const close = () => {
    if (!confirmed.current) step('dismissed', blocker.kind);
    onClose(confirmed.current);
  };
  const now = f.project.finish;
  const t = blocker.task;

  return (
    <section className="rounded-xl border border-accent/40 bg-surface" aria-labelledby="ways-forward-title" data-ways-forward={t.key}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <h2 id="ways-forward-title" className="text-[16px] font-semibold text-ink">
            Ways forward for {t.key}
          </h2>
          <p className="mt-0.5 max-w-2xl text-[12.5px] text-muted" data-ways-forward-cost="">
            {impact ? impactSentence(model, f, impact, blocker) : 'Working out what it costs…'}
            {impact?.waitDays ? ` If it waits another week, the likely finish moves ${wd(impact.waitDays)} later.` : ''}
          </p>
        </div>
        <Button variant="ghost" size="sm" leftIcon={<X />} onClick={close} data-ways-forward-close="">
          Close
        </Button>
      </div>
      {/* relative: the header's screen-reader-only label is absolutely positioned, and without a
          containing block here it escapes the scroll box and widens the page on a phone. */}
      <div className="relative overflow-x-auto px-4 py-3">
        {!options ? (
          <p className="py-2 text-[13px] text-muted">Comparing the responses…</p>
        ) : options.length === 0 ? (
          <p className="py-2 text-[13px] text-muted">No response here would change the forecast. Open the task to see what it needs.</p>
        ) : (
          <table className="w-full min-w-[560px] text-left text-[13px]" data-ways-forward-table="">
            <caption className="sr-only">Responses compared with the forecast as it is</caption>
            <thead>
              <tr className="border-b border-line text-[12px] text-muted">
                <th scope="col" className="py-2 pr-3 font-medium">Response</th>
                <th scope="col" className="py-2 pr-3 font-medium">Likely finish</th>
                <th scope="col" className="py-2 pr-3 font-medium">Against now</th>
                <th scope="col" className="py-2 pr-3 font-medium">On time</th>
                <th scope="col" className="py-2 font-medium">
                  <span className="sr-only">Preview</span>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-line text-muted" data-option="now">
                <td className="py-2 pr-3">As things stand</td>
                <td className="py-2 pr-3 tabular-nums">{now ? dateOf(model, now.p50) : 'Done'}</td>
                <td className="py-2 pr-3">—</td>
                <td className="py-2 pr-3 tabular-nums">{f.project.pDeadline !== null ? chanceText(f.project.pDeadline) : '–'}</td>
                <td />
              </tr>
              {options.map((o) => {
                const delta = optionDelta(model, f, o);
                const fin = o.forecast?.project.finish;
                return (
                  <tr key={o.id} className="border-b border-line last:border-b-0" data-option={o.id}>
                    <td className="py-2 pr-3">
                      <span className="text-ink">{o.title}</span>
                      {o.kind === 'review-now' && <span className="block text-[12px] text-muted">If it’s approved</span>}
                    </td>
                    <td className="py-2 pr-3 tabular-nums">{o.forecast ? (fin ? dateOf(model, fin.p50) : 'Done') : <span className="text-muted">As now</span>}</td>
                    <td className={cn('py-2 pr-3 tabular-nums', delta !== null && delta < 0 ? 'text-success' : delta !== null && delta > 0 ? 'text-warning' : 'text-muted')}>
                      {delta === null ? 'asks for what isn’t recorded' : delta === 0 ? 'no change' : `${wd(delta)} ${delta < 0 ? 'sooner' : 'later'}`}
                    </td>
                    <td className="py-2 pr-3 tabular-nums">{o.forecast && o.forecast.project.pDeadline !== null ? chanceText(o.forecast.project.pDeadline) : <span className="text-muted">–</span>}</td>
                    <td className="py-2 text-right">
                      <Button
                        variant="outline"
                        size="xs"
                        onClick={() => {
                          step('previewed', blocker.kind, o.kind, `${t.id}:${o.id}`);
                          setPreview(o);
                        }}
                        data-option-preview={o.id}
                      >
                        Preview
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <p className="mt-2 text-[12px] leading-relaxed text-muted">
          Each line is the same forecast with one response: same records, same random draws. Nothing changes until you confirm it, and Flurry never assigns, re-estimates or reviews work by itself.
        </p>
        {manager && summary.data && (
          <p className="mt-1 text-[12px] text-muted" data-journey-summary="">
            In the last {summary.data.days} days here: blockers looked at {summary.data.steps.shown ?? 0} times, evidence opened {summary.data.steps.evidence ?? 0}, ways forward {summary.data.steps.impact ?? 0}, responses previewed{' '}
            {summary.data.steps.previewed ?? 0} and confirmed {summary.data.steps.confirmed ?? 0}.
          </p>
        )}
      </div>
      {preview && (
        <ConfirmResponse
          project={project}
          option={preview}
          task={t}
          model={model}
          f={f}
          onDone={(ok) => {
            setPreview(null);
            if (ok) {
              confirmed.current = true;
              step('confirmed', blocker.kind, preview.kind);
              if (preview.action.type === 'open') navigate(preview.action.to);
              else onClose(true);
            }
          }}
        />
      )}
    </section>
  );
}

/** The exact change a response makes, for the person to confirm (or edit, for a message). */
function ConfirmResponse({ project, option, task, model, f, onDone }: { project: ProjectDetail; option: RecoveryOption; task: Task; model: ProjectModel; f: ProgressForecast; onDone: (confirmed: boolean) => void }) {
  const [update] = useUpdateTaskMutation();
  const [comment] = useAddCommentMutation();
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState(option.action.type === 'comment' ? option.action.text : '');
  const a = option.action;
  const delta = optionDelta(model, f, option);
  const fin = option.forecast?.project.finish;

  const apply = async () => {
    if (a.type === 'open') return onDone(true);
    setBusy(true);
    try {
      if (a.type === 'comment') {
        await comment({ taskId: a.taskId, projectId: project.id, body: text.trim() }).unwrap();
        toast.success('Comment posted. The people it mentions are notified.');
      } else if (a.type === 'estimate') {
        const after = await update({ id: task.id, projectId: project.id, body: taskBody(task, { estimateDays: a.days }) }).unwrap();
        toast.success(`${task.key}’s estimate is now ${a.days} working days.`, {
          action: { label: 'Undo', onClick: () => void update({ id: after.id, projectId: project.id, body: taskBody(after, { estimateDays: a.from }) }).unwrap().then(() => toast.success('Estimate put back.'), (e) => toast.error(getErrorMessage(e))) },
        });
      } else {
        const after = await update({ id: task.id, projectId: project.id, body: taskBody(task, { assigneeId: a.user.id }) }).unwrap();
        toast.success(`${task.key} is now ${a.user.name}’s.`, {
          action: { label: 'Undo', onClick: () => void update({ id: after.id, projectId: project.id, body: taskBody(after, { assigneeId: a.from?.id ?? null }) }).unwrap().then(() => toast.success('Owner put back.'), (e) => toast.error(getErrorMessage(e))) },
        });
      }
      flurryMoment({ kind: 'happy' });
      onDone(true);
    } catch (e) {
      toast.error(`Nothing changed: ${getErrorMessage(e)}`);
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !busy && onDone(false)}
      title={option.title}
      description={option.detail}
      footer={
        <>
          <Button variant="secondary" onClick={() => onDone(false)} disabled={busy}>
            Not now
          </Button>
          <Button onClick={() => void apply()} loading={busy} disabled={!!option.blockedReason || (a.type === 'comment' && !text.trim())} leftIcon={a.type === 'comment' ? <MessageSquare /> : a.type === 'open' ? <ExternalLink /> : <Check />} data-option-confirm={option.id}>
            {a.type === 'comment' ? 'Post the comment' : a.type === 'open' ? 'Open the review' : a.type === 'estimate' ? 'Change the estimate' : 'Change the owner'}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-[13px]" data-option-dialog={option.id}>
        {a.type === 'estimate' && (
          <p className="rounded-lg border border-line px-3 py-2">
            <span className="font-medium tabular">{task.key}</span> estimate: {a.from ?? 'none'} → <strong>{a.days}</strong> working days
          </p>
        )}
        {a.type === 'assign' && (
          <p className="rounded-lg border border-line px-3 py-2">
            <span className="font-medium tabular">{task.key}</span> owner: {a.from?.name ?? 'nobody'} → <strong>{a.user.name}</strong>
          </p>
        )}
        {a.type === 'comment' && (
          <label className="block">
            <span className="text-[12.5px] font-medium text-muted">The comment, as it will be posted on {task.key}</span>
            <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} className="mt-1" maxLength={5000} data-option-comment="" />
          </label>
        )}
        <p className="text-ink-2">
          {option.forecast
            ? `Forecast with this: likely ${fin ? dateOf(model, fin.p50) : 'done'}${delta !== null && delta !== 0 ? `, ${wd(delta)} ${delta < 0 ? 'sooner' : 'later'} than now` : ', the same as now'}.`
            : 'This doesn’t change the forecast by itself: it asks for what the records don’t show.'}
        </p>
        {option.blockedReason && <p className="text-danger">{option.blockedReason}</p>}
      </div>
    </Dialog>
  );
}

/** For Flurry's note beside the blocker: the cost in a few words ("costing about 3 working days"). */
export function costWords(impact: BlockerImpact | null): string {
  if (!impact || impact.costDays <= 0) return '';
  return `costing about ${wd(impact.costDays)}`;
}

/** Days between two model days, for callers outside this file. */
export { workingDelta };

/** The submitter of a task's latest submission, for the reviewer rule (a person can't approve their own work). */
export function useSubmitter(taskId: number | null): number | null {
  const subs = useSubmissionsQuery(taskId ?? 0, { skip: taskId === null });
  return useMemo(() => {
    if (!subs.data?.length) return null;
    return [...subs.data].sort((a, b) => b.version - a.version)[0].submittedBy.id;
  }, [subs.data]);
}
