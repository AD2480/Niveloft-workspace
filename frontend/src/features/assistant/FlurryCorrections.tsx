import { Download } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { useAiFeedbackSummaryQuery } from '@/api/endpoints';
import { getErrorMessage } from '@/api/errors';
import type { ProjectDetail } from '@/api/types';
import { useAppSelector } from '@/app/store';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Segmented } from '@/components/ui/Segmented';
import { Skeleton } from '@/components/ui/Spinner';
import { timeAgo } from '@/lib/dates';
import { downloadCorrections, MISTAKES } from './corrections';

const SPANS = { '30': '30 days', '90': '90 days', '180': '180 days' } as const;
type Span = keyof typeof SPANS;

/**
 * Corrections to Flurry in this project, for owners and managers: how many answers people rated, the
 * kinds of mistake that recur, per model, how often a wrong answer came without looking anything up
 * (a sign the tools weren't used), and the latest corrections. The wrong answers download as draft
 * eval cases for the ml/ tool eval: evidence first, then a better prompt, tool or model.
 */
export function FlurryCorrections({ project }: { project: ProjectDetail }) {
  const [span, setSpan] = useState<Span>('90');
  const { data, isLoading, isError, error } = useAiFeedbackSummaryQuery({ projectId: project.id, days: Number(span) });
  const token = useAppSelector((s) => s.auth.token);
  const [downloading, setDownloading] = useState(false);
  const max = data ? Math.max(1, ...Object.values(data.byKind).map((v) => v ?? 0)) : 1;

  const download = async () => {
    setDownloading(true);
    try {
      await downloadCorrections(project.id, project.key, token);
      toast.success('Corrections downloaded as draft eval cases');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : getErrorMessage(e));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Card data-flurry-corrections="">
      <div id="flurry-corrections" className="scroll-mt-24" />
      <CardHeader
        title="Corrections to Flurry"
        description="When someone marks an answer wrong, it’s counted here, so what goes wrong repeatedly can be fixed with evidence."
        action={<Segmented label="Period" value={span} onChange={setSpan} options={(Object.keys(SPANS) as Span[]).map((s) => ({ value: s, label: SPANS[s] }))} />}
      />
      <CardBody className="space-y-4">
        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : isError || !data ? (
          <p className="text-[13px] text-danger">Couldn’t load the corrections ({getErrorMessage(error)}).</p>
        ) : data.rated === 0 ? (
          <p className="text-[13px] text-muted">Nobody has rated an answer in the last {SPANS[span]}. People can mark any of Flurry’s answers right or wrong under the answer.</p>
        ) : (
          <>
            <p className="text-[14px] text-ink" data-corrections-totals="">
              {data.rated} {data.rated === 1 ? 'answer' : 'answers'} rated: {data.right} right, {data.wrong} wrong.
              {data.wrong > 0 && ` ${data.wrongWithoutLookups} of the wrong ones came without looking anything up.`}
            </p>
            {data.wrong > 0 && (
              <div className="grid gap-5 lg:grid-cols-2">
                <div>
                  <h4 className="text-[12.5px] font-medium text-muted">Kinds of mistake</h4>
                  <ul className="mt-2 space-y-1.5" data-corrections-kinds="">
                    {MISTAKES.filter(([k]) => data.byKind[k]).map(([k, label]) => (
                      <li key={k} className="grid grid-cols-[minmax(0,1fr)_120px_28px] items-center gap-2 text-[12.5px]">
                        <span className="text-ink-2">{label}</span>
                        <span className="h-1.5 rounded-full bg-surface-3" aria-hidden="true">
                          <span className="block h-1.5 rounded-full bg-warning" style={{ width: `${((data.byKind[k] ?? 0) / max) * 100}%` }} />
                        </span>
                        <span className="text-right text-ink tabular-nums">{data.byKind[k]}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h4 className="text-[12.5px] font-medium text-muted">By model</h4>
                  <table className="mt-2 w-full text-left text-[12.5px]">
                    <thead>
                      <tr className="text-muted">
                        <th scope="col" className="py-1 pr-2 font-medium">Model</th>
                        <th scope="col" className="py-1 pr-2 font-medium">Right</th>
                        <th scope="col" className="py-1 font-medium">Wrong</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.byModel.map((m) => (
                        <tr key={m.model} className="border-t border-line">
                          <td className="py-1 pr-2 font-mono text-[12px] text-ink-2">{m.model}</td>
                          <td className="py-1 pr-2 tabular-nums">{m.right}</td>
                          <td className="py-1 tabular-nums">{m.wrong}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {data.latest.length > 0 && (
              <div>
                <h4 className="text-[12.5px] font-medium text-muted">Latest corrections</h4>
                <ul className="mt-2 divide-y divide-line rounded-lg border border-line" data-corrections-latest="">
                  {data.latest.slice(0, 8).map((c) => (
                    <li key={c.id} className="space-y-1 px-3 py-2.5 text-[12.5px]">
                      <p className="text-ink">
                        “{c.question}” <span className="text-muted">{timeAgo(c.at)}</span>
                      </p>
                      <p className="line-clamp-2 text-muted">Flurry: {c.answer}</p>
                      {c.categories.length > 0 && <p className="text-ink-2">{c.categories.map((k) => data.kinds[k] ?? k).join('; ')}</p>}
                      {c.correction && <p className="text-ink-2">Right answer: {c.correction}</p>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
        <div className="flex flex-col gap-2 border-t border-line pt-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-xl text-[12px] leading-relaxed text-muted">
            The wrong answers as draft eval cases (JSON lines) for <code className="font-mono">python -m niveloft_ml tools</code>: write what a right answer must say before running them. Corrections are kept 180 days.
          </p>
          <Button variant="secondary" size="sm" leftIcon={<Download />} onClick={() => void download()} loading={downloading} className="shrink-0" data-corrections-download="">
            Download as eval cases
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
