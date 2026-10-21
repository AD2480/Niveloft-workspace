import { WifiOff } from 'lucide-react';
import { useSyncExternalStore } from 'react';

function subscribe(onChange: () => void) {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}

/**
 * A bar across the top while the device is offline. Pages already loaded stay readable; changes
 * can't be saved, and data refreshes by itself when the connection returns.
 */
export function OfflineBanner() {
  const online = useSyncExternalStore(subscribe, () => navigator.onLine, () => true);
  if (online) return null;
  return (
    <div role="status" data-print="hide" className="fixed inset-x-0 top-0 z-[90] flex items-center justify-center gap-2 bg-ink px-4 py-2 text-center text-[13px] text-canvas">
      <WifiOff className="size-4 shrink-0" aria-hidden="true" />
      You’re offline. You can keep reading; changes can’t be saved until you’re back, and everything refreshes when you are.
    </div>
  );
}
