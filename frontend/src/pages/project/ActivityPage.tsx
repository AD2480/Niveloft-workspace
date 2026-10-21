import { Activity as ActivityIcon } from 'lucide-react';
import { useState } from 'react';
import { useProjectActivityQuery } from '@/api/endpoints';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Pagination } from '@/components/ui/Pagination';
import { Skeleton } from '@/components/ui/Spinner';
import { EmptyState, ErrorState } from '@/components/ui/States';
import { ActivityList } from '@/features/activity/ActivityList';
import { useProjectContext } from '@/features/projects/projectContext';

export function ActivityPage() {
  const { project } = useProjectContext();
  const [page, setPage] = useState(0);
  const { data, isLoading, isFetching, isError, error, refetch } = useProjectActivityQuery({ projectId: project.id, page, size: 25 });

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6 lg:px-10">
      <div className="max-w-3xl">
        <Card>
          <CardHeader title="Activity history" description="A permanent log of changes in this project, newest first." />
          <CardBody className={isFetching ? 'opacity-70 transition-opacity' : undefined}>
            {isLoading ? (
              <div className="space-y-4">
                {Array.from({ length: 6 }, (_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : isError || !data ? (
              <ErrorState error={error} onRetry={refetch} />
            ) : data.content.length === 0 ? (
              <EmptyState icon={ActivityIcon} title="No activity yet" compact />
            ) : (
              <ActivityList items={data.content} />
            )}
          </CardBody>
        </Card>
        {data && (
          <Pagination
            page={data.page}
            totalPages={data.totalPages}
            totalElements={data.totalElements}
            size={data.size}
            onPageChange={(p) => {
              setPage(p);
              window.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
            }}
            noun="events"
          />
        )}
      </div>
    </div>
  );
}
