import { useEffect, useRef, useState } from 'react';
import { useSelector } from 'react-redux';
import type { RootState } from '@/app/store';

/**
 * A thin bar across the top of the window whenever data is loading. Quick loads (under about
 * 150 ms) show nothing; slower ones show the bar creeping along, which then fills and fades
 * when everything has arrived. Screen readers aren't told: each page announces its own loading.
 */
export function NetworkActivityBar() {
  const busy = useSelector((s: RootState) => Object.values(s.api.queries).some((q) => q?.status === 'pending'));
  const [phase, setPhase] = useState<'idle' | 'loading' | 'done'>('idle');
  const shownAt = useRef(0);

  useEffect(() => {
    if (busy) {
      shownAt.current = performance.now();
      setPhase('loading');
      return;
    }
    if (phase !== 'loading') return;
    // Only animate the finish if the bar had time to appear (its CSS waits 150 ms).
    if (performance.now() - shownAt.current < 160) {
      setPhase('idle');
      return;
    }
    setPhase('done');
    const t = window.setTimeout(() => setPhase('idle'), 420);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy]);

  if (phase === 'idle') return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[80] h-[2px]" data-print="hide" data-loading-bar={phase} aria-hidden="true">
      {phase === 'loading' ? (
        <div className="h-full origin-left bg-accent animate-route-progress" />
      ) : (
        <div className="h-full origin-left bg-accent animate-bar-finish" />
      )}
    </div>
  );
}
