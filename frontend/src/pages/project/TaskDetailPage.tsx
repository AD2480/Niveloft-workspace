import {
  AlertTriangle,
  ArrowLeft,
  Clock,
  ClipboardCheck,
  Link as LinkIcon,
  MoreHorizontal,
  Pencil,
  Play,
  RotateCcw,
  Send,
  Trash2,
  Undo2,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import {
  useChangeTaskStatusMutation,
  useDeleteTaskMutation,
  useMilestonesQuery,
  useSubmissionsQuery,
  useTaskActivityQuery,
  useTaskQuery,
  useUpdateTaskMutation,
} from '@/api/endpoints';
import { errorStatus, getErrorMessage, isEditConflict } from '@/api/errors';
import type { Task, TaskRequest, TaskStatus } from '@/api/types';
import { DueDate, PriorityIcon, StatusBadge } from '@/components/domain';
import { StatusGlyph } from '@/components/glyphs';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { CopyButton, copyText } from '@/components/ui/CopyButton';
import { Card, CardBody, CardHeader, DocumentSections } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { Input, Select } from '@/components/ui/Form';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '@/components/ui/Menu';
import { Segmented } from '@/components/ui/Segmented';
import { Skeleton } from '@/components/ui/Spinner';
import { ErrorState } from '@/components/ui/States';
import { ActivityList } from '@/features/activity/ActivityList';
import { useCurrentUserId, useProjectContext } from '@/features/projects/projectContext';
import { CommentsPanel } from '@/features/tasks/CommentsPanel';
import { CriterionResults, SubmissionHistory } from '@/features/tasks/SubmissionHistory';
import { SubmitWorkDialog } from '@/features/tasks/SubmitWorkDialog';
import { TaskCriteriaCard } from '@/features/tasks/TaskCriteriaCard';
import { TaskDependenciesCard } from '@/features/dependencies/TaskDependenciesCard';
import { TaskFormDialog } from '@/features/tasks/TaskFormDialog';
import { WorkflowStepper } from '@/features/tasks/WorkflowStepper';
import { PRIORITIES, PRIORITY_LABEL, STATUS_LABEL } from '@/lib/constants';
import { formatDateTime, timeAgo } from '@/lib/dates';
import { useDocumentTitle } from '@/lib/hooks';
import { atLeast, can } from '@/lib/permissions';
import { NotFoundPage } from '../NotFoundPage';
import { RichText } from '@/components/RichText';
import { TaskBacklinks } from '@/features/refs/TaskBacklinks';

function toRequest(t: Task, patch: Partial<TaskRequest>): TaskRequest {
  return {
    title: t.title,
    description: t.description,
    priority: t.priority,
    assigneeId: t.assignee?.id ?? null,
    dueDate: t.dueDate,
    milestoneId: t.milestoneId,
    estimateDays: t.estimateDays,
    // Optimistic locking: the server rejects the save if someone changed the task since we loaded it.
    version: t.version,
    ...patch,
  };
}

/** One property beside the document: a label and a value that, when you can edit it, is a quiet control. */
function Property({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid min-h-9 grid-cols-[84px_minmax(0,1fr)] items-center gap-2">
      <dt className="text-[12.5px] text-muted">{label}</dt>
      <dd className="min-w-0 text-[13px] text-ink">{children}</dd>
    </div>
  );
}

/** A read-only value lined up with the text inside the quiet controls. */
function Value({ children }: { children: ReactNode }) {
  return <span className="flex min-h-8 items-center gap-2 pl-3">{children}</span>;
}

interface TaskDetailViewProps {
  taskId: number;
  /** "page" = full route; "panel" = side panel over the board. */
  variant?: 'page' | 'panel';
  /** Extra header actions (the panel passes "open full page" and "close"). */
  headerExtra?: ReactNode;
  /** Called after the task is deleted (the panel closes itself). */
  onDeleted?: () => void;
}

export function TaskDetailPage() {
  const { taskId } = useParams();
  return <TaskDetailView taskId={Number(taskId)} />;
}

/** Full task view; rendered as a page or inside the board's side panel. */
export function TaskDetailView({ taskId, variant = 'page', headerExtra, onDeleted }: TaskDetailViewProps) {
  const id = taskId;
  const panel = variant === 'panel';
  const { project } = useProjectContext();
  const me = useCurrentUserId();
  const navigate = useNavigate();
  const role = project.myRole;

  const { data: task, isLoading, isError, error, refetch } = useTaskQuery(id, { skip: !Number.isFinite(id) });
  const { data: submissions, isLoading: loadingSubs } = useSubmissionsQuery(id, { skip: !Number.isFinite(id) });
  const { data: activity } = useTaskActivityQuery(id, { skip: !Number.isFinite(id) });
  const { data: milestones } = useMilestonesQuery(project.id);
  const [updateTask, updateState] = useUpdateTaskMutation();
  const [changeStatus, statusState] = useChangeTaskStatusMutation();
  const [deleteTask, deleteState] = useDeleteTaskMutation();

  const [editing, setEditing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [tab, setTab] = useState<'comments' | 'activity'>('comments');
  useDocumentTitle(task ? `${task.key} ${task.title}` : undefined);

  if (!Number.isFinite(id)) return <NotFoundPage />;
  if (isLoading) {
    return (
      <div className={panel ? 'space-y-4 px-5 py-6' : 'mx-auto max-w-6xl space-y-4 px-4 py-6 sm:px-6 lg:px-10'}>
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-8 w-2/3" />
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <Skeleton className="h-96" />
          <Skeleton className="h-72" />
        </div>
      </div>
    );
  }
  if (isError || !task) {
    if (errorStatus(error) === 404) return <NotFoundPage title="Task not found" description="It may have been deleted." />;
    return <ErrorState error={error} onRetry={refetch} className="min-h-[50vh]" />;
  }
  if (task.projectId !== project.id) {
    return <NotFoundPage title="Task not found in this project" />;
  }

  const tl = { status: task.status, assigneeId: task.assignee?.id ?? null, reporterId: task.reporter.id };
  const canEdit = can.editTask(role, tl, me) && project.status !== 'ARCHIVED';
  const canDelete = can.deleteTask(role, tl, me);
  const pending = submissions?.find((s) => s.status === 'PENDING');
  const lastReview = submissions?.find((s) => s.review)?.review ?? null;
  const canReview = !!pending && can.reviewSubmission(role, pending.submittedBy.id, me);
  const canSubmit = can.submitWork(role, tl, me);
  const busy = updateState.isLoading || statusState.isLoading;

  const patch = async (p: Partial<TaskRequest>, success = 'Task updated') => {
    try {
      await updateTask({ id: task.id, projectId: project.id, body: toRequest(task, p) }).unwrap();
      toast.success(success);
    } catch (e) {
      if (isEditConflict(e)) {
        toast.error('Someone else just changed this task.', {
          description: 'Your change wasn’t saved. Reload to see the latest version, then try again.',
          action: { label: 'Reload', onClick: () => void refetch() },
        });
      } else {
        toast.error(getErrorMessage(e));
      }
    }
  };

  const move = async (status: TaskStatus) => {
    try {
      await changeStatus({ id: task.id, projectId: project.id, status }).unwrap();
      toast.success(task.status === 'DONE' ? `${task.key} reopened` : `Moved to ${STATUS_LABEL[status]}`);
    } catch (e) {
      toast.error(getErrorMessage(e));
    }
  };

  // Primary workflow action for the current user.
  let workflow: ReactNode = null;
  if (task.status === 'TODO' && can.changeStatus(role, tl, me, 'IN_PROGRESS')) {
    workflow = (
      <Button leftIcon={<Play />} onClick={() => void move('IN_PROGRESS')} loading={statusState.isLoading}>
        Start work
      </Button>
    );
  }
  if (task.status === 'IN_PROGRESS' && canSubmit) {
    workflow = (
      <Button leftIcon={<Send />} onClick={() => setSubmitting(true)}>
        Submit for review
      </Button>
    );
  }
  if (task.status === 'IN_REVIEW' && canReview) {
    workflow = (
      <Button leftIcon={<ClipboardCheck />} onClick={() => navigate(`/projects/${project.id}/tasks/${task.id}/review`)}>
        Open review
      </Button>
    );
  }
  if (task.status === 'DONE' && atLeast(role, 'MANAGER')) {
    workflow = (
      <Button variant="secondary" leftIcon={<Undo2 />} onClick={() => void move('IN_PROGRESS')} loading={statusState.isLoading}>
        Reopen
      </Button>
    );
  }

  let workflowNote: ReactNode;
  switch (task.status) {
    case 'TODO':
      workflowNote = task.assignee
        ? task.assignee.id === me
          ? 'This is yours: start it when you begin the work.'
          : `Waiting for ${task.assignee.name} (the assignee) to start.${atLeast(role, 'MANAGER') ? ' As a manager you can also start it or reassign it.' : ''}`
        : atLeast(role, 'MANAGER')
          ? 'Not assigned yet: assign it to someone so they can work on it.'
          : 'Not assigned yet. You can take it yourself from Assignee.';
      break;
    case 'IN_PROGRESS':
      workflowNote =
        task.assignee?.id === me
          ? 'Submit your work for review when it’s complete. Someone else (a manager or the owner) will review it.'
          : `${task.assignee?.name ?? 'The assignee'} is working on this. Only the assignee submits it for review${atLeast(role, 'MANAGER') ? '; you can review it once they do' : ''}.`;
      break;
    case 'IN_REVIEW':
      workflowNote = pending
        ? pending.submittedBy.id === me
          ? 'Your submission is waiting for a manager’s review.'
          : canReview
            ? `${pending.submittedBy.name} submitted this for your review.`
            : `Waiting for a manager to review ${pending.submittedBy.name}’s submission.`
        : 'Awaiting review.';
      break;
    case 'DONE':
      workflowNote = task.completedAt ? `Approved and completed ${timeAgo(task.completedAt)}.` : 'Completed.';
      break;
  }

  const changesRequested = task.status === 'IN_PROGRESS' && lastReview?.decision === 'CHANGES_REQUESTED' && submissions?.[0]?.status === 'CHANGES_REQUESTED';

  const properties = (
    <dl className="space-y-0.5" data-task-properties="">
      <Property label="Status">
        <Value>
          <StatusBadge status={task.status} late={task.overdue} />
        </Value>
      </Property>
      <Property label="Assignee">
        {canEdit && (atLeast(role, 'MANAGER') || !task.assignee || task.assignee.id === me) ? (
          <Select
            quiet
            aria-label="Assignee"
            value={task.assignee?.id ?? ''}
            disabled={busy}
            onChange={(e) => void patch({ assigneeId: e.target.value ? Number(e.target.value) : null }, 'Assignee updated')}
          >
            <option value="">Unassigned</option>
            {project.members
              .filter((m) => m.role !== 'VIEWER' && (atLeast(role, 'MANAGER') || m.user.id === me || m.user.id === task.assignee?.id))
              .map((m) => (
                <option key={m.user.id} value={m.user.id}>
                  {m.user.name}
                  {m.user.id === me ? ' (you)' : ''}
                </option>
              ))}
          </Select>
        ) : (
          <Value>
            <Avatar user={task.assignee} size="xs" />
            {task.assignee?.name ?? <span className="text-muted">Unassigned</span>}
          </Value>
        )}
      </Property>
      <Property label="Priority">
        {canEdit ? (
          <Select quiet aria-label="Priority" value={task.priority} disabled={busy} onChange={(e) => void patch({ priority: e.target.value as Task['priority'] }, 'Priority updated')}>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABEL[p]}
              </option>
            ))}
          </Select>
        ) : (
          <Value>
            <PriorityIcon priority={task.priority} /> {PRIORITY_LABEL[task.priority]}
          </Value>
        )}
      </Property>
      <Property label="Due">
        {canEdit ? (
          <Input
            quiet
            type="date"
            aria-label="Due date"
            defaultValue={task.dueDate ?? ''}
            key={task.dueDate ?? 'none'}
            disabled={busy}
            onBlur={(e) => {
              const v = e.target.value || null;
              if (v !== task.dueDate) void patch({ dueDate: v }, v ? 'Due date updated' : 'Due date removed');
            }}
            className={task.overdue ? 'text-danger' : undefined}
          />
        ) : (
          <Value>
            <DueDate date={task.dueDate} done={task.status === 'DONE'} />
          </Value>
        )}
      </Property>
      <Property label="Estimate">
        {canEdit ? (
          <span className="flex items-center gap-1.5">
            <Input
              quiet
              type="number"
              min={1}
              max={250}
              aria-label="Estimate in working days"
              placeholder="Not estimated"
              defaultValue={task.estimateDays ?? ''}
              key={`est-${task.estimateDays ?? 'none'}`}
              disabled={busy}
              // As wide as the number (where the browser can size a field to its content), so the unit sits beside it.
              className={cn(
                // No spin buttons: the number is typed, and the unit sits right beside it.
                '[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none',
                task.estimateDays && 'w-14 min-w-7 pr-1 [field-sizing:content] supports-[field-sizing:content]:w-auto',
              )}
              onBlur={(e) => {
                const raw = e.target.value.trim();
                const v = raw === '' ? null : Math.round(Number(raw));
                if (v !== null && (!Number.isFinite(v) || v < 1 || v > 250)) {
                  toast.error('Enter whole working days between 1 and 250, or leave it empty.');
                  e.target.value = task.estimateDays === null ? '' : String(task.estimateDays); // put the saved value back
                  return;
                }
                if (v !== task.estimateDays) void patch({ estimateDays: v }, v ? 'Estimate updated' : 'Estimate removed');
              }}
            />
            {task.estimateDays !== null && <span className="-ml-0.5 shrink-0 text-[12.5px] text-muted">working {task.estimateDays === 1 ? 'day' : 'days'}</span>}
          </span>
        ) : (
          <Value>{task.estimateDays ? `${task.estimateDays} working ${task.estimateDays === 1 ? 'day' : 'days'}` : <span className="text-muted">Not estimated</span>}</Value>
        )}
      </Property>
      <Property label="Milestone">
        {canEdit ? (
          <Select quiet aria-label="Milestone" value={task.milestoneId ?? ''} disabled={busy} onChange={(e) => void patch({ milestoneId: e.target.value ? Number(e.target.value) : null }, 'Milestone updated')}>
            <option value="">None</option>
            {(milestones ?? []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
        ) : (
          <Value>{task.milestoneName ?? <span className="text-muted">None</span>}</Value>
        )}
      </Property>
      <Property label="Reporter">
        <Value>
          <Avatar user={task.reporter} size="xs" />
          <span className="truncate">{task.reporter.name}</span>
        </Value>
      </Property>
    </dl>
  );

  return (
    <div className={panel ? 'px-5 py-5' : 'mx-auto max-w-6xl px-4 py-5 sm:px-6 lg:px-10'}>
      {!panel && (
        <Link to={`/projects/${project.id}/board`} className="mb-4 inline-flex items-center gap-1 text-[13px] text-muted hover:text-ink">
          <ArrowLeft className="size-4" aria-hidden="true" /> Back to board
        </Link>
      )}

      {/*
        The task reads as a document: where it stands, what it is, what done means, what's in the way,
        the record. The properties sit beside it on wide screens and right under its head on narrow
        ones (and in the side panel), where who and when matter most at a glance.
      */}
      <div className={cn('grid gap-x-12', !panel && 'lg:grid-cols-[minmax(0,1fr)_280px] lg:grid-rows-[auto_1fr]')} data-task-document="">
        <header className={cn('min-w-0', !panel && 'lg:col-start-1 lg:row-start-1')}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-1.5 text-[13px] text-muted">
              <StatusGlyph status={task.status} late={task.overdue} />
              <span className="tabular">{task.key}</span>
              <CopyButton text={task.key} what={`the task key ${task.key}`} iconOnly className="-my-1 text-muted" />
              {task.overdue && (
                <span className="ml-1 inline-flex items-center gap-1 text-xs font-medium text-danger">
                  <AlertTriangle className="size-3.5" aria-hidden="true" /> Overdue
                </span>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {canEdit && (
                <Button variant="ghost" size="sm" leftIcon={<Pencil />} onClick={() => setEditing(true)}>
                  Edit
                </Button>
              )}
              <Menu>
                <MenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm" aria-label="More actions">
                    <MoreHorizontal />
                  </Button>
                </MenuTrigger>
                <MenuContent>
                  <MenuItem
                    icon={<LinkIcon />}
                    onSelect={() => {
                      void copyText(`${window.location.origin}/projects/${project.id}/tasks/${task.id}`).then((ok) =>
                        ok ? toast.success('Link copied') : toast.error('Couldn’t copy the link. Copy it from the address bar instead.'),
                      );
                    }}
                  >
                    Copy link
                  </MenuItem>
                  {task.status === 'IN_PROGRESS' && can.changeStatus(role, tl, me, 'TODO') && (
                    <MenuItem icon={<Undo2 />} onSelect={() => void move('TODO')}>
                      Move back to To do
                    </MenuItem>
                  )}
                  {canDelete && (
                    <>
                      <MenuSeparator />
                      <MenuItem icon={<Trash2 />} danger onSelect={() => setConfirmDelete(true)}>
                        Delete task
                      </MenuItem>
                    </>
                  )}
                </MenuContent>
              </Menu>
              {headerExtra}
            </div>
          </div>
          <h1 className={cn('mt-2 font-display font-semibold tracking-[-0.03em] break-words text-ink', panel ? 'text-xl' : 'text-[26px] leading-tight sm:text-[30px]')}>{task.title}</h1>

          {/* Where it stands, and the one thing to do next. */}
          <div className="mt-5 rounded-lg bg-surface-2 px-4 py-3.5 dark:bg-surface-2/70" data-task-standing="">
            <WorkflowStepper status={task.status} />
            <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="flex items-start gap-2 text-[13px] leading-relaxed text-ink-2">
                <Clock className="mt-[3px] size-3.5 shrink-0 text-muted" aria-hidden="true" />
                {workflowNote}
              </p>
              {workflow && <div className="shrink-0">{workflow}</div>}
            </div>
            {changesRequested && lastReview && (
              <div className="mt-3 border-t border-line pt-3" role="note">
                <p className="flex items-center gap-2 text-[13px] font-semibold text-warning">
                  <RotateCcw className="size-4" aria-hidden="true" /> {lastReview.reviewer.name} requested changes
                </p>
                {lastReview.feedback && <RichText text={lastReview.feedback} projectId={task.projectId} size="sm" className="mt-1" />}
                {lastReview.results.some((r) => !r.met) && <CriterionResults review={{ ...lastReview, results: lastReview.results.filter((r) => !r.met) }} />}
              </div>
            )}
          </div>

        </header>

        <aside
          className={cn(
            'mt-5 border-y border-line py-3',
            !panel && 'lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:mt-0 lg:self-start lg:border-y-0 lg:border-l lg:py-0 lg:pl-8 lg:sticky lg:top-28',
          )}
          aria-label="Properties"
        >
          {properties}
          <dl className={cn('mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted', !panel && 'lg:mt-5 lg:block lg:space-y-1 lg:border-t lg:border-line lg:pt-4')}>
            <div>
              <dt className="inline">Created </dt>
              <dd className="inline" title={formatDateTime(task.createdAt)}>
                {timeAgo(task.createdAt)}
              </dd>
            </div>
            <div>
              <dt className="inline">Updated </dt>
              <dd className="inline" title={formatDateTime(task.updatedAt)}>
                {timeAgo(task.updatedAt)}
              </dd>
            </div>
            {task.completedAt && (
              <div>
                <dt className="inline">Completed </dt>
                <dd className="inline">{formatDateTime(task.completedAt)}</dd>
              </div>
            )}
          </dl>
        </aside>

        <article className={cn('min-w-0', !panel && 'lg:col-start-1 lg:row-start-2')}>
          {/* The description is the body of the document. */}
          <div className="mt-7" data-task-description="">
            {task.description ? (
              <RichText text={task.description} projectId={task.projectId} className="max-w-[70ch] text-[15px] leading-[1.7] text-ink" />
            ) : (
              <p className="text-[14px] text-muted">
                No description yet.{' '}
                {canEdit && (
                  <button type="button" className="font-medium text-accent hover:underline" onClick={() => setEditing(true)}>
                    Write one
                  </button>
                )}
              </p>
            )}
          </div>

          <DocumentSections>
            <div className="mt-11 space-y-11">
              <TaskCriteriaCard task={task} canEdit={canEdit} />

              <TaskDependenciesCard task={task} canEdit={canEdit} />

              <Card>
                <CardHeader
                  title="Submissions and reviews"
                  description="Every submission and review decision is kept for the record."
                  action={
                    submissions && submissions.length > 0 ? (
                      <Link to={`/projects/${project.id}/tasks/${task.id}/review`} className="text-[13px] font-medium text-accent hover:underline">
                        Open review workspace
                      </Link>
                    ) : null
                  }
                />
                <CardBody>
                  <SubmissionHistory submissions={submissions} loading={loadingSubs} />
                </CardBody>
              </Card>

              <TaskBacklinks task={task} />

              <Card>
                <CardHeader
                  title="Discussion"
                  action={
                    <Segmented
                      label="Show"
                      value={tab}
                      onChange={setTab}
                      options={[
                        { value: 'comments', label: 'Comments', count: task.commentCount },
                        { value: 'activity', label: 'History' },
                      ]}
                    />
                  }
                />
                <CardBody>
                  {tab === 'comments' ? (
                    <CommentsPanel task={task} role={role} />
                  ) : activity && activity.length > 0 ? (
                    <ActivityList items={activity} linkTasks={false} compact />
                  ) : (
                    <p className="text-[13px] text-muted">No history yet.</p>
                  )}
                </CardBody>
              </Card>
            </div>
          </DocumentSections>
        </article>
      </div>

      <TaskFormDialog open={editing} onOpenChange={setEditing} project={project} task={task} />
      <SubmitWorkDialog task={task} open={submitting} onOpenChange={setSubmitting} />
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete ${task.key}?`}
        description={
          <>
            <strong className="font-semibold text-ink">{task.title}</strong> and its comments and submissions will be permanently deleted. Project activity keeps a record that it was deleted.
          </>
        }
        confirmLabel="Delete task"
        loading={deleteState.isLoading}
        onConfirm={async () => {
          try {
            await deleteTask({ id: task.id, projectId: project.id }).unwrap();
            toast.success(`${task.key} deleted`);
            if (onDeleted) onDeleted();
            else navigate(`/projects/${project.id}/board`, { replace: true });
          } catch (e) {
            toast.error(getErrorMessage(e));
          }
        }}
      />
    </div>
  );
}
