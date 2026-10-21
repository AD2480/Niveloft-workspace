import { cn } from '@/lib/cn';

/**
 * The Niveloft symbol: a peak drawn as three layers of snow, the cap on top and two settled layers
 * beneath it, with a clear gap between each (the way Niveloft reads a project: in layers). The gaps
 * keep the three parts readable at favicon size, even in one colour.
 *
 * Paths live here and in public/favicon.svg (keep them in step).
 */
export const MARK_PATHS = {
  /** The cap: fresh snow at the top. */
  cap: 'M16 3.2 20.1 10.4H11.9z',
  /** The middle layer. */
  middle: 'M10.9 12.2H21.1L24.9 18.8H7.1z',
  /** The base: the firmest, widest layer. */
  base: 'M6.1 20.6H25.9L29.6 27.2H2.4z',
} as const;

export function LogoMark({ className, inverted = false, mono = false }: { className?: string; inverted?: boolean; mono?: boolean }) {
  // `inverted` is for always-dark backgrounds in either theme; `mono` draws every layer in one colour.
  const ink = inverted ? '#f2f5f8' : 'var(--ink)';
  const cap = mono ? ink : inverted ? '#9ccbea' : 'var(--accent)';
  return (
    <svg viewBox="0 0 32 32" className={cn('size-8', className)} aria-hidden="true" data-logo-mark="">
      <path d={MARK_PATHS.cap} fill={cap} strokeLinejoin="round" />
      <path d={MARK_PATHS.middle} fill={ink} />
      <path d={MARK_PATHS.base} fill={ink} />
    </svg>
  );
}

/**
 * The wordmark: "niveloft" in Archivo, set a little wide, lowercase, with one detail: the dot of the
 * i is a small diamond in glacier blue, a flake landing.
 */
export function Wordmark({ className, inverted = false }: { className?: string; inverted?: boolean }) {
  return (
    <span
      className={cn('relative inline-flex items-baseline font-wide text-[19px] leading-none font-bold tracking-[-0.025em] [font-stretch:112%]', inverted ? 'text-[#f2f5f8]' : 'text-ink', className)}
      aria-label="Niveloft"
      role="img"
      data-wordmark=""
    >
      <span aria-hidden="true">n</span>
      <span aria-hidden="true" className="relative">
        {/* Dotless i with a diamond for its dot. */}
        ı
        <span
          className={cn('absolute left-1/2 top-[-0.03em] size-[0.21em] -translate-x-1/2 rotate-45 rounded-[1px]', inverted ? 'bg-[#9ccbea]' : 'bg-accent')}
          aria-hidden="true"
        />
      </span>
      <span aria-hidden="true">veloft</span>
    </span>
  );
}

export function Logo({ collapsed = false, className, inverted = false }: { collapsed?: boolean; className?: string; inverted?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <LogoMark className="size-7" inverted={inverted} />
      {!collapsed && <Wordmark inverted={inverted} />}
    </span>
  );
}
