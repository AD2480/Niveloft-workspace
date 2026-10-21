import { FolderKanban, Plus, Search, SearchX } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useProjectsQuery } from '@/api/endpoints';
import type { ProjectStatus } from '@/api/types';
import { PageContainer } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Form';
import { PageHeader } from '@/components/ui/PageHeader';
import { LastUpdated } from '@/components/ui/LastUpdated';
import { Pagination } from '@/components/ui/Pagination';
import { Segmented } from '@/components/ui/Segmented';
import { Skeleton } from '@/components/ui/Spinner';
import { EmptyState, ErrorState } from '@/components/ui/States';
import { PendingInvitations } from '@/features/projects/InvitationList';
import { ProjectSnowpacks } from '@/features/dashboard/ProjectSnowpacks';
import { ProjectFormDialog } from '@/features/projects/ProjectFormDialog';
import { useDebouncedValue, useDocumentTitle, useUrlState } from '@/lib/hooks';

const PAGE_SIZE = 9;

export function ProjectsPage() {
  useDocumentTitle('Projects');
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [filters, setFilters] = useUrlState({ q: '', status: '', page: '0' });
  const [search, setSearch] = useState(filters.q);
  const debounced = useDebouncedValue(search.trim(), 300);
  useEffect(() => {
    if (debounced !== filters.q) setFilters({ q: debounced, page: '0' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const { data, isLoading, isFetching, isError, error, refetch, fulfilledTimeStamp } = useProjectsQuery({
    search: filters.q,
    status: filters.status as ProjectStatus | '',
    page: Number(filters.page),
    size: PAGE_SIZE,
  });

  const filtered = filters.q !== '' || filters.status !== '';

  return (
    <PageContainer>
      <PageHeader
        title="Projects"
        description="Everything you own, manage or work on, each as a block of its tasks."
        actions={
          <>
            <LastUpdated at={fulfilledTimeStamp} onRefresh={refetch} refreshing={isFetching} className="mr-2" />
            <Button leftIcon={<Plus />} onClick={() => setCreating(true)}>
              New project
            </Button>
          </>
        }
      />

      <div className="mt-6 space-y-6">
        <PendingInvitations />

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="w-full sm:max-w-xs">
            <Input
              leftIcon={<Search />}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search projects"
              aria-label="Search projects"
              type="search"
            />
          </div>
          <div className="scrollbar-thin -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
            <Segmented
              label="Filter by status"
              value={filters.status}
              onChange={(status) => setFilters({ status, page: '0' })}
              options={[
                { value: '', label: 'All' },
                { value: 'ACTIVE', label: 'Active' },
                { value: 'ON_HOLD', label: 'On hold' },
                { value: 'COMPLETED', label: 'Completed' },
                { value: 'ARCHIVED', label: 'Archived' },
              ]}
            />
          </div>
        </div>

        {isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-[340px] rounded-xl" />
            ))}
          </div>
        ) : isError ? (
          <ErrorState error={error} onRetry={refetch} title="Couldn’t load projects" />
        ) : data && data.content.length > 0 ? (
          <>
            <div className={`transition-opacity ${isFetching ? 'opacity-70' : ''}`}>
              <ProjectSnowpacks projects={data.content} details />
            </div>
            <Pagination
              page={data.page}
              totalPages={data.totalPages}
              totalElements={data.totalElements}
              size={data.size}
              onPageChange={(page) => setFilters({ page: String(page) })}
              noun="projects"
            />
          </>
        ) : filtered ? (
          <EmptyState
            icon={SearchX}
            title="No matching projects"
            description="Try a different search term or status filter."
            action={
              <Button
                variant="secondary"
                onClick={() => {
                  setSearch('');
                  setFilters({ q: '', status: '', page: '0' });
                }}
              >
                Clear filters
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={FolderKanban}
            title="Create your first project"
            description="Projects hold your tasks, milestones and team. You can invite teammates after creating one."
            action={
              <Button leftIcon={<Plus />} onClick={() => setCreating(true)}>
                New project
              </Button>
            }
          />
        )}
      </div>

      <ProjectFormDialog open={creating} onOpenChange={setCreating} onSaved={(p) => navigate(`/projects/${p.id}`)} />
    </PageContainer>
  );
}
