import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { useCreateTaskMutation, useMilestonesQuery, useUpdateTaskMutation } from '@/api/endpoints';
import { isEditConflict } from '@/api/errors';
import type { Priority, ProjectDetail, Task } from '@/api/types';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { ErrorSummary } from '@/components/ui/FormStates';
import { Field, FormError, Input, Select, Textarea } from '@/components/ui/Form';
import { PRIORITIES, PRIORITY_LABEL } from '@/lib/constants';
import { applyServerErrors } from '@/lib/forms';
import { atLeast, can } from '@/lib/permissions';
import { useCurrentUserId } from '../projects/projectContext';
import { useDiscardGuard } from '@/lib/useDiscardGuard';
import { useTrackedForm } from '@/lib/useTrackedForm';
import { WritingField, WritingHint } from '@/features/refs/WritingField';

const LABELS: Record<string, string> = {
  title: 'Title',
  description: 'Description',
  priority: 'Priority',
  assigneeId: 'Assignee',
  dueDate: 'Due date',
  milestoneId: 'Milestone',
  criteria: 'Acceptance criteria',
  estimate: 'Estimate',
};

const lines = (v: string) =>
  v
    .split('\n')
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
    .filter(Boolean);

const schema = z.object({
  title: z.string().trim().min(3, 'Title must be at least 3 characters.').max(200, 'Title must be at most 200 characters.'),
  description: z.string().trim().max(5000, 'Description must be at most 5000 characters.'),
  status: z.enum(['TODO', 'IN_PROGRESS']),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']),
  assigneeId: z.string(),
  dueDate: z.string(),
  milestoneId: z.string(),
  estimate: z.string().refine((v) => v === '' || (/^\d+$/.test(v) && Number(v) >= 1 && Number(v) <= 250), 'Enter whole working days between 1 and 250, or leave it empty.'),
  /** Create only: one acceptance criterion per line. */
  criteria: z
    .string()
    .refine((v) => lines(v).length <= 20, 'Add at most 20 criteria.')
    .refine((v) => lines(v).every((l) => l.length <= 500), 'Each criterion must be at most 500 characters.'),
});
type FormValues = z.infer<typeof schema>;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: ProjectDetail;
  task?: Task;
  /** Values to start a new task with (e.g. from the board column, or a draft the assistant prepared). */
  defaults?: {
    status?: 'TODO' | 'IN_PROGRESS';
    milestoneId?: number;
    title?: string;
    description?: string;
    priority?: Priority;
    dueDate?: string;
    assigneeId?: number;
    estimateDays?: number;
  };
  onSaved?: (task: Task) => void;
}

