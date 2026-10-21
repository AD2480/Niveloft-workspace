import { Printer } from 'lucide-react';
import { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { Button } from '@/components/ui/Button';
import type { ButtonSize, ButtonVariant } from '@/components/ui/buttonStyles';
import { onBeforePrint } from '@/lib/print';

/**
 * Shown only on paper, at the top of the first page: the site, the page's title, its address
 * and when it was printed, so a printout can be traced back to where it came from.
 */
export function PrintHeader() {
  const [info, setInfo] = useState<{ title: string; url: string; at: string } | null>(null);
  useEffect(
    () =>
      onBeforePrint(() => {
        // flushSync: the browser takes its print snapshot straight after this event.
        flushSync(() =>
          setInfo({
            title: document.title,
            url: window.location.href.replace(/[?#].*$/, ''),
            at: new Date().toLocaleString(undefined, { dateStyle: 'long', timeStyle: 'short' }),
          }),
        );
      }),
    [],
  );
  return (
    <div data-print="only" className="border-b border-black/30 pb-2 text-[9pt] text-black">
      <p className="font-semibold">{info?.title ?? 'Niveloft'}</p>
      <p>{info?.url ?? ''}</p>
      {info && <p>Printed {info.at}</p>}
    </div>
  );
}

/** Opens the browser's print dialog; the print stylesheet does the rest. */
export function PrintButton({ label = 'Print', variant = 'secondary', size = 'sm', className }: { label?: string; variant?: ButtonVariant; size?: ButtonSize; className?: string }) {
  return (
    <Button variant={variant} size={size} leftIcon={<Printer aria-hidden="true" />} onClick={() => window.print()} data-print="hide" className={className}>
      {label}
    </Button>
  );
}
