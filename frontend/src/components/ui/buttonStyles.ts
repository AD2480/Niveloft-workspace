import { cn } from '@/lib/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline' | 'link';
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg' | 'icon' | 'icon-sm';

const variants: Record<ButtonVariant, string> = {
  // Glacier blue with white text (ice blue with night text in the dark theme): the one dominant action.
  // A hairline of light along the top edge and a soft contact shadow make it read as pressable.
  primary:
    'bg-brand text-white dark:text-canvas hover:bg-brand-hover disabled:hover:bg-brand ' +
    'shadow-[inset_0_1px_0_rgb(255_255_255/0.14),0_1px_2px_hsl(var(--shadow-color)/0.24)] dark:shadow-[inset_0_1px_0_rgb(255_255_255/0.35)]',
  secondary:
    'bg-surface text-ink border border-line-strong shadow-card hover:bg-surface-2 hover:border-[color-mix(in_srgb,var(--ink)_28%,var(--line-strong))]',
  outline: 'border border-line-strong text-ink hover:bg-surface-2 hover:border-[color-mix(in_srgb,var(--ink)_28%,var(--line-strong))]',
  ghost: 'text-ink-2 hover:bg-surface-3/70 hover:text-ink',
  danger: 'bg-danger text-white hover:bg-[color-mix(in_srgb,var(--danger)_88%,black)] dark:text-canvas dark:hover:bg-[color-mix(in_srgb,var(--danger)_88%,white)]',
  link: 'text-accent hover:underline underline-offset-4 !px-0 !h-auto !rounded-none',
};

/*
 * Sentence-case labels. Everyday buttons are 36px with a mouse and 44px on touch screens; lg (44px)
 * is for the one main action of a page or form; sm and xs are for dense rows and toolbars.
 */
const sizes: Record<ButtonSize, string> = {
  xs: 'h-7 px-2.5 text-[12.5px] gap-1 rounded-md',
  sm: 'h-8 px-3 text-[13px] gap-1.5 rounded-md',
  md: 'h-9 pointer-coarse:min-h-11 px-3.5 text-[13.5px] gap-2 rounded-md',
  lg: 'h-11 px-5 text-[14.5px] gap-2 rounded-lg',
  icon: 'h-9 w-9 pointer-coarse:min-h-11 pointer-coarse:min-w-11 rounded-md',
  'icon-sm': 'h-8 w-8 rounded-md',
};

/** Button styling for elements that aren't <button>, e.g. a router <Link> that looks like a button. */
export function buttonClass(variant: ButtonVariant = 'primary', size: ButtonSize = 'md', className?: string): string {
  return cn(
    // Hover changes colour; pressing settles the button a pixel, so a click is felt.
    'inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap select-none',
    'transition-[color,background-color,border-color,box-shadow,opacity,transform] duration-150 ease-out active:not-disabled:translate-y-px',
    '[&_svg]:size-4 [&_svg]:shrink-0',
    sizes[size],
    variants[variant],
    className,
  );
}