export function TaskFormDialog({ open, onOpenChange, project, task, defaults, onSaved }: Props) {
  const me = useCurrentUserId();
  const role = project.myRole;
  const { data: milestones } = useMilestonesQuery(project.id);
  const [createTask, createState] = useCreateTaskMutation();
  const [updateTask, updateState] = useUpdateTaskMutation();
  const [formError, setFormError] = useState<string | null>(null);
  const saving = createState.isLoading || updateState.isLoading;

  // A prepared assignee is only used if this person could pick them in the form themselves.
  const draftAssignee =
    defaults?.assigneeId !== undefined &&
    project.members.some((m) => m.user.id === defaults.assigneeId && m.role !== 'VIEWER' && (atLeast(role, 'MANAGER') || m.user.id === me))
      ? String(defaults.assigneeId)
      : undefined;

  const initial = (): FormValues => ({
    title: task?.title ?? defaults?.title ?? '',
    description: task?.description ?? defaults?.description ?? '',
    status: defaults?.status ?? 'TODO',
    priority: task?.priority ?? defaults?.priority ?? 'MEDIUM',
    assigneeId: task ? String(task.assignee?.id ?? '') : (draftAssignee ?? (atLeast(role, 'MANAGER') ? '' : String(me))),
    dueDate: task?.dueDate ?? defaults?.dueDate ?? '',
    milestoneId: String(task?.milestoneId ?? defaults?.milestoneId ?? ''),
    criteria: '',
    estimate: task?.estimateDays ? String(task.estimateDays) : defaults?.estimateDays ? String(defaults.estimateDays) : '',
  });

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isDirty, submitCount },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: initial() });
  const track = useTrackedForm('task', open);
  const guard = useDiscardGuard(open && isDirty && !saving, () => onOpenChange(false), task ? `your changes to ${task.key}` : 'this new task');

  useEffect(() => {
    if (open) {
      reset(initial());
      setFormError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, task?.id]);

  // Which people may this user pick as assignee?
  const taskLike = task ? { status: task.status, assigneeId: task.assignee?.id ?? null, reporterId: task.reporter.id } : { status: 'TODO' as const, assigneeId: null, reporterId: me };
  const assignable = project.members.filter(
    (m) => m.role !== 'VIEWER' && (task ? can.assignTask(role, taskLike, me, m.user.id) || m.user.id === task.assignee?.id : atLeast(role, 'MANAGER') || m.user.id === me),
  );
  const canUnassign = !task || can.assignTask(role, taskLike, me, null) || task.assignee === null;
  const openMilestones = (milestones ?? []).filter((m) => !m.completed || m.id === task?.milestoneId);

  const onSubmit = async (v: FormValues) => {
    setFormError(null);
    track.submitted();
    const body = {
      title: v.title,
      description: v.description || null,
      priority: v.priority as Priority,
      assigneeId: v.assigneeId ? Number(v.assigneeId) : null,
      dueDate: v.dueDate || null,
      milestoneId: v.milestoneId ? Number(v.milestoneId) : null,
      estimateDays: v.estimate ? Number(v.estimate) : null,
      ...(task ? { version: task.version } : { status: v.status, acceptanceCriteria: lines(v.criteria) }),
    };
    try {
      const saved = task ? await updateTask({ id: task.id, projectId: project.id, body }).unwrap() : await createTask({ projectId: project.id, body }).unwrap();
      track.succeeded();
      toast.success(task ? 'Task updated' : `${saved.key} created`);
      onOpenChange(false);
      onSaved?.(saved);
    } catch (e) {
      track.failed(e);
      if (isEditConflict(e)) {
        setFormError('Someone else changed this task while you were editing. Close this dialog to load their changes, then edit again.');
        return;
      }
      setFormError(applyServerErrors(e, setError, ['title', 'description', 'priority', 'assigneeId', 'dueDate', 'milestoneId', 'estimate'], { estimateDays: 'estimate' }));
    }
  };

  return (
    <>
    <Dialog
      open={open}
      onOpenChange={guard.onOpenChange}
      dismissible={!saving}
      title={task ? `Edit ${task.key}` : 'New task'}
      description={task ? undefined : `Add a task to ${project.name}.`}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={guard.requestClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="task-form" loading={saving} disabled={!!task && !isDirty}>
            {task ? 'Save changes' : 'Create task'}
          </Button>
        </>
      }
    >
      <form id="task-form" onSubmit={handleSubmit(onSubmit, () => track.invalid())} className="space-y-4" noValidate>
        <FormError message={formError} />
        <ErrorSummary errors={errors} labels={LABELS} attempts={submitCount} />
        <Field label="Title" error={errors.title?.message} required>
          {(p) => <Input {...p} {...register('title')} placeholder="What needs to be done?" autoFocus />}
        </Field>
        <Field label="Description" error={errors.description?.message} hint={<WritingHint />}>
          {(p) => <WritingField {...p} {...register('description')} projectId={project.id} rows={5} placeholder="Describe the work and what “done” looks like" />}
        </Field>
        {!task && (
          <Field
            label="Acceptance criteria"
            error={errors.criteria?.message}
            hint="One per line. The reviewer checks each one before approving; you can edit them later on the task."
          >
            {(p) => <Textarea {...p} {...register('criteria')} rows={3} placeholder={'Form validates required fields\nErrors are announced to screen readers'} />}
          </Field>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          {!task && (
            <Field label="Status" error={errors.status?.message}>
              {(p) => (
                <Select {...p} {...register('status')}>
                  <option value="TODO">To do</option>
                  <option value="IN_PROGRESS">In progress</option>
                </Select>
              )}
            </Field>
          )}
          <Field label="Priority" error={errors.priority?.message}>
            {(p) => (
              <Select {...p} {...register('priority')}>
                {PRIORITIES.map((pr) => (
                  <option key={pr} value={pr}>
                    {PRIORITY_LABEL[pr]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field
            label="Assignee"
            error={errors.assigneeId?.message}
            hint={!atLeast(role, 'MANAGER') ? 'Members can assign tasks to themselves only.' : undefined}
          >
            {(p) => (
              <Select {...p} {...register('assigneeId')}>
                {canUnassign && <option value="">Unassigned</option>}
                {assignable.map((m) => (
                  <option key={m.user.id} value={m.user.id}>
                    {m.user.name}
                    {m.user.id === me ? ' (you)' : ''}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Due date" error={errors.dueDate?.message}>
            {(p) => <Input {...p} {...register('dueDate')} type="date" />}
          </Field>
          <Field label="Estimate (working days)" error={errors.estimate?.message} hint="Optional. Used only by the planner, and always shown as an estimate.">
            {(p) => <Input {...p} {...register('estimate')} type="number" min={1} max={250} step={1} inputMode="numeric" placeholder="Not estimated" />}
          </Field>
          <Field label="Milestone" error={errors.milestoneId?.message} className={task ? 'sm:col-span-2' : undefined}>
            {(p) => (
              <Select key={openMilestones.length} {...p} {...register('milestoneId')}>
                <option value="">No milestone</option>
                {openMilestones.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      </form>
    </Dialog>
    {guard.prompt}
    </>
  );
}
