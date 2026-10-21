import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/cn';

const control =
  'w-full rounded-md border border-line-strong bg-surface text-[14px] text-ink placeholder:text-subtle shadow-[0_1px_1px_hsl(var(--shadow-color)/0.04)] transition-[border-color,box-shadow] duration-150 ' +
  'hover:border-[color-mix(in_srgb,var(--ink)_24%,var(--line-strong))] ' +
  'focus:border-brand focus:outline-none focus:ring-[3px] focus:ring-[var(--ring)] ' +
  'disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-muted ' +
  'aria-[invalid=true]:border-danger aria-[invalid=true]:focus:ring-danger/25';

/**
 * Quiet controls read as values until you point at them (task properties): no box until hover or
 * focus, so a column of them looks like a list, not a form.
 */
const quietControl = 'h-8 pointer-coarse:h-10 border-transparent bg-transparent text-[13px] shadow-none hover:border-line-strong hover:bg-surface focus:bg-surface';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { leftIcon?: ReactNode; quiet?: boolean }>(function Input(
  { className, leftIcon, quiet, ...rest },
  ref,
) {
  if (leftIcon) {
    return (
      <div className="relative">
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-subtle [&_svg]:size-4">{leftIcon}</span>
        <input ref={ref} className={cn(control, 'h-9 pointer-coarse:h-11 pl-9 pr-3', quiet && quietControl, className)} {...rest} />
      </div>
    );
  }
  return <input ref={ref} className={cn(control, 'h-9 pointer-coarse:h-11 px-3', quiet && quietControl, className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, rows = 4, ...rest }, ref) {
  return <textarea ref={ref} rows={rows} className={cn(control, 'min-h-[72px] resize-y px-3 py-2 leading-relaxed', className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { quiet?: boolean }>(function Select({ className, children, quiet, ...rest }, ref) {
  return (
    <div className={cn('group/select relative', className)}>
      <select ref={ref} className={cn(control, 'h-9 pointer-coarse:h-11 appearance-none pl-3 pr-8', quiet && quietControl, quiet && 'pr-7 text-ellipsis')} {...rest}>
        {children}
      </select>
      <ChevronDown
        className={cn(
          'pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted',
          quiet && 'text-subtle opacity-0 transition-opacity group-focus-within/select:opacity-100 group-hover/select:opacity-100 pointer-coarse:opacity-100',
        )}
        aria-hidden="true"
      />
    </div>
  );
});

interface FieldProps {
  label: ReactNode;
  error?: string;
  hint?: ReactNode;
  required?: boolean;
  className?: string;
  /** Render prop receives the generated id and aria props for the control. */
  children: (props: { id: string; 'aria-invalid': boolean; 'aria-describedby'?: string }) => ReactNode;
}

/** Label + control + hint/error, wired up for screen readers. */
export function Field({ label, error, hint, required, className, children }: FieldProps) {
  const id = useId();
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={id} className="block text-[13px] font-medium text-ink">
        {label}
        {required && (
          <span className="ml-0.5 text-danger" aria-hidden="true">
            *
          </span>
        )}
      </label>
      {children({ id, 'aria-invalid': !!error, 'aria-describedby': describedBy })}
      {error ? (
        <p id={`${id}-error`} className="text-[12.5px] font-medium text-danger" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-[12.5px] leading-snug text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function FormError({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <div role="alert" className="rounded-md border border-danger/25 bg-danger-soft px-3 py-2.5 text-[13px] font-medium text-danger">
      {message}
    </div>
  );
}
