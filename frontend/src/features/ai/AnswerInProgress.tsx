import { Square } from 'lucide-react';
import { LookupGlyph } from '@/components/glyphs';
import { Spinner } from '@/components/ui/Spinner';
import type { AskProgress } from './answerEvents';

const STATE = { found: 'found', nothing: 'found nothing', unavailable: 'couldn’t be read', declined: 'not suggested' } as const;

/**
 * Flurry at work on a question: what it has looked up so far (the same rings as "How I found
 * this"), the answer's words as they're written, and a way to stop. The words are provisional: the
 * checked answer replaces them, with its citations and limits.
 */
export function AnswerInProgress({ label, progress, onStop }: { label: string; progress: AskProgress | null; onStop: (() => void) | null }) {
  const lookups = progress?.lookups ?? [];
  const draft = progress?.draft ?? '';
  return (
    <div className="space-y-2" data-answer-progress="">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-muted">
        <p className="flex items-center gap-2" role="status">
          <Spinner className="size-3.5" />
          {draft ? 'Writing the answer…' : lookups.length ? 'Looking things up…' : label}
        </p>
        {onStop && (
          <button
            type="button"
            onClick={onStop}
            className="inline-flex items-center gap-1 rounded-sm px-1 text-[12px] font-medium text-ink-2 underline-offset-2 hover:text-ink hover:underline"
            data-stop-answer=""
          >
            <Square className="size-2.5 fill-current" aria-hidden="true" /> Stop
          </button>
        )}
      </div>
      {lookups.length > 0 && (
        <ol className="space-y-1 text-[12px]" aria-label="Looked up so far" data-progress-lookups={lookups.length}>
          {lookups.map((l, i) => (
            <li key={i} className="flex items-start gap-2 leading-snug text-ink-2">
              <LookupGlyph result={l.result} className="mt-[3px]" />
              <span>
                {l.label}
                <span className="sr-only">: {STATE[l.result]}</span>
              </span>
            </li>
          ))}
        </ol>
      )}
      {draft && (
        <p className="text-[13px] leading-relaxed whitespace-pre-line text-ink-2" data-answer-draft="">
          {draft}
          <span className="ml-0.5 inline-block h-3.5 w-1 translate-y-0.5 animate-pulse bg-muted motion-reduce:animate-none" aria-hidden="true" />
        </p>
      )}
    </div>
  );
}
