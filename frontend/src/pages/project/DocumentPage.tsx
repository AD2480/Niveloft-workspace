import { ArrowLeft, CheckCircle2, Pencil, Trash2, Undo2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { useApproveDocumentMutation, useDeleteDocumentMutation, useDocumentQuery } from '@/api/endpoints';
import { getErrorMessage } from '@/api/errors';
import { RichText } from '@/components/RichText';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { Skeleton } from '@/components/ui/Spinner';
import { ErrorState } from '@/components/ui/States';
import { DocumentEditor } from '@/features/documents/DocumentEditor';
import { useProjectContext } from '@/features/projects/projectContext';
import { cn } from '@/lib/cn';
import { formatDateTime, timeAgo } from '@/lib/dates';
import { useDocumentTitle } from '@/lib/hooks';

/**
 * One project document, in the passages Flurry reads and cites. A link from Flurry's "How I found
 * this" (#p-123) scrolls to the passage it used and marks it for a moment.
 */
export function DocumentPage() {
  const { project } = useProjectContext();
  const { docId } = useParams();
  const id = Number(docId);
  const { data: doc, isLoading, isError, error, refetch } = useDocumentQuery({ projectId: project.id, id }, { skip: !Number.isFinite(id) });
  useDocumentTitle(`${doc?.title ?? 'Document'} · ${project.name}`);
  const [approve, approveState] = useApproveDocumentMutation();
  const [remove, removeState] = useDeleteDocumentMutation();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const { hash } = useLocation();
  const navigate = useNavigate();
  const [highlighted, setHighlighted] = useState<number | null>(null);

  useEffect(() => {
    const pid = Number(/^#p-(\d+)$/.exec(hash)?.[1]);
    if (!pid || !doc?.passages.some((p) => p.id === pid)) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.getElementById(`p-${pid}`)?.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
    setHighlighted(pid);
    const t = window.setTimeout(() => setHighlighted(null), 2600);
    return () => window.clearTimeout(t);
  }, [hash, doc]);

  const setApproved = async (approved: boolean) => {
    try {
      await approve({ projectId: project.id, id, approved }).unwrap();
      toast.success(approved ? 'Approved: Flurry can search it now.' : 'Approval withdrawn: Flurry no longer reads it.');
    } catch (e) {
      toast.error(getErrorMessage(e));
    }
  };

  if (isLoading) {
    return (
      <div className="mx-auto max-w-3xl space-y-3 px-4 py-6 sm:px-6">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (isError || !doc) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
        <ErrorState error={error} onRetry={refetch} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6 lg:px-10" data-document-page={doc.status}>
      <div className="max-w-3xl">
        <Link to={`/projects/${project.id}/docs`} className="inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-ink">
          <ArrowLeft className="size-3.5" aria-hidden="true" /> Documents
        </Link>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-[24px] leading-tight font-semibold tracking-[-0.015em] text-ink">{doc.title}</h2>
            <p className="mt-1.5 text-[13px] text-muted">
              {doc.status === 'APPROVED' && doc.approvedBy && doc.approvedAt ? (
                <>
                  Approved for Flurry by {doc.approvedBy.name}, <time dateTime={doc.approvedAt} title={formatDateTime(doc.approvedAt)}>{timeAgo(doc.approvedAt)}</time>.
                </>
              ) : (
                'A draft: only its author and the project’s owners and managers see it, and Flurry doesn’t read it.'
              )}{' '}
              Edited {timeAgo(doc.updatedAt)}
              {doc.updatedBy ? ` by ${doc.updatedBy.name}` : ''}.
            </p>
          </div>
          <Badge tone={doc.status === 'APPROVED' ? 'success' : 'neutral'}>{doc.status === 'APPROVED' ? 'Approved' : 'Draft'}</Badge>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {doc.canApprove &&
            (doc.status === 'APPROVED' ? (
              <Button variant="outline" size="sm" leftIcon={<Undo2 />} loading={approveState.isLoading} onClick={() => void setApproved(false)} data-document-withdraw="">
                Withdraw approval
              </Button>
            ) : (
              <Button size="sm" leftIcon={<CheckCircle2 />} loading={approveState.isLoading} onClick={() => void setApproved(true)} data-document-approve="">
                Approve for Flurry
              </Button>
            ))}
          {doc.canEdit && (
            <Button variant="outline" size="sm" leftIcon={<Pencil />} onClick={() => setEditing(true)} data-document-edit="">
              Edit
            </Button>
          )}
          {doc.canDelete && (
            <Button variant="ghost" size="sm" leftIcon={<Trash2 />} onClick={() => setDeleting(true)} data-document-delete="">
              Delete
            </Button>
          )}
        </div>

        <article className="mt-6 space-y-1" data-document-passages={doc.passages.length}>
          {doc.passages.map((p, i) => {
            const newSection = p.heading !== null && p.heading !== doc.passages[i - 1]?.heading;
            return (
              <section key={p.id} id={`p-${p.id}`} className={cn('scroll-mt-24 rounded-lg px-3 py-2 transition-shadow', highlighted === p.id && 'ring-2 ring-accent/60')} data-passage={p.id}>
                {newSection && <h3 className="mb-1.5 text-[15px] font-semibold text-ink">{p.heading!.split(' › ').at(-1)}</h3>}
                <RichText text={p.content} projectId={project.id} />
              </section>
            );
          })}
        </article>
        <p className="mt-6 border-t border-line pt-3 text-[12px] text-muted">
          {doc.passages.length === 1 ? 'One passage' : `${doc.passages.length} passages`}: Flurry reads approved documents in these parts and links to the one it used.
        </p>
      </div>
      {editing && <DocumentEditor projectId={project.id} document={doc} onClose={() => setEditing(false)} />}
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete “${doc.title}”?`}
        description="It’s removed for everyone, and Flurry can no longer read it. This can’t be undone."
        confirmLabel="Delete"
        loading={removeState.isLoading}
        onConfirm={async () => {
          try {
            await remove({ projectId: project.id, id }).unwrap();
            toast.success('Document deleted.');
            navigate(`/projects/${project.id}/docs`);
          } catch (e) {
            toast.error(getErrorMessage(e));
          }
        }}
      />
    </div>
  );
}
