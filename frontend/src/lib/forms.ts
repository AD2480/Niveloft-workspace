import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { z } from 'zod';
import { getErrorMessage, getFieldErrors } from '@/api/errors';

/**
 * Copy server-side field errors (400/409 responses) onto the form fields.
 * Returns the general message to show above the form when no field matched.
 */
export function applyServerErrors<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  fields: readonly Path<T>[],
  /** Server field name → form field name, where they differ (e.g. estimateDays → estimate). */
  aliases: Record<string, Path<T>> = {},
): string | null {
  const fieldErrors = getFieldErrors(error);
  let matched = false;
  for (const [serverField, message] of Object.entries(fieldErrors)) {
    const field = aliases[serverField] ?? serverField;
    if ((fields as readonly string[]).includes(field)) {
      setError(field as Path<T>, { type: 'server', message });
      matched = true;
    }
  }
  return matched ? null : getErrorMessage(error);
}

// Shared validation rules, matching the backend's Bean Validation constraints.
export const rules = {
  password: z
    .string()
    .min(1, 'Password is required.')
    .min(8, 'Password must be at least 8 characters.')
    .max(72, 'Password must be at most 72 characters.')
    .regex(/[A-Za-z]/, 'Password must contain at least one letter and one number.')
    .regex(/\d/, 'Password must contain at least one letter and one number.')
    // BCrypt uses at most 72 bytes; accents and emoji take 2–4 bytes each.
    .refine((v) => new TextEncoder().encode(v).length <= 72, 'Password is too long: at most 72 bytes (fewer characters if it has accents or emoji).'),
  name: z
    .string()
    .trim()
    .min(1, 'Name is required.')
    .min(2, 'Name must be at least 2 characters.')
    .max(80, 'Name must be at most 80 characters.')
    .regex(/^[^<>\p{Cc}]*$/u, 'Name can’t contain < or > or control characters.'),
  email: z.string().trim().min(1, 'Email is required.').max(254, 'Enter a valid email address.').email('Enter a valid email address.'),
  optionalDate: z
    .string()
    .trim()
    .refine((v) => v === '' || /^\d{4}-\d{2}-\d{2}$/.test(v), 'Enter a valid date.'),
};

/** 0–4 score used by the password strength meter. */
export function passwordStrength(pw: string): { score: number; label: string } {
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) score++;
  const labels = ['Too weak', 'Weak', 'Fair', 'Good', 'Strong'];
  return { score, label: labels[score] };
}

/** Suggest a key from the name: initials of up to 4 words, or the first 3 letters. */
export function suggestKey(name: string): string {
  const words = name
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return '';
  const key = words.length >= 2 ? words.slice(0, 4).map((w) => w[0]).join('') : words[0].slice(0, 3);
  return /^[A-Z]/.test(key) ? key : `P${key}`.slice(0, 6);
}
