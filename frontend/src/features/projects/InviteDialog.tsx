import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { useInviteMutation } from '@/api/endpoints';
import type { Role } from '@/api/types';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Field, FormError, Input } from '@/components/ui/Form';
import { cn } from '@/lib/cn';
import { ROLE_DESCRIPTION, ROLE_LABEL } from '@/lib/constants';
import { applyServerErrors, rules } from '@/lib/forms';
import { useTrackedForm } from '@/lib/useTrackedForm';

const schema = z.object({ email: rules.email, role: z.enum(['MANAGER', 'MEMBER', 'VIEWER']) });
type FormValues = z.infer<typeof schema>;

export function InviteDialog({ open, onOpenChange, projectId, roles }: { open: boolean; onOpenChange: (o: boolean) => void; projectId: number; roles: Role[] }) {
  const [invite, { isLoading }] = useInviteMutation();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    setError,
    watch,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { email: '', role: 'MEMBER' } });
  const track = useTrackedForm('invite', open);

  useEffect(() => {
    if (open) {
      reset({ email: '', role: 'MEMBER' });
      setFormError(null);
    }
  }, [open, reset]);

  const selected = watch('role');

  const onSubmit = async (v: FormValues) => {
    track.submitted();
    try {
      await invite({ projectId, email: v.email, role: v.role }).unwrap();
      track.succeeded();
      toast.success(`Invitation sent to ${v.email}`);
      onOpenChange(false);
    } catch (e) {
      track.failed(e);
      setFormError(applyServerErrors(e, setError, ['email', 'role']));
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      dismissible={!isLoading}
      title="Invite to project"
      description="They’ll see the invitation in their inbox. New users see it after signing up with this email."
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={isLoading}>
            Cancel
          </Button>
          <Button type="submit" form="invite-form" loading={isLoading}>
            Send invitation
          </Button>
        </>
      }
    >
      <form id="invite-form" onSubmit={handleSubmit(onSubmit, () => track.invalid())} className="space-y-4" noValidate>
        <FormError message={formError} />
        <Field label="Email address" error={errors.email?.message} required>
          {(p) => <Input {...p} {...register('email')} type="email" placeholder="teammate@college.edu" autoFocus autoComplete="off" />}
        </Field>
        <fieldset>
          <legend className="mb-1.5 text-[13px] font-medium text-ink-2">Role</legend>
          <div className="space-y-2">
            {roles.map((r) => (
              <label
                key={r}
                className={cn('flex cursor-pointer gap-3 rounded-lg border p-3 transition-colors', selected === r ? 'border-brand/50 bg-brand-soft/50 ring-1 ring-brand/30' : 'border-line hover:bg-surface-2')}
              >
                <input type="radio" value={r} {...register('role')} className="mt-0.5 accent-[var(--brand)]" />
                <span>
                  <span className="block text-[13px] font-semibold text-ink">{ROLE_LABEL[r]}</span>
                  <span className="block text-xs text-muted">{ROLE_DESCRIPTION[r]}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      </form>
    </Dialog>
  );
}
