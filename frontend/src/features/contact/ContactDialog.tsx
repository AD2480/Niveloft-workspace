import { zodResolver } from '@hookform/resolvers/zod';
import { Send } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useLocation } from 'react-router';
import { z } from 'zod';
import { getErrorCode, getFieldErrors } from '@/api/errors';
import { useAuthOptionsQuery } from '@/api/endpoints';
import { useSendContactMutation } from '@/api/siteEndpoints';
import { useAppSelector } from '@/app/store';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Field, FormError, Input, Select, Textarea } from '@/components/ui/Form';
import { ErrorSummary, FormSuccess } from '@/components/ui/FormStates';
import { USE_TEST_API } from '@/config';
import { Honeypot, Turnstile } from '@/features/auth/Turnstile';
import { attribution } from '@/lib/attribution';
import { applyServerErrors, rules } from '@/lib/forms';
import { useDiscardGuard } from '@/lib/useDiscardGuard';
import { useTrackedForm } from '@/lib/useTrackedForm';
import { closeContact, TOPICS, useContactState } from './contactStore';


const MAX = 4000;

const schema = z.object({
  name: rules.name,
  email: rules.email,
  topic: z.enum(['QUESTION', 'PROBLEM', 'DATA', 'FEEDBACK', 'OTHER']),
  message: z.string().trim().min(10, 'Write at least 10 characters so we can help.').max(MAX, `Keep it under ${MAX} characters.`),
});
type FormValues = z.infer<typeof schema>;

const LABELS: Record<string, string> = { name: 'Your name', email: 'Your email', topic: 'What it’s about', message: 'Message' };

/**
 * The contact form, opened from the floating Contact button, the footer, the account menu or an
 * error's reference. The message is saved for the operator (and emailed to them when this copy
 * sends email); a confirmation replaces the form once it's sent.
 */
export function ContactDialog() {
  const { open, preset } = useContactState();
  const user = useAppSelector((s) => s.auth.user);
  const location = useLocation();
  const options = useAuthOptionsQuery(undefined, { skip: !open || USE_TEST_API });
  const [send, { isLoading }] = useSendContactMutation();
  const [sent, setSent] = useState<{ email: string; delivered: boolean } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [honeypot, setHoneypot] = useState('');
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [captchaReset, setCaptchaReset] = useState(0);
  const [reference, setReference] = useState<string | null>(null);
  const track = useTrackedForm('contact', open && !sent);

  const defaults = (): FormValues => ({
    name: user?.name ?? '',
    email: user?.email ?? '',
    topic: preset.topic ?? (preset.reference ? 'PROBLEM' : 'QUESTION'),
    message: preset.message ?? '',
  });
  const {
    register,
    handleSubmit,
    reset,
    setError,
    watch,
    formState: { errors, isDirty, submitCount },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: defaults() });

  useEffect(() => {
    if (!open) return;
    reset(defaults());
    setSent(null);
    setFormError(null);
    setReference(preset.reference ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const guard = useDiscardGuard(open && isDirty && !sent && !isLoading, closeContact, 'your message');
  const message = watch('message');

  const onSubmit = async (v: FormValues) => {
    setFormError(null);
    track.submitted();
    try {
      const res = await send({
        ...v,
        reference,
        page: location.pathname.slice(0, 200),
        website: honeypot,
        captchaToken: captcha,
        attribution: attribution(),
      }).unwrap();
      track.succeeded();
      setSent({ email: v.email.trim(), delivered: res.receipt.delivered });
    } catch (e) {
      track.failed(e);
      const fields = getFieldErrors(e);
      setFormError(fields.captcha ?? fields.form ?? applyServerErrors(e, setError, ['name', 'email', 'topic', 'message']));
      if (getErrorCode(e) !== 'RATE_LIMITED') {
        setCaptcha(null);
        setCaptchaReset((n) => n + 1);
      }
    }
  };

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={guard.onOpenChange}
        dismissible={!isLoading}
        title={sent ? 'Message sent' : 'Contact us'}
        description={sent ? undefined : 'Questions, problems, data requests or ideas. We read every message.'}
        size="md"
        footer={
          sent ? (
            <Button onClick={closeContact}>Done</Button>
          ) : (
            <>
              <Button variant="secondary" onClick={guard.requestClose} disabled={isLoading}>
                Cancel
              </Button>
              <Button type="submit" form="contact-form" loading={isLoading} leftIcon={<Send />}>
                Send message
              </Button>
            </>
          )
        }
      >
        {sent ? (
          <FormSuccess title="Thanks, your message is on its way">
            {USE_TEST_API ? (
              <p>The in-browser test API saved it in this browser only; nobody receives it.</p>
            ) : (
              <p>
                The people who run this site will reply to <strong className="font-medium text-ink">{sent.email}</strong>.
                {sent.delivered ? ' They’ve been sent your message by email.' : ' It’s saved for them to read.'}
              </p>
            )}
          </FormSuccess>
        ) : (
          <form
            id="contact-form"
            onSubmit={handleSubmit(onSubmit, () => track.invalid())}
            className="space-y-4"
            noValidate
            data-contact-form=""
          >
            <FormError message={formError} />
            <ErrorSummary errors={errors} labels={LABELS} attempts={submitCount} />
            <Honeypot value={honeypot} onChange={setHoneypot} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={LABELS.name} error={errors.name?.message} required>
                {(p) => <Input {...p} {...register('name')} autoComplete="name" maxLength={80} />}
              </Field>
              <Field label={LABELS.email} error={errors.email?.message} required hint="Only used to reply.">
                {(p) => <Input {...p} {...register('email')} type="email" autoComplete="email" inputMode="email" maxLength={254} />}
              </Field>
            </div>
            <Field label={LABELS.topic} error={errors.topic?.message} required>
              {(p) => (
                <Select {...p} {...register('topic')}>
                  {TOPICS.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field
              label={LABELS.message}
              error={errors.message?.message}
              required
              hint={
                <span className="flex justify-between gap-3">
                  <span>What happened, what you expected, and the page, if it’s about a problem.</span>
                  <span className="shrink-0 tabular" aria-hidden="true">
                    {message.length}/{MAX}
                  </span>
                </span>
              }
            >
              {(p) => <Textarea {...p} {...register('message')} rows={5} maxLength={MAX} />}
            </Field>
            {reference && (
              <p className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2 text-[12.5px] text-ink-2">
                Error reference <code className="font-mono text-[12px] text-ink">{reference}</code> is included.
                <button type="button" onClick={() => setReference(null)} className="ml-auto text-accent hover:underline">
                  Remove it
                </button>
              </p>
            )}
            <Turnstile onToken={setCaptcha} resetKey={captchaReset} serverRequiresIt={options.data?.turnstile} />
            <p className="text-xs leading-relaxed text-muted">
              We keep your message to answer it, as the{' '}
              <Link to="/privacy#collect" target="_blank" rel="noopener" className="text-ink underline decoration-line-strong underline-offset-2 transition-colors hover:text-accent hover:decoration-accent">
                privacy policy
                <span className="sr-only"> (opens in a new tab)</span>
              </Link>{' '}
              explains.
            </p>
          </form>
        )}
      </Dialog>
      {guard.prompt}
    </>
  );
}
