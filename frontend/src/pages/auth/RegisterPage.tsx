import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useLocation, useNavigate } from 'react-router';
import { z } from 'zod';
import { getErrorCode, getFieldErrors } from '@/api/errors';
import { useAuthOptionsQuery, useRegisterMutation } from '@/api/endpoints';
import { useAppDispatch } from '@/app/store';
import { Button } from '@/components/ui/Button';
import { Field, FormError, Input } from '@/components/ui/Form';
import { ErrorSummary, PasswordRules } from '@/components/ui/FormStates';
import { PasswordInput } from '@/components/ui/PasswordInput';
import { credentialsReceived } from '@/features/auth/authSlice';
import { redirectAfterSignIn } from '@/features/auth/RequireAuth';
import { Honeypot, Turnstile } from '@/features/auth/Turnstile';
import { PersonaOptions } from '@/features/roles/RolePicker';
import { attribution } from '@/lib/attribution';
import { cn } from '@/lib/cn';
import { applyServerErrors, passwordStrength, rules } from '@/lib/forms';
import { usePageMeta } from '@/lib/pageMeta';
import { useTrackedForm } from '@/lib/useTrackedForm';
import { pendingPersona, savePersona, setPendingPersona, type Persona } from '@/lib/persona';
import { AuthLayout } from './AuthLayout';

const schema = z
  .object({
    name: rules.name,
    email: rules.email,
    password: rules.password,
    confirmPassword: z.string().min(1, 'Please confirm your password.'),
    acceptTerms: z.boolean().refine((v) => v, 'Please confirm you’re 18 or older and accept the terms and the privacy policy.'),
  })
  .refine((v) => v.password === v.confirmPassword, { path: ['confirmPassword'], message: 'Passwords do not match.' });
type FormValues = z.infer<typeof schema>;

const STRENGTH_COLOR = ['bg-danger', 'bg-danger', 'bg-warning', 'bg-success', 'bg-success'];

const LABELS: Record<string, string> = {
  name: 'Full name',
  email: 'Email',
  password: 'Password',
  confirmPassword: 'Confirm password',
  acceptTerms: 'Terms and privacy policy',
};

