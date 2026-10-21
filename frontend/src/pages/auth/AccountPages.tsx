import { zodResolver } from '@hookform/resolvers/zod';
import { CheckCircle2, MailCheck } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useLocation, useSearchParams } from 'react-router';
import { z } from 'zod';
import { getErrorCode, getErrorMessage, getFieldErrors } from '@/api/errors';
import { useAuthOptionsQuery, useForgotPasswordMutation, useResendVerificationMutation, useResetPasswordMutation, useVerifyEmailMutation } from '@/api/endpoints';
import { Button } from '@/components/ui/Button';
import { buttonClass } from '@/components/ui/buttonStyles';
import { Field, FormError, Input } from '@/components/ui/Form';
import { PasswordRules } from '@/components/ui/FormStates';
import { PasswordInput } from '@/components/ui/PasswordInput';
import { Spinner } from '@/components/ui/Spinner';
import { Honeypot, Turnstile } from '@/features/auth/Turnstile';
import { cn } from '@/lib/cn';
import { applyServerErrors, passwordStrength, rules } from '@/lib/forms';
import { usePageMeta } from '@/lib/pageMeta';
import type { TrackedForm } from '@/lib/formMetrics';
import { useTrackedForm } from '@/lib/useTrackedForm';
import { AuthLayout } from './AuthLayout';

const backToSignIn = (
  <p>
    <Link to="/login" className="font-medium text-accent hover:underline">
      Back to sign in
    </Link>
  </p>
);

/**
 * Reads the one-time token from the address bar, then removes it from the address (so it isn't
 * kept in history, shared by copy-paste, or seen by analytics).
 */
