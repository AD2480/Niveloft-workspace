import { ProjectAnalyticsView } from '@/features/analytics/ProjectAnalyticsView';
import { useProjectContext } from '@/features/projects/projectContext';

export function ProjectAnalyticsPage() {
  const { project } = useProjectContext();
  return (
    <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6 lg:px-10">
      <ProjectAnalyticsView projectId={project.id} color={project.color} showExpected={project.status === 'ACTIVE'} />
    </div>
  );
}
