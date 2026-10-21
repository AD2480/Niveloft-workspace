import { Download, ExternalLink, FileText, GitBranch, Globe, ImageOff, Link2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { downloadFile, useAuthorizedFileUrl } from '@/api/files';
import type { Evidence, EvidenceKind, Submission } from '@/api/types';
import { useAppSelector } from '@/app/store';
import { Avatar } from '@/components/ui/Avatar';
import { formatDateTime } from '@/lib/dates';
import { formatBytes } from '@/lib/format';
import { RichText } from '@/components/RichText';

const LINK_META: Record<Extract<EvidenceKind, 'REPOSITORY' | 'DEPLOYMENT' | 'LINK'>, { label: string; icon: typeof Link2 }> = {
  REPOSITORY: { label: 'Repository', icon: GitBranch },
  DEPLOYMENT: { label: 'Deployment', icon: Globe },
  LINK: { label: 'Link', icon: Link2 },
};

function hostOf(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function LinkEvidence({ item }: { item: Evidence }) {
  const meta = LINK_META[item.kind as keyof typeof LINK_META] ?? LINK_META.LINK;
  return (
    <a
      href={item.url ?? '#'}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="group flex items-center gap-3 rounded-md border border-line bg-surface px-3 py-2 hover:border-line-strong"
    >
      <meta.icon className="size-4 shrink-0 text-muted" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-ink group-hover:text-accent">{item.label}</span>
        <span className="block truncate text-xs text-muted">
          {meta.label}, {hostOf(item.url ?? '')}
        </span>
      </span>
      <ExternalLink className="size-3.5 shrink-0 text-muted" aria-label="Opens in a new tab" />
    </a>
  );
}

/** A screenshot, fetched with the user's token so only project members can see it. */
function ScreenshotEvidence({ item, onOpen }: { item: Evidence; onOpen: (url: string) => void }) {
  const state = useAuthorizedFileUrl(item.file);
  return (
    <figure className="overflow-hidden rounded-md border border-line bg-surface-2">
      {state.status === 'ready' ? (
        <button type="button" onClick={() => onOpen(state.url)} className="block w-full" aria-label={`Enlarge ${item.label}`}>
          <img src={state.url} alt={item.label} className="aspect-video w-full object-cover object-top" loading="lazy" />
        </button>
      ) : (
        <div className="flex aspect-video items-center justify-center p-3 text-center text-xs text-muted">
          {state.status === 'error' ? (
            <span className="flex flex-col items-center gap-1">
              <ImageOff className="size-5" aria-hidden="true" />
              {state.message}
            </span>
          ) : (
            'Loading preview…'
          )}
        </div>
      )}
      <figcaption className="truncate border-t border-line px-2 py-1 text-xs text-ink-2">{item.label}</figcaption>
    </figure>
  );
}

function FileEvidence({ item }: { item: Evidence }) {
  const token = useAppSelector((st) => st.auth.token);
  if (!item.file) return null;
  const file = item.file;
  return (
    <button
      type="button"
      onClick={() => void downloadFile(file, token).catch((e: unknown) => toast.error(e instanceof Error ? e.message : 'Couldn’t download the file.'))}
      className="flex w-full items-center gap-3 rounded-md border border-line bg-surface px-3 py-2 text-left hover:border-line-strong"
      aria-label={`Download ${file.fileName}`}
    >
      <FileText className="size-4 shrink-0 text-muted" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-ink">{file.fileName}</span>
        <span className="block text-xs text-muted tabular">
          {file.contentType}, {formatBytes(file.size)}
        </span>
      </span>
      <Download className="size-3.5 shrink-0 text-muted" aria-hidden="true" />
    </button>
  );
}

/**
 * Everything a submitter handed in: notes, typed links, screenshots and files.
 * Links point to external sites that Niveloft does not open or verify; the reviewer does.
 */
export function SubmissionEvidence({ submission: s, compact = false }: { submission: Submission; compact?: boolean }) {
  const [zoom, setZoom] = useState<string | null>(null);
  const links = s.evidence.filter((e) => e.kind === 'REPOSITORY' || e.kind === 'DEPLOYMENT' || e.kind === 'LINK');
  const shots = s.evidence.filter((e) => e.kind === 'SCREENSHOT');
  const files = s.evidence.filter((e) => e.kind === 'FILE');
  return (
    <div className="space-y-3">
      {!compact && (
        <div className="flex items-center gap-2 text-xs text-muted">
          <Avatar user={s.submittedBy} size="sm" />
          <span>
            <span className="font-medium text-ink">{s.submittedBy.name}</span> submitted version {s.version}, {formatDateTime(s.createdAt)}
          </span>
        </div>
      )}
      <RichText text={s.notes} size="sm" />
      {links.length > 0 && (
        <ul className="grid gap-2 sm:grid-cols-2">
          {links.map((e) => (
            <li key={e.id}>
              <LinkEvidence item={e} />
            </li>
          ))}
        </ul>
      )}
      {shots.length > 0 && (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {shots.map((e) => (
            <li key={e.id}>
              <ScreenshotEvidence item={e} onOpen={setZoom} />
            </li>
          ))}
        </ul>
      )}
      {files.length > 0 && (
        <ul className="grid gap-2 sm:grid-cols-2">
          {files.map((e) => (
            <li key={e.id}>
              <FileEvidence item={e} />
            </li>
          ))}
        </ul>
      )}
      {s.evidence.length === 0 && <p className="text-xs text-muted">No evidence was attached to this version.</p>}
      {zoom && (
        <button
          type="button"
          className="fixed inset-0 z-50 flex cursor-zoom-out items-center justify-center bg-black/70 p-6"
          onClick={() => setZoom(null)}
          onKeyDown={(e) => e.key === 'Escape' && setZoom(null)}
          autoFocus
          aria-label="Close preview"
        >
          <img src={zoom} alt="" className="max-h-full max-w-full rounded-md shadow-pop" />
        </button>
      )}
    </div>
  );
}
