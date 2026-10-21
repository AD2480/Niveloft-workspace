import { useMemo, useState } from 'react';
import type { ProjectDetail, Role } from '@/api/types';
import type { DeliveryForecastData } from '@/features/forecast/useDeliveryForecast';
import { WorkGraph } from '@/features/graph/WorkGraph';
import type { Lens } from '@/features/graph/workGraphData';
import { cn } from '@/lib/cn';
import { checkRanges } from '@/lib/progressForecast';
import { analyzeProject } from '@/lib/projectAnalysis';
import { NO_CHANGES, sampleForecastShared } from './sampleForecast';
import { ONBOARDING_SAMPLE } from './sampleProject';

interface RoleView {
  id: string;
  label: string;
  who: string;
  lens: Lens;
  /** The sample person whose eyes we borrow (null: a client following along). */
  person: keyof typeof ONBOARDING_SAMPLE.people | null;
  role: Role;
}

const VIEWS: RoleView[] = [
  { id: 'member', label: 'Member', who: 'Rohan, mobile developer', lens: 'mine', person: 'rohan', role: 'MEMBER' },
  { id: 'reviewer', label: 'Reviewer', who: 'Priya, engineering manager', lens: 'reviews', person: 'priya', role: 'MANAGER' },
  { id: 'owner', label: 'Owner', who: 'Aarav, product lead', lens: 'team', person: 'aarav', role: 'OWNER' },
  { id: 'viewer', label: 'Viewer or client', who: 'Someone following along', lens: 'delivery', person: null, role: 'VIEWER' },
];

/**
 * The same sample project through four pairs of eyes. Each role opens on the view that answers
 * its own question; it's the app's real graph and forecast, on the sample's records. Access to the
 * graph never widens access to records: it only ever shows what that person could already see.
 */
export function RoleViews({ className }: { className?: string }) {
  const [active, setActive] = useState(VIEWS[0].id);
  const view = VIEWS.find((v) => v.id === active)!;
  const sample = useMemo(() => {
    const s = sampleForecastShared(NO_CHANGES);
    const data = {
      model: s.model,
      analysis: analyzeProject(s.model),
      range: null,
      error: undefined,
      refetch: () => undefined,
      loading: false,
      tasks: s.data.tasks,
      dependencies: s.data.dependencies,
      milestones: s.data.milestones,
      forecast: s.forecast,
      rangeCheck: checkRanges(s.data.tasks, s.model),
      lastChange: null,
    } as unknown as DeliveryForecastData;
    return { data, members: s.members, deadline: s.data.deadline };
  }, []);
  const project = {
    id: 0,
    key: ONBOARDING_SAMPLE.key,
    name: ONBOARDING_SAMPLE.name,
    myRole: view.role,
    deadline: sample.deadline,
    members: sample.members,
  } as unknown as ProjectDetail;
  const personId = view.person ? ONBOARDING_SAMPLE.people[view.person].id : null;

  return (
    <div className={className}>
      <div role="tablist" aria-label="Whose view" className="flex flex-wrap gap-2">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            role="tab"
            id={`role-tab-${v.id}`}
            aria-selected={v.id === active}
            aria-controls="role-panel"
            onClick={() => setActive(v.id)}
            className={cn(
              'flex min-h-11 flex-col items-start rounded-lg border px-4 py-2 text-left transition-colors',
              v.id === active ? 'border-accent bg-brand-soft' : 'border-line bg-surface hover:border-line-strong',
            )}
            data-role-view={v.id}
          >
            <span className="text-[14px] font-semibold text-ink">{v.label}</span>
            <span className="text-[12.5px] text-muted">{v.who}</span>
          </button>
        ))}
      </div>
      <div id="role-panel" role="tabpanel" aria-labelledby={`role-tab-${view.id}`} className="mt-5">
        <WorkGraph
          key={view.id}
          project={project}
          data={sample.data}
          initialLens={view.lens}
          asUser={personId}
          lensLocked
          sample
          heading={`${view.label}: ${view.who}`}
        />
      </div>
    </div>
  );
}
