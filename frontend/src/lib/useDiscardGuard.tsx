import { useEffect, useState, type ReactNode } from 'react';
import { ConfirmDialog } from '@/components/ui/Dialog';

/**
 * Closing a form with unsaved changes asks first ("Discard your changes?"), whether it's closed
 * with Cancel, the × button, Escape or a click outside. While there are changes, leaving or
 * reloading the page asks too (the browser's own prompt).
 */
export function useDiscardGuard(
  dirty: boolean,
  close: () => void,
  what = 'your changes',
): { requestClose: () => void; onOpenChange: (open: boolean) => void; prompt: ReactNode } {
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Older browsers need a return value to show the prompt.
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const requestClose = () => (dirty ? setAsking(true) : close());
  return {
    requestClose,
    onOpenChange: (open: boolean) => {
      if (!open) requestClose();
    },
    prompt: (
      <ConfirmDialog
        open={asking}
        onOpenChange={setAsking}
        title="Discard your changes?"
        description={`You haven’t saved ${what}. If you close now, they’ll be lost.`}
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        onConfirm={() => {
          setAsking(false);
          close();
        }}
      />
    ),
  };
}
