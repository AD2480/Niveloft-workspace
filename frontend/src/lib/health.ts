import type { Health, ProjectStatus } from '@/api/types';
import { differenceInCalendarDays } from 'date-fns';
import { parseLocalDate } from './dates';

/**
 * Project health indicator.
 *
 * Health is derived only from stored records (task statuses, due dates and the
 * project's start date and deadline). The rules are evaluated top to bottom and
 * the first matching level wins. The backend implements the same rules in
 * `ProjectHealthCalculator`, and the UI displays {@link HEALTH_RULES} so users
 * can see exactly why a project has its status.
 */
export const HEALTH_THRESHOLDS = {
  /** Points behind the expected progress that make a project At risk. */
  atRiskGap: 10,
  /** Points behind the expected progress that make a project Off track. */
  offTrackGap: 25,
  /** Share of open tasks that are overdue that makes a project Off track. */
  offTrackOverdueShare: 0.25,
  /** Days before the deadline when the "finish line" check starts. */
  deadlineWindowDays: 7,
  /** Progress required once inside the deadline window. */
  deadlineWindowProgress: 80,
} as const;

export const HEALTH_RULES: { level: Health; rules: string[] }[] = [
  {
    level: 'COMPLETED',
    rules: ['The project status is Completed, or every task is Done.'],
  },
  {
    level: 'NOT_STARTED',
    rules: ['The project has no tasks yet.'],
  },
  {
    level: 'OFF_TRACK',
    rules: [
      'The deadline has passed and tasks are still open, or',
      `at least ${HEALTH_THRESHOLDS.offTrackOverdueShare * 100}% of open tasks are overdue, or`,
      `progress is more than ${HEALTH_THRESHOLDS.offTrackGap} points behind the expected progress.`,
    ],
  },
  {
    level: 'AT_RISK',
    rules: [
      'At least one task is overdue, or',
      `progress is more than ${HEALTH_THRESHOLDS.atRiskGap} points behind the expected progress, or`,
      `the deadline is within ${HEALTH_THRESHOLDS.deadlineWindowDays} days and progress is below ${HEALTH_THRESHOLDS.deadlineWindowProgress}%.`,
    ],
  },
  {
    level: 'ON_TRACK',
    rules: ['None of the conditions above apply.'],
  },
];

export const PROGRESS_DEFINITION =
  'Progress = tasks in Done ÷ all tasks in the project. Expected progress = days elapsed since the start date ÷ total days between the start date and the deadline.';

export interface HealthInput {
  projectStatus: ProjectStatus;
  startDate: string;
  deadline: string | null;
  total: number;
  done: number;
  overdue: number;
  today?: Date;
}

export interface HealthResult {
  health: Health;
  progress: number;
  expectedProgress: number | null;
  reasons: string[];
}

export function calculateProgress(done: number, total: number): number {
  return total === 0 ? 0 : Math.round((done / total) * 100);
}

export function calculateExpectedProgress(startDate: string, deadline: string | null, today: Date = new Date()): number | null {
  if (!deadline) return null;
  const start = parseLocalDate(startDate);
  const end = parseLocalDate(deadline);
  const totalDays = differenceInCalendarDays(end, start);
  if (totalDays <= 0) return 100;
  const elapsed = differenceInCalendarDays(today, start);
  return Math.max(0, Math.min(100, Math.round((elapsed / totalDays) * 100)));
}

export function calculateHealth(input: HealthInput): HealthResult {
  const today = input.today ?? new Date();
  const { total, done, overdue } = input;
  const open = total - done;
  const progress = calculateProgress(done, total);
  const expectedProgress = calculateExpectedProgress(input.startDate, input.deadline, today);
  const t = HEALTH_THRESHOLDS;

  if (input.projectStatus === 'COMPLETED' || (total > 0 && open === 0)) {
    return { health: 'COMPLETED', progress, expectedProgress, reasons: ['All work is complete.'] };
  }
  if (total === 0) {
    return { health: 'NOT_STARTED', progress, expectedProgress, reasons: ['No tasks have been created yet.'] };
  }

  const daysLeft = input.deadline ? differenceInCalendarDays(parseLocalDate(input.deadline), today) : null;
  const gap = expectedProgress === null ? 0 : expectedProgress - progress;

  const offTrack: string[] = [];
  if (daysLeft !== null && daysLeft < 0) {
    offTrack.push(`The deadline passed ${-daysLeft} day${daysLeft === -1 ? '' : 's'} ago with ${open} open task${open === 1 ? '' : 's'}.`);
  }
  if (open > 0 && overdue / open >= t.offTrackOverdueShare) {
    offTrack.push(`${overdue} of ${open} open tasks (${Math.round((overdue / open) * 100)}%) are overdue.`);
  }
  if (gap > t.offTrackGap) {
    offTrack.push(`Progress is ${progress}% but ${expectedProgress}% was expected by today (${gap} points behind).`);
  }
  if (offTrack.length > 0) return { health: 'OFF_TRACK', progress, expectedProgress, reasons: offTrack };

  const atRisk: string[] = [];
  if (overdue > 0) atRisk.push(`${overdue} task${overdue === 1 ? ' is' : 's are'} overdue.`);
  if (gap > t.atRiskGap) {
    atRisk.push(`Progress is ${progress}% but ${expectedProgress}% was expected by today (${gap} points behind).`);
  }
  if (daysLeft !== null && daysLeft <= t.deadlineWindowDays && progress < t.deadlineWindowProgress) {
    atRisk.push(`The deadline is in ${daysLeft} day${daysLeft === 1 ? '' : 's'} and progress is ${progress}%.`);
  }
  if (atRisk.length > 0) return { health: 'AT_RISK', progress, expectedProgress, reasons: atRisk };

  const reasons = ['No overdue tasks.'];
  if (expectedProgress !== null) reasons.push(`Progress ${progress}% vs ${expectedProgress}% expected.`);
  return { health: 'ON_TRACK', progress, expectedProgress, reasons };
}
