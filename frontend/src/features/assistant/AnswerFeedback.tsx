import { Check, X } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { useRecordAiFeedbackMutation } from '@/api/endpoints';
import { getErrorMessage } from '@/api/errors';
import type { AiAnswer, AiMistake, ProjectDetail } from '@/api/types';
import { Button } from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Form';
import { atLeast } from '@/lib/permissions';
import { MISTAKES } from './corrections';

/**
 * "Was this right?" under one of Flurry's answers. A wrong answer can be marked with the kinds of
 * mistake and the right answer, so the project's owners and managers can see what goes wrong
 * repeatedly and turn it into eval cases. Nothing else is sent: the question, the answer, the model
 * and what it looked up, as shown here.
 */
export function AnswerFeedback({ project, answer, asked }: { project: ProjectDetail; answer: AiAnswer; asked: string }) {
  const [record, state] = useRecordAiFeedbackMutation();
  const [mode, setMode] = useState<'ask' | 'wrong' | 'sent'>('ask');
  const [kinds, setKinds] = useState<AiMistake[]>([]);
  const [correction, setCorrection] = useState('');
  const [error, setError] = useState<string | null>(null);

  const send = async (verdict: 'right' | 'wrong') => {
    setError(null);
    try {
      await record({
        projectId: project.id,
        body: {
          verdict,
          categories: verdict === 'wrong' ? kinds : [],
          correction: verdict === 'wrong' && correction.trim() ? correction.trim().slice(0, 2000) : null,
          question: asked.slice(0, 500),
          answer: answer.answer.slice(0, 4000),
          model: answer.model || null,
          lookups: (answer.lookedUp ?? []).slice(0, 12).map((l) => `${l.tool} ${l.result}`.slice(0, 120)),
        },
      }).unwrap();
      setMode('sent');
    } catch (e) {
      setError(getErrorMessage(e));
    }
  };

  if (mode === 'sent') {
    return (
      <p className="text-[12px] text-muted" data-answer-feedback="sent">
        Thanks.{' '}
        {atLeast(project.myRole, 'MANAGER') ? (
          <Link to={`/projects/${project.id}/settings#flurry-corrections`} className="text-accent hover:underline">
            See the project’s corrections
          </Link>
        ) : (
          'The project’s owners and managers see corrections, to fix what goes wrong repeatedly.'
        )}
      </p>
    );
  }
  if (mode === 'ask') {
    return (
      <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted" data-answer-feedback="ask">
        <span>Was this right?</span>
        <Button variant="ghost" size="xs" leftIcon={<Check />} loading={state.isLoading} onClick={() => void send('right')} data-answer-right="">
          Yes
        </Button>
        <Button variant="ghost" size="xs" leftIcon={<X />} onClick={() => setMode('wrong')} data-answer-wrong="">
          Something’s wrong
        </Button>
        {error && <span className="text-danger">{error}</span>}
      </div>
    );
  }
  return (
    <fieldset className="space-y-2 rounded-lg border border-line px-3 py-2.5 text-[12.5px]" data-answer-feedback="wrong">
      <legend className="px-1 text-[12px] font-medium text-ink">What was wrong?</legend>
      <div className="grid gap-1 sm:grid-cols-2">
        {MISTAKES.map(([k, label]) => (
          <label key={k} className="flex cursor-pointer items-start gap-2 text-ink-2">
            <input
              type="checkbox"
              className="mt-0.5 size-3.5 accent-[var(--accent)]"
              checked={kinds.includes(k)}
              onChange={(e) => setKinds((ks) => (e.target.checked ? [...ks, k] : ks.filter((x) => x !== k)))}
              data-mistake={k}
            />
            {label}
          </label>
        ))}
      </div>
      <label className="block">
        <span className="text-[12px] text-muted">What would the right answer be? (optional)</span>
        <Textarea value={correction} onChange={(e) => setCorrection(e.target.value)} rows={2} maxLength={2000} className="mt-1 text-[13px]" data-answer-correction="" />
      </label>
      <p className="text-[11.5px] text-muted">Sent with the question, this answer and what Flurry looked up. Owners and managers see it for 180 days.</p>
      {error && <p className="text-danger">{error}</p>}
      <div className="flex gap-2">
        <Button size="xs" loading={state.isLoading} disabled={!kinds.length && !correction.trim()} onClick={() => void send('wrong')} data-answer-send="">
          Send
        </Button>
        <Button variant="ghost" size="xs" onClick={() => setMode('ask')}>
          Cancel
        </Button>
      </div>
    </fieldset>
  );
}
