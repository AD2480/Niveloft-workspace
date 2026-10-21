import { useEffect, useMemo, useRef } from 'react';
import { failureKind, trackForm, type TrackedForm } from './formMetrics';

export interface FormTracker {
  /** The form's own checks passed and it's being sent. */
  submitted: () => void;
  /** The form's own checks stopped it (counts as a send attempt too). */
  invalid: () => void;
  succeeded: () => void;
  /** The server refused it or the request failed. */
  failed: (error: unknown) => void;
}

/**
 * Counts a form's views, sends, successes and failures for the operator's success rates (see
 * lib/formMetrics). `shown` is false while the form isn't on screen (a closed dialog).
 */
export function useTrackedForm(form: TrackedForm, shown = true): FormTracker {
  // Once per time the form is shown (StrictMode's double effect in development counts once).
  const counted = useRef(false);
  useEffect(() => {
    if (!shown) {
      counted.current = false;
      return;
    }
    if (counted.current) return;
    counted.current = true;
    trackForm(form, 'view');
  }, [form, shown]);
  return useMemo(
    () => ({
      submitted: () => trackForm(form, 'submit'),
      invalid: () => {
        trackForm(form, 'submit');
        trackForm(form, 'invalid');
      },
      succeeded: () => trackForm(form, 'success'),
      failed: (error: unknown) => trackForm(form, failureKind(error)),
    }),
    [form],
  );
}
