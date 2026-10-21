import { useId } from 'react';
import { Link } from 'react-router';
import { cn } from '@/lib/cn';
import type { FactTone, ProjectAnalysis } from '@/lib/projectAnalysis';
import type { ProjectModel } from '@/three/projectModel';

const TONE: Record<FactTone, { bar: string; label: string; text: string }> = {
  neutral: { bar: 'bg-line-strong', label: '', text: '' },
  good: { bar: 'bg-success', label: 'Fine', text: 'text-success' },
  warning: { bar: 'bg-warning', label: 'Watch', text: 'text-warning' },
  danger: { bar: 'bg-danger', label: 'At risk', text: 'text-danger' },
};

/**
 * The analysis beside the model: short statements computed from the records (and, where marked,
 * from the scheduler's estimate). No AI is involved, so it's always available and repeatable.
 */
export function ModelAnalysis({
  analysis,
  model,
  projectId,
  className,
}: {
  analysis: ProjectAnalysis;
  model: ProjectModel;
  /** For task links; omit on public pages (the sample has no real tasks). */
  projectId?: number;
  className?: string;
}) {
  const keyOf = new Map(model.blocks.map((b) => [b.id, b.key]));
  const titleId = useId();
  return (
    <section className={cn('border border-line bg-surface', className)} aria-labelledby={titleId}>
      <header className="border-b border-line px-5 py-4">
        <h2 id={titleId} className="caps text-ink">
          Analysis
        </h2>
        <p className="mt-1 text-[12px] leading-relaxed text-muted">
          Computed by Niveloft from the project’s records as of today. Lines marked <span className="text-[12px] font-medium text-accent">Estimate</span> come
          from the scheduler and are not commitments. No AI is involved here.
        </p>
      </header>
      <ul className="divide-y divide-line">
        {analysis.facts.map((f) => (
          <li key={f.id} className="flex gap-4 px-5 py-3.5">
            <span className={cn('mt-1 w-0.5 shrink-0 self-stretch', TONE[f.tone].bar)} aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-[14px] font-medium text-ink">{f.title}</span>
                <span className={cn('text-[11.5px] font-medium', f.source === 'estimate' ? 'text-accent' : 'text-muted')}>{f.source === 'estimate' ? 'Estimate' : 'Recorded'}</span>
                {/* The word as well as the colour, so the meaning never rests on colour alone. */}
                {TONE[f.tone].label && <span className={cn('text-[11.5px] font-medium', TONE[f.tone].text)}>{TONE[f.tone].label}</span>}
              </p>
              <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{f.detail}</p>
              {projectId !== undefined && f.taskIds.length > 0 && (
                <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
                  {f.taskIds.slice(0, 8).map((id) => (
                    <Link key={id} to={`/projects/${projectId}/tasks/${id}`} className="font-mono text-[12px] text-accent hover:underline">
                      {keyOf.get(id) ?? `#${id}`}
                    </Link>
                  ))}
                </p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * A short version for the project Overview: the forecast line and what needs attention, at most
 * `max` lines. The full list (and the AI assistant) is on the Graph page.
 */
export function AnalysisHighlights({ analysis, max = 4, className }: { analysis: ProjectAnalysis; max?: number; className?: string }) {
  const finish = analysis.facts.find((f) => f.id === 'finish');
  const flagged = analysis.facts.filter((f) => f.id !== 'finish' && (f.tone === 'warning' || f.tone === 'danger'));
  const rest = analysis.facts.filter((f) => f !== finish && !flagged.includes(f));
  const picks = [...(finish ? [finish] : []), ...flagged, ...rest].slice(0, max);
  return (
    <ul className={cn('divide-y divide-line', className)}>
      {picks.map((f) => (
        <li key={f.id} className="flex gap-3 py-2.5">
          <span className={cn('mt-1 w-0.5 shrink-0 self-stretch', TONE[f.tone].bar)} aria-hidden="true" />
          <div className="min-w-0">
            <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="text-[13px] font-medium text-ink">{f.title}</span>
              <span className={cn('text-[11.5px] font-medium', f.source === 'estimate' ? 'text-accent' : 'text-muted')}>{f.source === 'estimate' ? 'Estimate' : 'Recorded'}</span>
              {TONE[f.tone].label && <span className={cn('text-[11.5px] font-medium', TONE[f.tone].text)}>{TONE[f.tone].label}</span>}
            </p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted">{f.detail}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}
