import { useSyncExternalStore } from 'react';
import type { ContactTopic } from '@/api/types';

export const TOPICS: { value: ContactTopic; label: string }[] = [
  { value: 'QUESTION', label: 'A question' },
  { value: 'PROBLEM', label: 'Something isn’t working' },
  { value: 'DATA', label: 'My account or my data' },
  { value: 'FEEDBACK', label: 'Feedback or an idea' },
  { value: 'OTHER', label: 'Something else' },
];

/** Opens the contact form from anywhere: the floating button, the footer, an error's reference, the menu. */
export interface ContactPreset {
  topic?: ContactTopic;
  /** An error reference to include (request id). */
  reference?: string | null;
  message?: string;
}

let state: { open: boolean; preset: ContactPreset } = { open: false, preset: {} };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function openContact(preset: ContactPreset = {}): void {
  state = { open: true, preset };
  emit();
}

export function closeContact(): void {
  state = { ...state, open: false };
  emit();
}

export function useContactState() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => state,
  );
}
