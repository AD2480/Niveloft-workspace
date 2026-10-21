import { Cpu } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/cn';
import { enableBrowserAi } from './browserAi';
import { useBrowserAi } from './useBrowserAi';

/**
 * Offers to turn on the AI built into Chrome when the server has none. It runs on this device,
 * free, and the project's records never leave it. Chrome downloads the model once, after a click.
 */
export function BrowserAiOffer({ className }: { className?: string }) {
  const { availability, progress, error } = useBrowserAi();
  const [starting, setStarting] = useState(false);
  if (availability !== 'downloadable' && availability !== 'downloading') return null;
  const downloading = availability === 'downloading' || starting;
  const pct = progress === null ? null : Math.round(progress * 100);

  return (
    <div className={cn('rounded-lg border border-line bg-surface-2 px-3.5 py-3', className)}>
      <p className="flex items-center gap-2 text-[13px] font-medium text-ink">
        <Cpu className="size-4 text-accent" aria-hidden="true" /> Turn on AI in this browser
      </p>
      <p className="mt-1 text-[12px] leading-relaxed text-muted">
        Chrome can run Google’s Gemini Nano on this computer: free, no account, and this project’s records never leave it. Chrome downloads the model once (a few GB, and it
        needs about 22 GB free).
      </p>
      {downloading ? (
        <div className="mt-2.5" role="status">
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-3" aria-hidden="true">
            <div className="h-full bg-brand transition-[width]" style={{ width: `${pct ?? 5}%` }} />
          </div>
          <p className="mt-1 text-[12px] text-muted tabular">{pct === null ? 'Starting the download…' : `Downloading the model: ${pct}%.`} You can keep working.</p>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            setStarting(true);
            // Straight from the click: Chrome starts the download only in response to one.
            void enableBrowserAi().finally(() => setStarting(false));
          }}
          className="mt-2.5 inline-flex h-8 items-center rounded-md bg-brand px-3 text-[12.5px] font-medium text-white hover:bg-brand-hover dark:text-canvas"
        >
          Turn on
        </button>
      )}
      {error && (
        <p className="mt-2 text-[12px] text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
