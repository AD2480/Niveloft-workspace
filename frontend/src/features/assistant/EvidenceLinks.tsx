import { useState } from 'react';
import { Link } from 'react-router';
import type { AiRef } from '@/api/types';

/**
 * Where a record Flurry read lives in the app: the task page, scrolled to the comment, submission
 * or review, or a project document at the passage. Null when there's nowhere to go.
 */
export function refHref(projectId: number, r: AiRef): string | null {
  if (r.kind === 'document') return r.documentId ? `/projects/${projectId}/docs/${r.documentId}${r.id ? `#p-${r.id}` : ''}` : null;
  if (!r.taskId) return null;
  const base = `/projects/${projectId}/tasks/${r.taskId}`;
  if (r.id && (r.kind === 'comment' || r.kind === 'submission' || r.kind === 'review')) return `${base}#${r.kind}-${r.id}`;
  return base;
}

/** The records one lookup read, as links: the first few, and the rest on request. */
export function EvidenceLinks({ projectId, refs, max = 4 }: { projectId: number; refs: AiRef[]; max?: number }) {
  const [all, setAll] = useState(false);
  if (refs.length === 0) return null;
  const shown = all ? refs : refs.slice(0, max);
  return (
    <ul className="mt-0.5 space-y-0.5" data-evidence-links={refs.length}>
      {shown.map((r, i) => {
        const href = refHref(projectId, r);
        const text = (
          <>
            {r.taskKey && <span className="font-medium tabular">{r.taskKey} </span>}
            <span>{r.label}</span>
          </>
        );
        return (
          <li key={`${r.kind}-${r.taskId ?? r.documentId}-${r.id ?? i}`} className="leading-snug" data-evidence-kind={r.kind}>
            {href ? (
              <Link to={href} className="text-accent decoration-accent/40 underline-offset-2 hover:underline focus-visible:underline">
                {text}
              </Link>
            ) : (
              <span className="text-ink-2">{text}</span>
            )}
          </li>
        );
      })}
      {!all && refs.length > max && (
        <li>
          <button type="button" onClick={() => setAll(true)} className="text-muted hover:text-ink">
            {refs.length - max === 1 ? 'One more record' : `${refs.length - max} more records`}
          </button>
        </li>
      )}
    </ul>
  );
}