function useLinkToken(): string {
  const [params] = useSearchParams();
  const [token] = useState(() => params.get('token') ?? '');
  useEffect(() => {
    if (params.has('token')) window.history.replaceState(window.history.state, '', window.location.pathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return token;
}

const emailSchema = z.object({ email: rules.email });

/** An email field with the bot checks, for asking for a link. */
function EmailLinkForm({
  initialEmail = '',
  submitLabel,
  send,
  loading,
  onSent,
  tracked,
}: {
  /** Counted for the operator's form success rates. */
  tracked?: TrackedForm;
  initialEmail?: string;
  submitLabel: string;
  send: (body: { email: string; website: string; captchaToken: string | null }) => Promise<string>;
  loading: boolean;
  onSent: (message: string) => void;
}) {
  const options = useAuthOptionsQuery();
  const [formError, setFormError] = useState<string | null>(null);
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [captchaReset, setCaptchaReset] = useState(0);
  const [honeypot, setHoneypot] = useState('');
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<z.infer<typeof emailSchema>>({ resolver: zodResolver(emailSchema), defaultValues: { email: initialEmail } });
  const track = useTrackedForm(tracked ?? 'forgot-password', !!tracked);

  return (
    <form
      className="relative space-y-4"
      noValidate
      onSubmit={handleSubmit(
        async ({ email }) => {
        setFormError(null);
        if (tracked) track.submitted();
        try {
          onSent(await send({ email, website: honeypot, captchaToken: captcha }));
          if (tracked) track.succeeded();
        } catch (e) {
          if (tracked) track.failed(e);
          const fields = getFieldErrors(e);
          setFormError(fields.captcha ?? fields.form ?? applyServerErrors(e, setError, ['email']));
          setCaptcha(null);
          setCaptchaReset((n) => n + 1);
        }
        },
        () => tracked && track.invalid(),
      )}
    >
      <FormError message={formError} />
      <Honeypot value={honeypot} onChange={setHoneypot} />
      <Field label="Email" error={errors.email?.message} required>
        {(p) => <Input {...p} {...register('email')} type="email" inputMode="email" autoComplete="email" placeholder="you@college.edu" maxLength={254} autoFocus={!initialEmail} />}
      </Field>
      <Turnstile onToken={setCaptcha} resetKey={captchaReset} serverRequiresIt={options.data?.turnstile} />
      <Button type="submit" size="lg" className="w-full" loading={loading}>
        {submitLabel}
      </Button>
    </form>
  );
}

function Sent({ message }: { message: string }) {
  return (
    <div className="flex gap-3 border border-success/30 bg-success-soft px-4 py-3 text-[13.5px] text-ink" role="status">
      <MailCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
      <p>{message}</p>
    </div>
  );
}

/** After sign-up, when the account must confirm its email before signing in. */
export function CheckEmailPage() {
  usePageMeta({ title: 'Check your email', noindex: true });
  const location = useLocation();
  const email = (location.state as { email?: string } | null)?.email ?? '';
  const [resend, { isLoading }] = useResendVerificationMutation();
  const [sent, setSent] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);

  return (
    <AuthLayout
      eyebrow="One more step"
      exhibit="none"
      title="Check your email"
      subtitle={
        email ? (
          <>
            We sent a link to <strong className="font-medium text-ink">{email}</strong>. Open it to confirm your address and sign in. It works for 24 hours.
          </>
        ) : (
          'We sent a link to the address you signed up with. Open it to confirm your address and sign in. It works for 24 hours.'
        )
      }
      footer={backToSignIn}
    >
      <div className="space-y-5">
        <ul className="list-disc space-y-1 pl-5 text-[13px] leading-relaxed text-ink-2 marker:text-muted">
          <li>It comes from Niveloft and can take a minute or two.</li>
          <li>Look in your spam or promotions folder if it isn’t in your inbox.</li>
          <li>Typed the address wrong? Create the account again with the right one.</li>
        </ul>
        {sent ? (
          <Sent message={sent} />
        ) : asking ? (
          <EmailLinkForm initialEmail={email} submitLabel="Send a new link" loading={isLoading} send={(b) => resend(b).unwrap()} onSent={setSent} />
        ) : (
          <Button variant="secondary" className="w-full" onClick={() => setAsking(true)}>
            Didn’t get it? Send a new link
          </Button>
        )}
      </div>
    </AuthLayout>
  );
}

/**
 * The link in the confirmation email lands here. Confirming doesn't sign in: the person signs in
 * with their password next (so an address registered by someone else can't be taken over).
 */
export function VerifyEmailPage() {
  usePageMeta({ title: 'Confirm your email', noindex: true });
  const token = useLinkToken();
  const [verify] = useVerifyEmailMutation();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  // A link works once, so never send it twice (React runs effects twice in development).
  const sentFor = useRef<string | null>(null);

  useEffect(() => {
    if (!token) {
      setError('This link is incomplete. Open the link from the email again, or send yourself a new one.');
      return;
    }
    if (sentFor.current === token) return;
    sentFor.current = token;
    verify({ token })
      .unwrap()
      .then((res) => setDone(res.email))
      .catch((e) => setError(getErrorMessage(e)));
  }, [token, verify]);

  return (
    <AuthLayout eyebrow="Confirm your email" exhibit="none" title={done ? 'Email confirmed' : error ? 'This link didn’t work' : 'Confirming…'} subtitle="" footer={backToSignIn}>
      {done ? (
        <div className="space-y-5">
          <div className="flex gap-3 border border-success/30 bg-success-soft px-4 py-3 text-[13.5px] text-ink" role="status">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
            <p>Thanks, {done} is confirmed. Sign in with your password to continue.</p>
          </div>
          <Link to="/login" state={{ email: done, from: '/introduction?welcome=1' }} className={buttonClass('primary', 'lg', 'w-full')}>
            Sign in
          </Link>
        </div>
      ) : error ? (
        <div className="space-y-5">
          <p className="border border-danger/30 bg-danger-soft px-4 py-3 text-[13.5px] text-danger" role="alert">
            {error}
          </p>
          <Link to="/check-email" className="inline-flex text-[13.5px] font-medium text-accent hover:underline">
            Send yourself a new link
          </Link>
        </div>
      ) : (
        <p className="flex items-center gap-2 text-[13.5px] text-muted" role="status">
          <Spinner className="size-4" /> Checking your link…
        </p>
      )}
    </AuthLayout>
  );
}

export function ForgotPasswordPage() {
  usePageMeta({ title: 'Reset your password', noindex: true });
  const options = useAuthOptionsQuery();
  const [forgot, { isLoading }] = useForgotPasswordMutation();
  const [sent, setSent] = useState<string | null>(null);
  const unavailable = options.data && !options.data.passwordReset;

  return (
    <AuthLayout
      eyebrow=""
      exhibit="none"
      title="Reset your password"
      subtitle="Enter the email address you signed up with, and we’ll send you a link to choose a new password."
      footer={backToSignIn}
    >
      {unavailable ? (
        <p className="border border-line bg-surface-2 px-4 py-3 text-[13.5px] text-ink-2" role="status">
          This server can’t send email, so passwords can’t be reset by email here. Ask whoever runs it to reset yours.
        </p>
      ) : sent ? (
        <Sent message={sent} />
      ) : (
        <EmailLinkForm tracked="forgot-password" submitLabel="Email me a reset link" loading={isLoading} send={(b) => forgot(b).unwrap()} onSent={setSent} />
      )}
    </AuthLayout>
  );
}

const resetSchema = z
  .object({ password: rules.password, confirmPassword: z.string().min(1, 'Please confirm your password.') })
  .refine((v) => v.password === v.confirmPassword, { path: ['confirmPassword'], message: 'Passwords do not match.' });

const STRENGTH_COLOR = ['bg-danger', 'bg-danger', 'bg-warning', 'bg-success', 'bg-success'];

/** The link in the reset email lands here. */
export function ResetPasswordPage() {
  usePageMeta({ title: 'Choose a new password', noindex: true });
  const token = useLinkToken();
  const [reset, { isLoading }] = useResetPasswordMutation();
  const [formError, setFormError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    watch,
    formState: { errors },
  } = useForm<z.infer<typeof resetSchema>>({ resolver: zodResolver(resetSchema), defaultValues: { password: '', confirmPassword: '' } });
  const track = useTrackedForm('reset-password', !!token && !done);
  const password = watch('password');
  const confirmPassword = watch('confirmPassword');
  const strength = passwordStrength(password);

  if (!token) {
    return (
      <AuthLayout eyebrow="Reset password" exhibit="none" title="This link is incomplete" subtitle="" footer={backToSignIn}>
        <p className="text-[13.5px] text-ink-2">
          Open the link from the email again, or{' '}
          <Link to="/forgot-password" className="font-medium text-accent hover:underline">
            ask for a new one
          </Link>
          .
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      eyebrow="Reset password"
      exhibit="none"
      title={done ? 'Password changed' : 'Choose a new password'}
      subtitle={done ? '' : 'Choosing a new password signs you out on every device.'}
      footer={backToSignIn}
    >
      {done ? (
        <div className="space-y-5">
          <Sent message={done} />
          <Link to="/login" className="inline-flex text-[13.5px] font-medium text-accent hover:underline">
            Sign in with your new password
          </Link>
        </div>
      ) : (
        <form
          className="space-y-4"
          noValidate
          onSubmit={handleSubmit(
            async ({ password }) => {
              setFormError(null);
              track.submitted();
              try {
                setDone(await reset({ token, password }).unwrap());
                track.succeeded();
              } catch (e) {
                track.failed(e);
                if (getErrorCode(e) === 'LINK_EXPIRED') setExpired(true);
                setFormError(applyServerErrors(e, setError, ['password']));
              }
            },
            () => track.invalid(),
          )}
        >
          <FormError message={formError} />
          {expired && (
            <Link to="/forgot-password" className="inline-flex text-[13.5px] font-medium text-accent hover:underline">
              Ask for a new link
            </Link>
          )}
          {/* Lets password managers save the new password against the right account. */}
          <input type="text" name="username" autoComplete="username" hidden readOnly />
          <Field label="New password" error={errors.password?.message} required>
            {(p) => <PasswordInput {...p} {...register('password')} autoComplete="new-password" maxLength={72} autoFocus />}
          </Field>
          {password && (
            <div className="-mt-2 flex items-center gap-3" aria-live="polite">
              <div className="flex flex-1 gap-1" aria-hidden="true">
                {[0, 1, 2, 3].map((i) => (
                  <span key={i} className={cn('h-1 flex-1 rounded-full', i < strength.score ? STRENGTH_COLOR[strength.score] : 'bg-surface-3')} />
                ))}
              </div>
              <span className="w-16 text-right text-xs text-muted">{strength.label}</span>
            </div>
          )}
          <PasswordRules password={password} confirm={confirmPassword} className="-mt-1" />
          <Field label="Confirm new password" error={errors.confirmPassword?.message} required>
            {(p) => <PasswordInput {...p} {...register('confirmPassword')} autoComplete="new-password" maxLength={72} />}
          </Field>
          <Button type="submit" size="lg" className="w-full" loading={isLoading}>
            Change password
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
