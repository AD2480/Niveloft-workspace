import { lazy, Suspense, useEffect, useState } from 'react';
import { useContactState } from './contactStore';

const ContactDialog = lazy(() => import('./ContactDialog').then((m) => ({ default: m.ContactDialog })));

/** Mounted once for the whole site; the form's code loads the first time someone opens it. */
export function ContactLayer() {
  const { open } = useContactState();
  const [wanted, setWanted] = useState(open);
  useEffect(() => {
    if (open) setWanted(true);
  }, [open]);
  if (!wanted) return null;
  return (
    <Suspense fallback={null}>
      <ContactDialog />
    </Suspense>
  );
}
