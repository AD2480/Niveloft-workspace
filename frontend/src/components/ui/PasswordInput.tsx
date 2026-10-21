import { Eye, EyeOff } from 'lucide-react';
import { forwardRef, useState, type InputHTMLAttributes, type KeyboardEvent } from 'react';
import { cn } from '@/lib/cn';
import { Input } from './Form';

/** Password field with show/hide, and a warning while Caps Lock is on. */
export const PasswordInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function PasswordInput(
  { className, onKeyDown, onKeyUp, onBlur, ...rest },
  ref,
) {
  const [visible, setVisible] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const readCaps = (e: KeyboardEvent<HTMLInputElement>) => setCapsLock(typeof e.getModifierState === 'function' && e.getModifierState('CapsLock'));
  return (
    <div>
      <div className="relative">
        <Input
          ref={ref}
          type={visible ? 'text' : 'password'}
          className={cn('pr-10', className)}
          onKeyDown={(e) => {
            readCaps(e);
            onKeyDown?.(e);
          }}
          onKeyUp={(e) => {
            readCaps(e);
            onKeyUp?.(e);
          }}
          onBlur={(e) => {
            setCapsLock(false);
            onBlur?.(e);
          }}
          {...rest}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-lg text-muted hover:text-ink"
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
        >
          {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
      {capsLock && (
        <p className="mt-1.5 text-xs text-warning" role="status">
          Caps Lock is on.
        </p>
      )}
    </div>
  );
});
