import { cn } from '@/lib/cn';

export function Spinner({ className, label }: { className?: string; label?: string }) {
  return (
    <svg className={cn('size-5 animate-spin text-current', className)} viewBox="0 0 24 24" fill="none" role={label ? 'status' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <circle cx="12" cy="12" r="9.5" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M21.5 12a9.5 9.5 0 0 0-9.5-9.5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/**
 * A thin bar across the top of the window while a page is loading. It waits 150 ms before
 * appearing (fast loads show nothing), then creeps towards the end without ever claiming to be done.
 */
export function TopLoadingBar() {
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[80] h-[2px]" data-print="hide" data-loading-bar="" aria-hidden="true">
      <div className="h-full origin-left bg-accent animate-route-progress" />
    </div>
  );
}

/** What a page shows while its code or data loads: the top bar and the page's rough shape. */
export function PageSpinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6 lg:px-10 lg:py-10" role="status" aria-label={label}>
      <TopLoadingBar />
      <div className="space-y-3 border-b border-line pb-7">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-10 w-80 max-w-full" />
        <Skeleton className="h-3 w-full max-w-lg" />
      </div>
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-36 rounded-lg" />
        ))}
      </div>
      <span className="sr-only">{label}…</span>
    </div>
  );
}

/** A placeholder block with a soft shimmer (a gentle pulse when motion is reduced). */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton rounded-md', className)} aria-hidden="true" />;
}
