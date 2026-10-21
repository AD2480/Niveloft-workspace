import { cn } from '@/lib/cn';

interface ProgressBarProps {
  value: number;
  /** Optional marker for where progress should be (e.g. expected progress). */
  marker?: number | null;
  className?: string;
  color?: string;
  size?: 'sm' | 'md';
  label?: string;
}

export function ProgressBar({ value, marker, className, color, size = 'sm', label = 'Progress' }: ProgressBarProps) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div
      className={cn('relative w-full overflow-visible rounded-full bg-surface-3', size === 'sm' ? 'h-1.5' : 'h-2.5', className)}
      role="progressbar"
      aria-label={label}
      aria-valuenow={v}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className="h-full rounded-full bg-brand transition-[width] duration-500" style={{ width: `${v}%`, backgroundColor: color }} />
      {marker != null && (
        <div
          className="absolute -top-1 -bottom-1 w-0.5 rounded-full bg-ink/60"
          style={{ left: `calc(${Math.max(0, Math.min(100, marker))}% - 1px)` }}
          title={`Expected: ${marker}%`}
          aria-hidden="true"
        />
      )}
    </div>
  );
}

/** Circular progress ring with a centred percentage. */
export function ProgressRing({ value, size = 56, stroke = 6, color = 'var(--brand)' }: { value: number; size?: number; stroke?: number; color?: string }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }} role="img" aria-label={`${v}% complete`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-3)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c - (v / 100) * c}
          className="transition-[stroke-dashoffset] duration-700"
        />
      </svg>
      <span className="absolute text-[13px] font-semibold text-ink tabular">{v}%</span>
    </div>
  );
}
