import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { useCreateProjectMutation, useUpdateProjectMutation } from '@/api/endpoints';
import type { ProjectDetail, ProjectStatus } from '@/api/types';
import { Button } from '@/components/ui/Button';
import { ColorPicker } from '@/components/ui/ColorPicker';
import { Dialog } from '@/components/ui/Dialog';
import { Field, FormError, Input, Select, Textarea } from '@/components/ui/Form';
import { ErrorSummary } from '@/components/ui/FormStates';
import { PALETTE, PROJECT_STATUSES, PROJECT_STATUS_LABEL } from '@/lib/constants';
import { todayIso } from '@/lib/dates';
import { applyServerErrors, suggestKey } from '@/lib/forms';
import { useDiscardGuard } from '@/lib/useDiscardGuard';
import { useTrackedForm } from '@/lib/useTrackedForm';

const LABELS: Record<string, string> = { name: 'Project name', key: 'Key', description: 'Description', startDate: 'Start date', deadline: 'Deadline', status: 'Status' };

const schema = z
  .object({
    name: z.string().trim().min(3, 'Name must be at least 3 characters.').max(100, 'Name must be at most 100 characters.'),
    key: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z][A-Z0-9]{1,5}$/, 'Key must be 2–6 letters or digits, starting with a letter.'),
    description: z.string().trim().max(2000, 'Description must be at most 2000 characters.'),
    color: z.string(),
    status: z.enum(['ACTIVE', 'ON_HOLD', 'COMPLETED', 'ARCHIVED']),
    startDate: z.string().min(1, 'Start date is required.'),
    deadline: z.string(),
  })
  .refine((v) => !v.deadline || v.deadline >= v.startDate, { path: ['deadline'], message: 'Deadline must be on or after the start date.' });
type FormValues = z.infer<typeof schema>;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project?: ProjectDetail;
  onSaved?: (p: ProjectDetail) => void;
}

export function ProjectFormDialog({ open, onOpenChange, project, onSaved }: Props) {
  const [createProject, createState] = useCreateProjectMutation();
  const [updateProject, updateState] = useUpdateProjectMutation();
  const [formError, setFormError] = useState<string | null>(null);
  const [keyTouched, setKeyTouched] = useState(false);
  const saving = createState.isLoading || updateState.isLoading;

  const defaults = (): FormValues => ({
    name: project?.name ?? '',
    key: project?.key ?? '',
    description: project?.description ?? '',
    color: project?.color ?? PALETTE[Math.floor(Math.random() * PALETTE.length)],
    status: project?.status ?? 'ACTIVE',
    startDate: project?.startDate ?? todayIso(),
    deadline: project?.deadline ?? '',
  });

  const {
    register,
    handleSubmit,
    control,
    reset,
    setError,
    setValue,
    watch,
    formState: { errors, isDirty, submitCount },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: defaults() });
  const track = useTrackedForm('project', open);
  const guard = useDiscardGuard(open && isDirty && !saving, () => onOpenChange(false), project ? 'your changes to this project' : 'this new project');

  useEffect(() => {
    if (open) {
      reset(defaults());
      setFormError(null);
      setKeyTouched(!!project);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, project?.id]);

  const name = watch('name');
  useEffect(() => {
    if (!keyTouched) setValue('key', suggestKey(name));
  }, [name, keyTouched, setValue]);

  const onSubmit = async (v: FormValues) => {
    setFormError(null);
    track.submitted();
    const body = { ...v, description: v.description || null, deadline: v.deadline || null, status: v.status as ProjectStatus, version: project?.version ?? null };
    try {
      const saved = project ? await updateProject({ id: project.id, body }).unwrap() : await createProject(body).unwrap();
      track.succeeded();
      toast.success(project ? 'Project updated' : `Project “${saved.name}” created`);
      onOpenChange(false);
      onSaved?.(saved);
    } catch (e) {
      track.failed(e);
      setFormError(applyServerErrors(e, setError, ['name', 'key', 'description', 'color', 'status', 'startDate', 'deadline']));
    }
  };

  return (
    <>
    <Dialog
      open={open}
      onOpenChange={guard.onOpenChange}
      dismissible={!saving}
      title={project ? 'Edit project' : 'Create project'}
      description={project ? 'Update the project details.' : 'Projects group tasks, milestones and team members.'}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={guard.requestClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="project-form" loading={saving} disabled={!!project && !isDirty}>
            {project ? 'Save changes' : 'Create project'}
          </Button>
        </>
      }
    >
      <form id="project-form" onSubmit={handleSubmit(onSubmit, () => track.invalid())} className="space-y-4" noValidate>
        <FormError message={formError} />
        <ErrorSummary errors={errors} labels={LABELS} attempts={submitCount} />
        <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
          <Field label="Project name" error={errors.name?.message} required>
            {(p) => <Input {...p} {...register('name')} placeholder="e.g. Campus Connect Portal" autoFocus />}
          </Field>
          <Field label="Key" error={errors.key?.message} required hint="Prefix for task IDs">
            {(p) => (
              <Input
                {...p}
                {...register('key', { onChange: () => setKeyTouched(true) })}
                placeholder="CCP"
                maxLength={6}
                className="font-mono uppercase"
                autoCapitalize="characters"
              />
            )}
          </Field>
        </div>
        <Field label="Description" error={errors.description?.message} hint="What is this project about? Who is it for?">
          {(p) => <Textarea {...p} {...register('description')} rows={3} placeholder="Goals, scope and success criteria" />}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Start date" error={errors.startDate?.message} required>
            {(p) => <Input {...p} {...register('startDate')} type="date" />}
          </Field>
          <Field label="Deadline" error={errors.deadline?.message} hint="Used for health and expected progress">
            {(p) => <Input {...p} {...register('deadline')} type="date" min={watch('startDate')} />}
          </Field>
        </div>
        {project && (
          <Field label="Status" error={errors.status?.message}>
            {(p) => (
              <Select {...p} {...register('status')}>
                {PROJECT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {PROJECT_STATUS_LABEL[s]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        <div className="space-y-1.5">
          <span className="block text-[13px] font-medium text-ink-2">Colour</span>
          <Controller control={control} name="color" render={({ field }) => <ColorPicker label="Project colour" value={field.value} onChange={field.onChange} />} />
        </div>
      </form>
    </Dialog>
    {guard.prompt}
    </>
  );
}
