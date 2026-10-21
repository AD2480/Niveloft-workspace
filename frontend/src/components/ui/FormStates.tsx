import { AlertCircle, Check, CheckCircle2, Circle } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * When a form is sent with more than one problem, a summary at the top lists them, each a link
 * that jumps to its field. (One problem is already obvious from the field, which gets focus.)
 */
export function ErrorSummary({
  errors,
  labels,
  attempts,
  className,
}: {
  errors: Partial<Record<string, { message?: string } | undefined>>;
  /** Field name → the label people see. Only these fields are listed. */
  labels: Record<string, string>;
  /** formState.submitCount: the summary appears after a send attempt and moves focus to itself. */
  attempts: number;
  className?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const problems = Object.keys(labels)
    .map((name) => ({ name, message: errors[name]?.message }))
    .filter((p): p is { name: string; message: string } => !!p.message);
  const show = attempts > 0 && problems.length > 1;
  useEffect(() => {
    // A new attempt with several problems: bring the summary into view (the first field has focus).
    if (show) box.current?.scrollIntoView({ block: 'nearest' });
  }, [attempts, show]);
  if (!show) return null;
  const focus = (name: string) => {
    const form = box.current?.closest('form');
    const el = form?.querySelector<HTMLElement>(`[name="${CSS.escape(name)}"]`);
    el?.focus();
    el?.scrollIntoView({ block: 'center' });
  };
  return (
    <div ref={box} role="alert" data-error-summary="" className={cn('rounded-lg border border-danger/35 bg-danger-soft px-3.5 py-3 text-[13px] text-danger', className)}>
      <p className="flex items-center gap-2 font-semibold">
        <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
        {problems.length} things need fixing before this can be sent:
      </p>
      <ul className="mt-1.5 space-y-1 pl-6">
        {problems.map((p) => (
          <li key={p.name} className="flex gap-2">
            <span aria-hidden="true">•</span>
            <button type="button" onClick={() => focus(p.name)} className="min-w-0 text-left underline decoration-danger/40 underline-offset-2 transition-colors hover:decoration-danger">
              {labels[p.name]}: {p.message}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * What a form turns into once it has been sent successfully: a clear confirmation, what happens
 * next, and what to do now. It takes focus so screen readers announce it.
 */
export function FormSuccess({ title, children, action, className }: { title: string; children?: ReactNode; action?: ReactNode; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    box.current?.focus();
  }, []);
  return (
    <div
      ref={box}
      tabIndex={-1}
      role="status"
      data-form-success=""
      className={cn('rounded-xl border border-success/30 bg-success-soft px-5 py-5 text-center animate-rise-in focus:outline-none', className)}
    >
      <span className="mx-auto flex size-11 items-center justify-center rounded-full bg-surface text-success ring-1 ring-success/25">
        <CheckCircle2 className="size-6" aria-hidden="true" />
      </span>
      <p className="mt-3 text-[15px] font-semibold text-ink">{title}</p>
      {children && <div className="mx-auto mt-1.5 max-w-sm text-[13px] leading-relaxed text-ink-2">{children}</div>}
      {action && <div className="mt-4 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

/** "Saved" beside a form's button for a few seconds after saving, announced politely. */
export function SavedNote({ at, label = 'Saved' }: { at: number | null; label?: string }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!at) return;
    setShown(true);
    const t = window.setTimeout(() => setShown(false), 4000);
    return () => window.clearTimeout(t);
  }, [at]);
  return (
    <span role="status" aria-live="polite" className={cn('inline-flex items-center gap-1.5 text-[13px] font-medium text-success transition-opacity duration-300', shown ? 'opacity-100' : 'opacity-0')} data-saved-note="">
      {shown && (
        <>
          <Check className="size-4" aria-hidden="true" />
          {label}
        </>
      )}
    </span>
  );
}

/** The password rules, ticked off as they're met (the same rules the server checks). */
export function PasswordRules({ password, confirm, className }: { password: string; confirm?: string; className?: string }) {
  const bytes = new TextEncoder().encode(password).length;
  const rules: [string, boolean][] = [
    ['8 or more characters', password.length >= 8],
    ['At least one letter', /[A-Za-z]/.test(password)],
    ['At least one number', /\d/.test(password)],
  ];
  if (bytes > 72) rules.push(['At most 72 bytes (fewer characters with accents or emoji)', false]);
  if (confirm !== undefined && confirm.length > 0) rules.push(['Both passwords match', confirm === password]);
  const met = rules.filter(([, ok]) => ok).length;
  return (
    <div className={className} data-password-rules="">
      <ul className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2" aria-label="Password rules">
        {rules.map(([label, ok]) => (
          <li key={label} className={cn('flex items-center gap-1.5 transition-colors', ok ? 'text-success' : 'text-muted')}>
            {ok ? <Check className="size-3.5 shrink-0" aria-hidden="true" /> : <Circle className="size-3 shrink-0" aria-hidden="true" />}
            <span>
              {label}
              <span className="sr-only">{ok ? ' (met)' : ' (not yet)'}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="sr-only" aria-live="polite">
        {password ? `${met} of ${rules.length} password rules met.` : ''}
      </p>
    </div>
  );
}
