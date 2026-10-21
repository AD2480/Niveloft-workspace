import { RefreshCw } from 'lucide-react';
import { useEffect, useReducer } from 'react';
import { cn } from '@/lib/cn';
import { freshness } from '@/lib/freshness';


/**
 * When the data on screen was fetched, kept current ("Updated 3 min ago"), with a refresh button.
 * Live updates refresh most pages by themselves; this shows how fresh the numbers are.
 */
export function LastUpdated({ at, onRefresh, refreshing = false, className, label = 'Updated' }: { at: number | undefined; onRefresh?: () => void; refreshing?: boolean; className?: string; label?: string }) {
  const [, tick] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    const t = window.setInterval(tick, 30_000);
    return () => window.clearInterval(t);
  }, []);
  if (!at) return null;
  const exact = new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  return (
    <p className={cn('flex items-center gap-1.5 text-xs text-muted', className)} data-last-updated="">
      <span>
        {label}{' '}
        <time dateTime={new Date(at).toISOString()} title={exact}>
          {freshness(at)}
        </time>
      </span>
      {onRefresh && (
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          data-print="hide"
          className="flex size-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-2 hover:text-ink disabled:cursor-wait"
          aria-label={refreshing ? 'Refreshing' : 'Refresh now'}
          title="Refresh now"
        >
          <RefreshCw className={cn('size-3.5', refreshing && 'animate-spin')} aria-hidden="true" />
        </button>
      )}
    </p>
  );
}
