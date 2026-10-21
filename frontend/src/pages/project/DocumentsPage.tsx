import { FileText, Plus } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useDocumentsQuery } from '@/api/endpoints';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Spinner';
import { EmptyState, ErrorState } from '@/components/ui/States';
import { DocumentEditor } from '@/features/documents/DocumentEditor';
import { useProjectContext } from '@/features/projects/projectContext';
import { timeAgo } from '@/lib/dates';
import { useDocumentTitle } from '@/lib/hooks';
import { atLeast } from '@/lib/permissions';

/**
 * A project's documents: specifications, meeting notes and decisions. Approved ones are what
 * Flurry searches and quotes, with a link to the passage; drafts stay with their author and the
 * project's owners and managers.
 */
export function DocumentsPage() {
  const { project } = useProjectContext();
  useDocumentTitle(`${project.name} · Documents`);
  const { data, isLoading, isError, error, refetch } = useDocumentsQuery(project.id);
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();
  const canAdd = atLeast(project.myRole, 'MEMBER') && project.status !== 'ARCHIVED';
  const approved = data?.filter((d) => d.status === 'APPROVED').length ?? 0;

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6 lg:px-10" data-documents-page="">
      <div className="max-w-4xl">
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-[22px] leading-tight font-semibold tracking-[-0.015em] text-ink">Documents</h2>
            <p className="mt-1.5 max-w-2xl text-[14px] leading-relaxed text-muted">
              Specifications, meeting notes and decisions. Flurry searches the approved ones and links to the passage it used. A draft is seen only by its author and the project’s owners and
              managers, and Flurry never reads it.
            </p>
          </div>
          {canAdd && (
            <Button leftIcon={<Plus />} onClick={() => setCreating(true)} data-document-new="">
              New document
            </Button>
          )}
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {[0, 1].map((i) => (
              <Skeleton key={i} className="h-16 w-full rounded-xl" />
            ))}
          </div>
        ) : isError || !data ? (
          <ErrorState error={error} onRetry={refetch} />
        ) : data.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="No documents yet"
            description="Add the specification or the meeting notes Flurry should be able to quote. They stay drafts until an owner or manager approves them."
            action={
              canAdd ? (
                <Button leftIcon={<Plus />} onClick={() => setCreating(true)}>
                  New document
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            <p className="mb-2 text-[12.5px] text-muted">
              {approved === 1 ? 'One approved document' : `${approved} approved documents`} for Flurry{data.length > approved ? `, ${data.length - approved} ${data.length - approved === 1 ? 'draft' : 'drafts'}` : ''}.
            </p>
            <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface" data-documents-list="">
              {data.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3" data-document-row={d.status}>
                  <div className="min-w-0 flex-1">
                    <Link to={`/projects/${project.id}/docs/${d.id}`} className="text-[14px] font-medium text-ink hover:text-accent">
                      {d.title}
                    </Link>
                    <p className="text-[12.5px] text-muted">
                      {d.passages === 1 ? 'One passage' : `${d.passages} passages`}, edited {timeAgo(d.updatedAt)}
                      {d.updatedBy ? ` by ${d.updatedBy.name}` : ''}
                      {d.status === 'APPROVED' && d.approvedBy ? `; approved by ${d.approvedBy.name}` : ''}
                    </p>
                  </div>
                  <Badge tone={d.status === 'APPROVED' ? 'success' : 'neutral'}>{d.status === 'APPROVED' ? 'Approved for Flurry' : d.mine ? 'Your draft' : 'Draft'}</Badge>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      {creating && (
        <DocumentEditor
          projectId={project.id}
          document={null}
          onClose={(saved) => {
            setCreating(false);
            if (saved) navigate(`/projects/${project.id}/docs/${saved.id}`);
          }}
        />
      )}
    </div>
  );
}
