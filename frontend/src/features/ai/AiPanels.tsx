import { Check, Info, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { useAiProjectSummaryMutation, useAiReviewAssistMutation, useAiStatusQuery, useAiSuggestCriteriaMutation } from '@/api/endpoints';
import { getErrorMessage } from '@/api/errors';
import type { AiCriteriaSuggestion, AiReviewAssist, AiSummary } from '@/api/types';
import { Button } from '@/components/ui/Button';
import { CopyButton } from '@/components/ui/CopyButton';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { FormError } from '@/components/ui/Form';
import { cn } from '@/lib/cn';

/** Small label that marks generated text as an AI draft, with the model that wrote it. */
function AiLabel({ model }: { model: string | null | undefined }) {
  return (
    <p className="flex items-center gap-1.5 text-[12px] font-medium text-accent">
      <Sparkles className="size-3.5" aria-hidden="true" /> AI draft{model ? ` by ${model}` : ''}. Check it before you use it.
    </p>
  );
}

function Limits({ items }: { items: string[] }) {
  return (
    <ul className="space-y-1 border-t border-line pt-3 text-xs text-muted">
      {items.map((l) => (
        <li key={l} className="flex gap-1.5">
          <Info className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
          {l}
        </li>
      ))}
    </ul>
  );
}

/** Availability as the server reports it. When unavailable, the reason is shown — never a fake answer. */
function useAi() {
  const { data, isLoading } = useAiStatusQuery();
  return { available: !!data?.available, reason: data?.reason ?? null, loading: isLoading, remaining: data?.remainingThisHour ?? 0 };
}

function Unavailable({ reason }: { reason: string | null }) {
  return <p className="text-xs leading-relaxed text-muted">{reason ?? 'AI assistance is not available.'}</p>;
}

/** Review help for the reviewer of a pending submission: what to check, plus a feedback draft to edit. */
export function AiReviewNotes({ taskId, onUseDraft }: { taskId: number; onUseDraft: (text: string) => void }) {
  const ai = useAi();
  const [run, state] = useAiReviewAssistMutation();
  const [result, setResult] = useState<AiReviewAssist | null>(null);
  const [error, setError] = useState<string | null>(null);

  const go = async () => {
    setError(null);
    try {
      setResult(await run(taskId).unwrap());
    } catch (e) {
      setError(getErrorMessage(e));
    }
  };

  return (
    <Card>
      <CardHeader
        title="AI review notes"
        description="Suggestions on what to check. You make the decision."
        action={
          <Button size="xs" variant="secondary" leftIcon={<Sparkles />} onClick={() => void go()} disabled={!ai.available} loading={state.isLoading}>
            {result ? 'Redo' : 'Draft notes'}
          </Button>
        }
      />
      <CardBody className="space-y-4">
        {!ai.loading && !ai.available && <Unavailable reason={ai.reason} />}
        <FormError message={error} />
        {result && (
          <>
            <AiLabel model={result.model} />
            <ol className="space-y-3">
              {result.criteria.map((c) => (
                <li key={c.submissionCriterionId} className="text-[13px]">
                  <p className="font-medium text-ink">{c.criterion}</p>
                  <p className="mt-0.5 text-ink-2">{c.whatToCheck}</p>
                  {c.concern && <p className="mt-0.5 text-warning">Possible gap: {c.concern}</p>}
                </li>
              ))}
            </ol>
            {result.draftFeedback && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-ink-2">Draft feedback</p>
                <p className="border-l-2 border-accent/60 pl-3 text-[13px] whitespace-pre-wrap text-ink-2">{result.draftFeedback}</p>
                <Button size="xs" variant="ghost" onClick={() => onUseDraft(result.draftFeedback)}>
                  Put in the feedback box
                </Button>
              </div>
            )}
            <Limits items={result.limits} />
          </>
        )}
      </CardBody>
    </Card>
  );
}

/** Criteria suggestions while editing; nothing is added until the person picks and saves them. */
export function AiCriteriaSuggest({ taskId, onAdd }: { taskId: number; onAdd: (items: string[]) => void }) {
  const ai = useAi();
  const [run, state] = useAiSuggestCriteriaMutation();
  const [result, setResult] = useState<AiCriteriaSuggestion | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);

  if (!ai.loading && !ai.available) {
    return (
      <p className="flex items-start gap-1.5 text-xs text-muted">
        <Sparkles className="mt-0.5 size-3 shrink-0" aria-hidden="true" /> {ai.reason}
      </p>
    );
  }

  return (
    <div className="space-y-3 border border-dashed border-line-strong p-3">
      {!result ? (
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted">Ask AI for testable criteria based on the title and description.</p>
          <Button
            size="xs"
            variant="secondary"
            leftIcon={<Sparkles />}
            loading={state.isLoading}
            onClick={() =>
              void run(taskId)
                .unwrap()
                .then((r) => {
                  setResult(r);
                  setPicked(new Set(r.criteria.map((_, i) => i)));
                  setError(null);
                })
                .catch((e: unknown) => setError(getErrorMessage(e)))
            }
          >
            Suggest
          </Button>
        </div>
      ) : (
        <>
          <AiLabel model={result.model} />
          {result.criteria.length === 0 ? (
            <p className="text-xs text-muted">No new criteria were suggested.</p>
          ) : (
            <ul className="space-y-1.5">
              {result.criteria.map((c, i) => (
                <li key={i}>
                  <label className="flex items-start gap-2 text-[13px] text-ink-2">
                    <input
                      type="checkbox"
                      className="mt-0.5 size-4 accent-[var(--accent)]"
                      checked={picked.has(i)}
                      onChange={(e) =>
                        setPicked((p) => {
                          const n = new Set(p);
                          if (e.target.checked) n.add(i);
                          else n.delete(i);
                          return n;
                        })
                      }
                    />
                    {c}
                  </label>
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-2">
            <Button
              size="xs"
              disabled={picked.size === 0}
              leftIcon={<Check />}
              onClick={() => {
                onAdd(result.criteria.filter((_, i) => picked.has(i)));
                setResult(null);
              }}
            >
              Add selected to the list
            </Button>
            <Button size="xs" variant="ghost" onClick={() => setResult(null)}>
              Discard
            </Button>
          </div>
          <Limits items={result.limits} />
        </>
      )}
      <FormError message={error} />
    </div>
  );
}

/** A draft status update for the project, to copy and edit. */
export function AiStatusDraft({ projectId }: { projectId: number }) {
  const ai = useAi();
  const [run, state] = useAiProjectSummaryMutation();
  const [result, setResult] = useState<AiSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <Card>
      <CardHeader
        title="Status update draft"
        description="Written from this project’s records only."
        action={
          <Button
            size="xs"
            variant="secondary"
            leftIcon={<Sparkles />}
            disabled={!ai.available}
            loading={state.isLoading}
            onClick={() =>
              void run(projectId)
                .unwrap()
                .then((r) => {
                  setResult(r);
                  setError(null);
                })
                .catch((e: unknown) => setError(getErrorMessage(e)))
            }
          >
            {result ? 'Redo' : 'Draft'}
          </Button>
        }
      />
      <CardBody className={cn('space-y-3', !result && !error && 'py-3')}>
        {!ai.loading && !ai.available && <Unavailable reason={ai.reason} />}
        <FormError message={error} />
        {result && (
          <>
            <AiLabel model={result.model} />
            <p className="text-[13.5px] leading-relaxed whitespace-pre-wrap text-ink-2">{result.text}</p>
            <CopyButton text={result.text} what="the draft" />
            <Limits items={result.limits} />
          </>
        )}
      </CardBody>
    </Card>
  );
}
