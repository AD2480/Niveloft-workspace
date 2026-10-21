import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { buttonClass, type ButtonSize as Size, type ButtonVariant as Variant } from './buttonStyles';
import { Spinner } from './Spinner';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading = false, leftIcon, rightIcon, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(buttonClass(variant, size), 'relative disabled:cursor-not-allowed disabled:opacity-55', className)}
      {...rest}
    >
      {/* While loading, the label stays in place (hidden) under the spinner, so the button keeps its size. */}
      <span className={cn('contents', loading && 'invisible')} aria-hidden={loading || undefined}>
        {leftIcon}
        {children}
        {rightIcon}
      </span>
      {loading && (
        <span className="absolute inset-0 flex items-center justify-center">
          <Spinner className="size-4" />
          {/* The hidden label is taken out of the accessibility tree, so the name is given once, here. */}
          <span className="sr-only">{typeof children === 'string' ? children : 'Working'}</span>
        </span>
      )}
    </button>
  );
});
