import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { useCreateMilestoneMutation, useUpdateMilestoneMutation } from '@/api/endpoints';
import type { Milestone } from '@/api/types';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Field, FormError, Input, Textarea } from '@/components/ui/Form';
import { applyServerErrors } from '@/lib/forms';
import { useDiscardGuard } from '@/lib/useDiscardGuard';
import { useTrackedForm } from '@/lib/useTrackedForm';

const schema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters.').max(100, 'Name must be at most 100 characters.'),
  description: z.string().trim().max(1000, 'Description must be at most 1000 characters.'),
  dueDate: z.string().min(1, 'Due date is required.'),
  completed: z.boolean(),
});
type FormValues = z.infer<typeof schema>;

export function MilestoneFormDialog({
  open,
  onOpenChange,
  projectId,
  milestone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  projectId: number;
  milestone?: Milestone | null;
}) {
  const [create, createState] = useCreateMilestoneMutation();
  const [update, updateState] = useUpdateMilestoneMutation();
  const [formError, setFormError] = useState<string | null>(null);
  const saving = createState.isLoading || updateState.isLoading;
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isDirty },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });
  const track = useTrackedForm('milestone', open);
  const guard = useDiscardGuard(open && isDirty && !saving, () => onOpenChange(false), milestone ? 'your changes to this milestone' : 'this new milestone');

  useEffect(() => {
    if (open) {
      reset({ name: milestone?.name ?? '', description: milestone?.description ?? '', dueDate: milestone?.dueDate ?? '', completed: milestone?.completed ?? false });
      setFormError(null);
    }
  }, [open, milestone, reset]);

  const onSubmit = async (v: FormValues) => {
    const body = { ...v, description: v.description || null };
    track.submitted();
    try {
      if (milestone) await update({ id: milestone.id, projectId, body }).unwrap();
      else await create({ projectId, body }).unwrap();
      track.succeeded();
      toast.success(milestone ? 'Milestone updated' : 'Milestone created');
      onOpenChange(false);
    } catch (e) {
      track.failed(e);
      setFormError(applyServerErrors(e, setError, ['name', 'description', 'dueDate']));
    }
  };

  return (
    <>
    <Dialog
      open={open}
      onOpenChange={guard.onOpenChange}
      dismissible={!saving}
      title={milestone ? 'Edit milestone' : 'New milestone'}
      description="Milestones are checkpoints. Link tasks to a milestone to track its progress."
      footer={
        <>
          <Button variant="secondary" onClick={guard.requestClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="milestone-form" loading={saving}>
            {milestone ? 'Save changes' : 'Create milestone'}
          </Button>
        </>
      }
    >
      <form id="milestone-form" onSubmit={handleSubmit(onSubmit, () => track.invalid())} className="space-y-4" noValidate>
        <FormError message={formError} />
        <Field label="Name" error={errors.name?.message} required>
          {(p) => <Input {...p} {...register('name')} placeholder="e.g. Beta release" autoFocus />}
        </Field>
        <Field label="Description" error={errors.description?.message}>
          {(p) => <Textarea {...p} {...register('description')} rows={3} placeholder="What does reaching this milestone mean?" />}
        </Field>
        <Field label="Due date" error={errors.dueDate?.message} required>
          {(p) => <Input {...p} {...register('dueDate')} type="date" />}
        </Field>
        {milestone && (
          <label className="flex items-center gap-2 text-[13px] text-ink">
            <input type="checkbox" {...register('completed')} className="size-4 rounded border-line-strong accent-[var(--brand)]" />
            Mark as completed
          </label>
        )}
      </form>
    </Dialog>
    {guard.prompt}
    </>
  );
}
