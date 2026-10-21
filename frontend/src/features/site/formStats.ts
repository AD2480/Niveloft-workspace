import type { FormStats } from '@/api/types';

/** What each counted form is called on screen. */
export const FORM_LABEL: Record<string, string> = {
  'sign-in': 'Log in',
  'sign-up': 'Create account',
  'forgot-password': 'Forgot password',
  'reset-password': 'New password',
  contact: 'Contact',
  project: 'Project',
  task: 'Task',
  milestone: 'Milestone',
  invite: 'Invite',
  'submit-work': 'Submit work',
  review: 'Review',
  profile: 'Profile',
  password: 'Change password',
  comment: 'Comment',
};

/** successes ÷ sends, or null when nothing was sent. */
export function successRate(f: Pick<FormStats, 'submits' | 'successes'>): number | null {
  return f.submits > 0 ? Math.min(1, f.successes / f.submits) : null;
}

/** successes ÷ times shown: how many people who saw the form got it done. */
export function completionRate(f: Pick<FormStats, 'views' | 'successes'>): number | null {
  return f.views > 0 ? Math.min(1, f.successes / f.views) : null;
}
