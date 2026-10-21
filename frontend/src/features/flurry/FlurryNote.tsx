import { X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router';
import { buttonClass } from '@/components/ui/buttonStyles';
import { cn } from '@/lib/cn';
import { clearFlurryCue, type FlurryCue } from './flurryCues';

/**
 * Flurry's note: a short speech bubble beside it, with at most two actions (Open · Not now). It
 * appears when you ask for something (My next task, selecting a milestone) and, only if you turned
 * that on, when something needs you. Escape or Not now closes it; closing changes nothing.
 */
export function FlurryNote({ cue, side, above, compact }: { cue: FlurryCue; side: 'left' | 'right'; above: boolean; compact: boolean }) {
  const navigate = useNavigate();
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      // A dialog or menu on top gets Escape first.
      if (document.querySelector('[role="dialog"]:not([data-assistant-panel]), [role="menu"]')) return;
      clearFlurryCue(cue.id, true);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [cue.id]);

  const actions = cue.actions?.length ? cue.actions : [];
  const hasDismiss = actions.some((x) => !x.to && !x.onSelect);
  return (
    <section
      ref={ref}
      aria-label="Flurry’s note"
      data-flurry-note={cue.id}
      className={cn(
        'absolute z-10 w-[min(300px,calc(100vw-32px))] rounded-xl border bg-surface px-3.5 py-3 text-left shadow-float animate-rise-in',
        cue.tone === 'attention' ? 'border-warning/50' : 'border-line',
        compact ? 'right-0 bottom-full mb-3' : side === 'left' ? 'right-full mr-3' : 'left-full ml-3',
        !compact && (above ? 'bottom-1' : 'top-1'),
      )}
    >
      {/* The little tail pointing back at Flurry. */}
      {!compact && (
        <span
          aria-hidden="true"
          className={cn('absolute size-3 rotate-45 border bg-surface', cue.tone === 'attention' ? 'border-warning/50' : 'border-line', side === 'left' ? '-right-[7px] border-b-0 border-l-0' : '-left-[7px] border-t-0 border-r-0', above ? 'bottom-5' : 'top-5')}
        />
      )}
      <div className="relative">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1" role="status">
            {cue.title && <p className="font-mono text-[12px] font-medium text-muted">{cue.title}</p>}
            <p className="mt-0.5 text-[13.5px] leading-snug text-ink">{cue.text}</p>
          </div>
          <button
            type="button"
            onClick={() => clearFlurryCue(cue.id, true)}
            className="-mt-1 -mr-1.5 flex size-7 shrink-0 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-ink"
            aria-label="Close Flurry’s note"
          >
            <X className="size-3.5" aria-hidden="true" />
          </button>
        </div>
        {actions.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-2">
            {actions.map((x) => (
              <button
                key={x.label}
                type="button"
                className={buttonClass(x.primary ? 'primary' : 'secondary', 'sm')}
                onClick={() => {
                  clearFlurryCue(cue.id, !x.to && !x.onSelect);
                  x.onSelect?.();
                  if (x.to) navigate(x.to);
                }}
              >
                {x.label}
              </button>
            ))}
            {!hasDismiss && actions.some((x) => x.to || x.onSelect) && (
              <button type="button" className={buttonClass('ghost', 'sm')} onClick={() => clearFlurryCue(cue.id, true)}>
                Not now
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
