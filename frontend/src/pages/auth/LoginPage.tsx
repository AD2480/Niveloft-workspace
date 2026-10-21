import { zodResolver } from '@hookform/resolvers/zod';
import { Info } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useLocation } from 'react-router';
import { z } from 'zod';
import { useAuthOptionsQuery, useLoginMutation } from '@/api/endpoints';
import { useAppDispatch, useAppSelector } from '@/app/store';
import { Button } from '@/components/ui/Button';
import { Field, FormError, Input } from '@/components/ui/Form';
import { PasswordInput } from '@/components/ui/PasswordInput';
import { credentialsReceived } from '@/features/auth/authSlice';
import { cn } from '@/lib/cn';
import { redirectAfterSignIn } from '@/features/auth/RequireAuth';
import { applyServerErrors, rules } from '@/lib/forms';
import { startPathFor } from '@/lib/persona';
import { getErrorCode } from '@/api/errors';
import { usePageMeta } from '@/lib/pageMeta';
import { useTrackedForm } from '@/lib/useTrackedForm';
import { AuthLayout } from './AuthLayout';

const schema = z.object({
  email: rules.email,
  password: z.string().min(1, 'Password is required.'),
});
type FormValues = z.infer<typeof schema>;

export function LoginPage() {
  usePageMeta({ title: 'Log in', path: '/login' });
  const dispatch = useAppDispatch();
  const location = useLocation();
  const sessionExpired = useAppSelector((s) => s.auth.sessionExpired);
  const [login, { isLoading }] = useLoginMutation();
  const options = useAuthOptionsQuery();
  const [formError, setFormError] = useState<string | null>(null);
  /** Set when the account exists but its email isn't confirmed yet. */
  const [unconfirmed, setUnconfirmed] = useState<string | null>(null);
  const [remember, setRemember] = useState(false);
  /** How long "keep me signed in" lasts on this server; 0 when it's off, null until the server says (the box is shown meanwhile, so nothing jumps). */
  const rememberDays = options.data ? options.data.rememberDays : null;
  const from = (location.state as { from?: string } | null)?.from;

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { email: (location.state as { email?: string } | null)?.email ?? '', password: '' } });
  const track = useTrackedForm('sign-in');

  const signIn = async (values: FormValues) => {
    setFormError(null);
    setUnconfirmed(null);
    track.submitted();
    try {
      // The ticked box counts even if the server's options haven't arrived yet (a quick submit); a
      // server with "keep me signed in" off ignores it anyway.
      const keep = remember && rememberDays !== 0;
      const res = await login({ ...values, remember: keep }).unwrap();
      track.succeeded();
      // Where they were going, or the start page for how they said they'd use Niveloft.
      redirectAfterSignIn(from ?? startPathFor(res.user.id));
      dispatch(credentialsReceived({ token: res.token, user: res.user, remember: keep }));
    } catch (e) {
      track.failed(e);
      if (getErrorCode(e) === 'EMAIL_NOT_VERIFIED') setUnconfirmed(values.email.trim());
      setFormError(applyServerErrors(e, setError, ['email', 'password']));
    }
  };

  return (
    <AuthLayout
      eyebrow=""
      title="Welcome back"
      subtitle="Log in to continue to your projects."
      footer={
        <div className="space-y-2">
          <p>
            New to Niveloft?{' '}
            <Link to="/register" state={location.state} className="font-medium text-accent hover:underline">
              Create your workspace
            </Link>
          </p>
          <p>
            First time here?{' '}
            <Link to="/introduction" className="font-medium text-accent hover:underline">
              Read the introduction
            </Link>
          </p>
        </div>
      }
    >
      {sessionExpired && (
        <div className="mb-5 flex gap-2 rounded-md border border-info/25 bg-info-soft px-3 py-2.5 text-[13px] text-info" role="status">
          <Info className="mt-0.5 size-4 shrink-0" />
          Your session expired. Please log in again.
        </div>
      )}

      <form onSubmit={handleSubmit(signIn, () => track.invalid())} className="space-y-4" noValidate>
        <FormError message={formError} />
        {unconfirmed && (
          <p className="rounded-md border border-line bg-surface-2 px-3 py-2.5 text-[13px] text-ink-2" role="status">
            Didn’t get the email, or the link expired?{' '}
            <Link to="/check-email" state={{ email: unconfirmed }} className="font-medium text-accent hover:underline">
              Send a new link
            </Link>
          </p>
        )}
        <Field label="Email" error={errors.email?.message} required>
          {(p) => <Input {...p} {...register('email')} type="email" autoComplete="email" placeholder="you@college.edu" autoFocus />}
        </Field>
        <Field label="Password" error={errors.password?.message} required>
          {(p) => <PasswordInput {...p} {...register('password')} autoComplete="current-password" placeholder="Your password" maxLength={200} />}
        </Field>
        {(options.isLoading || options.data?.passwordReset) && (
          // Held in place (invisible) while the server's options load, so the form doesn't jump.
          <p className={cn('-mt-2 text-right text-[12.5px]', options.isLoading && 'invisible')} aria-hidden={options.isLoading || undefined}>
            <Link to="/forgot-password" className="text-accent hover:underline" tabIndex={options.isLoading ? -1 : undefined}>
              Forgot password?
            </Link>
          </p>
        )}
        {rememberDays !== 0 && (
          <label className="flex cursor-pointer items-start gap-2.5 text-[13px] text-ink-2 transition-colors hover:text-ink">
            <input type="checkbox" className="mt-0.5 size-4 accent-[var(--accent)]" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            <span>
              Keep me signed in{rememberDays ? ` for ${rememberDays} ${rememberDays === 1 ? 'day' : 'days'}` : ''}
              <span className="block text-xs text-muted">Leave this off on a shared computer: you’ll stay signed in only in this tab, until you close it or stop using it.</span>
            </span>
          </label>
        )}
        <Button type="submit" size="lg" className="w-full" loading={isLoading}>
          Log in
        </Button>
      </form>
    </AuthLayout>
  );
}
