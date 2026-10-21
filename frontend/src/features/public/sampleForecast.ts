import type { Member, Role } from '@/api/types';
import { projectBlocker, type ProjectBlocker } from '@/lib/forecastText';
import { forecastProgress, type ProgressForecast } from '@/lib/progressForecast';
import type { ProjectModel } from '@/three/projectModel';
import { modelFromData, ONBOARDING_SAMPLE, sampleProjectData, type SampleProjectData, type SampleSpec } from './sampleProject';

/** The sample's people as project members, with their roles in the sample project. */
const ROLE_OF: Record<string, Role> = { aarav: 'OWNER', priya: 'MANAGER', rohan: 'MEMBER', sneha: 'MEMBER', ananya: 'MEMBER', kabir: 'MEMBER' };

export function sampleMembers(spec: SampleSpec = ONBOARDING_SAMPLE): Member[] {
  return Object.entries(spec.people).map(([k, p]) => {
    const { role: _jobTitle, ...user } = p;
    return { id: p.id, user: { ...user, jobTitle: p.role }, role: ROLE_OF[k] ?? 'MEMBER', joinedAt: '', openTaskCount: 0 };
  });
}

/** What visitors can change on the front page, to see the forecast respond. */
export interface SampleAssumptions {
  /** Ananya, whose own work is nearly done, takes ONB-10 from Rohan (who has three tasks in a row). */
  ananyaTakesOnb10: boolean;
  /** Priya, who runs the beta test at the end, has half her time for this project. */
  priyaHalfTime: boolean;
  /** New scope: localise the welcome screens (3 days, Ananya), and the beta test waits for it. */
  addLocalisation: boolean;
}

export const NO_CHANGES: SampleAssumptions = { ananyaTakesOnb10: false, priyaHalfTime: false, addLocalisation: false };

export interface SampleForecast {
  data: SampleProjectData;
  model: ProjectModel;
  forecast: ProgressForecast;
  blocker: ProjectBlocker | null;
  members: Member[];
}

const cache = new Map<string, { at: number; value: SampleForecast }>();

/**
 * The same forecast, worked out once per set of assumptions and reused for ten minutes: the front
 * page shows the sample as it is in four places (its readings, the playground, the role views), and
 * the simulation is the heaviest thing on the page.
 */
export function sampleForecastShared(a: SampleAssumptions = NO_CHANGES): SampleForecast {
  const key = `${+a.ananyaTakesOnb10}${+a.priyaHalfTime}${+a.addLocalisation}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.value;
  const value = sampleForecast(a);
  cache.set(key, { at: Date.now(), value });
  return value;
}

/** The sample project, changed by the visitor's assumptions, and its forecast (the app's own engine). */
export function sampleForecast(a: SampleAssumptions = NO_CHANGES, now: Date = new Date()): SampleForecast {
  const spec: SampleSpec = {
    ...ONBOARDING_SAMPLE,
    tasks: ONBOARDING_SAMPLE.tasks.map((t) => {
      if (a.ananyaTakesOnb10 && t.n === 10) return { ...t, who: 'ananya' };
      if (a.addLocalisation && t.n === 14) return { ...t, waitsOn: [...(t.waitsOn ?? []), 18] };
      return t;
    }),
  };
  if (a.addLocalisation) {
    spec.tasks = [
      ...spec.tasks,
      {
        n: 18,
        title: 'Localise the welcome screens',
        who: 'ananya',
        priority: 'MEDIUM',
        created: 0,
        moves: [],
        due: 12,
        estimate: 3,
        waitsOn: [8],
        milestone: 1,
        description: 'Copy and layouts for the five launch languages.',
        criteria: ['All five languages reviewed by a native speaker'],
      },
    ];
  }
  const data = sampleProjectData(now, spec);
  const model = modelFromData(data);
  const members = sampleMembers(spec);
  const priya = spec.people.priya.id;
  const forecast = forecastProgress({ model, tasks: data.tasks, members, shares: a.priyaHalfTime ? { [priya]: 0.5 } : undefined });
  return { data, model, forecast, blocker: projectBlocker(forecast), members };
}