export function RegisterPage() {
  usePageMeta({ title: 'Create your workspace', path: '/register' });
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const options = useAuthOptionsQuery();
  const [registerUser, { isLoading }] = useRegisterMutation();
  const [formError, setFormError] = useState<string | null>(null);
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [captchaError, setCaptchaError] = useState<string | null>(null);
  const [captchaReset, setCaptchaReset] = useState(0);
  const [honeypot, setHoneypot] = useState('');
  // Chosen on the front page (or here). It shapes the start page and first steps, never permissions.
  const [persona, setPersona] = useState<Persona | null>(() => (location.state as { persona?: Persona } | null)?.persona ?? pendingPersona());
  const choosePersona = (p: Persona) => {
    setPersona(p);
    setPendingPersona(p);
  };

  const {
    register,
    handleSubmit,
    setError,
    watch,
    formState: { errors, submitCount },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', email: '', password: '', confirmPassword: '', acceptTerms: false },
  });
  const track = useTrackedForm('sign-up', !(options.data?.registrationOpen === false));

  const password = watch('password');
  const confirmPassword = watch('confirmPassword');
  const strength = passwordStrength(password);
  const closed = options.data?.registrationOpen === false;

  const onSubmit = async ({ name, email, password, acceptTerms }: FormValues) => {
    setFormError(null);
    setCaptchaError(null);
    track.submitted();
    try {
      const res = await registerUser({ name, email, password, acceptTerms, website: honeypot, captchaToken: captcha, attribution: attribution() }).unwrap();
      track.succeeded();
      if (res.verificationRequired) {
        navigate('/check-email', { replace: true, state: { email: res.email, from: (location.state as { from?: string } | null)?.from } });
        return;
      }
      if (persona) savePersona(res.user.id, persona);
      // Invited people go where their link pointed; everyone else starts with the introduction.
      redirectAfterSignIn((location.state as { from?: string } | null)?.from ?? '/introduction?welcome=1');
      dispatch(credentialsReceived({ token: res.token, user: res.user }));
    } catch (e) {
      track.failed(e);
      const fields = getFieldErrors(e);
      if (fields.captcha) setCaptchaError(fields.captcha);
      setFormError(fields.captcha ? null : fields.form ?? applyServerErrors(e, setError, ['name', 'email', 'password', 'acceptTerms']));
      if (getErrorCode(e) !== 'RATE_LIMITED') {
        setCaptcha(null);
        setCaptchaReset((n) => n + 1); // Turnstile tokens work once
      }
    }
  };

  return (
    <AuthLayout
      eyebrow=""
      exhibit="stages"
      title="Create your workspace"
      subtitle="Start planning projects with your team in minutes."
      footer={
        <div className="space-y-2">
          <p>
            Already have an account?{' '}
            <Link to="/login" state={location.state} className="font-medium text-accent hover:underline">
              Log in
            </Link>
          </p>
          <p>
            Want to know more first?{' '}
            <Link to="/introduction" className="font-medium text-accent hover:underline">
              Read the introduction
            </Link>
          </p>
        </div>
      }
    >
      {closed ? (
        <p className="rounded-md border border-line bg-surface-2 px-4 py-3 text-[13.5px] text-ink-2" role="status">
          New accounts can’t be created on this server right now. If you were invited to a project, ask whoever runs it.
        </p>
      ) : (
        <form onSubmit={handleSubmit(onSubmit, () => track.invalid())} className="relative space-y-4" noValidate>
          <FormError message={formError} />
          <ErrorSummary errors={errors} labels={LABELS} attempts={submitCount} />
          <Honeypot value={honeypot} onChange={setHoneypot} />
          <fieldset>
            <legend className="text-[13px] font-medium text-ink">
              How will you use Niveloft? <span className="font-normal text-muted">(optional)</span>
            </legend>
            <div className="mt-1.5">
              <PersonaOptions value={persona} onChange={choosePersona} compact name="register-persona" />
            </div>
            <p className="mt-1.5 text-xs text-muted">Sets your start page and first steps. Your role in each project is set by that project; projects you create are yours.</p>
          </fieldset>
          <Field label="Full name" error={errors.name?.message} required>
            {(p) => <Input {...p} {...register('name')} autoComplete="name" placeholder="e.g. Aarav Sharma" maxLength={80} autoFocus />}
          </Field>
          <Field
            label="Email"
            error={errors.email?.message}
            required
            hint={options.data?.emailVerificationRequired ? 'We’ll send a link to confirm it. If you were invited, use that address.' : 'If you were invited to a project, use the invited email address.'}
          >
            {(p) => <Input {...p} {...register('email')} type="email" autoComplete="email" inputMode="email" placeholder="you@college.edu" maxLength={254} />}
          </Field>
          <Field label="Password" error={errors.password?.message} required>
            {(p) => <PasswordInput {...p} {...register('password')} autoComplete="new-password" maxLength={72} />}
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
          <Field label="Confirm password" error={errors.confirmPassword?.message} required>
            {(p) => <PasswordInput {...p} {...register('confirmPassword')} autoComplete="new-password" maxLength={72} />}
          </Field>
          <div>
            <label className="flex cursor-pointer items-start gap-2.5 text-[13px] leading-relaxed text-ink-2 transition-colors hover:text-ink">
              <input
                type="checkbox"
                className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]"
                aria-invalid={!!errors.acceptTerms}
                aria-describedby={errors.acceptTerms ? 'accept-terms-error' : undefined}
                {...register('acceptTerms')}
              />
              <span>
                I’m 18 or older, and I agree to the{' '}
                <Link to="/terms" target="_blank" rel="noopener" className="text-ink underline decoration-line-strong underline-offset-2 transition-colors hover:text-accent hover:decoration-accent">
                  terms and conditions
                </Link>{' '}
                and the{' '}
                <Link to="/privacy" target="_blank" rel="noopener" className="text-ink underline decoration-line-strong underline-offset-2 transition-colors hover:text-accent hover:decoration-accent">
                  privacy policy
                </Link>
                .<span className="sr-only"> (opens in a new tab)</span>
              </span>
            </label>
            {errors.acceptTerms && (
              <p id="accept-terms-error" className="mt-1.5 text-xs font-medium text-danger" role="alert">
                {errors.acceptTerms.message}
              </p>
            )}
          </div>
          <div>
            <Turnstile onToken={setCaptcha} resetKey={captchaReset} serverRequiresIt={options.data?.turnstile} />
            {captchaError && (
              <p className="mt-1 text-xs font-medium text-danger" role="alert">
                {captchaError}
              </p>
            )}
          </div>
          <Button type="submit" size="lg" className="w-full" loading={isLoading}>
            Create account
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
