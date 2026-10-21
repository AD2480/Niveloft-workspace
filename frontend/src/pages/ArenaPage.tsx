import { Cpu, Eye, Scale, Shuffle, Sparkles, Swords, ThumbsDown, Trophy } from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useAiAskProjectMutation, useBoardTasksQuery, useProjectQuery, useProjectsQuery } from '@/api/endpoints';
import { getErrorMessage } from '@/api/errors';
import { useAiModelsQuery, useArenaScoreboardQuery, useArenaVoteMutation } from '@/api/siteEndpoints';
import type { ArenaScoreboard, ArenaWinner, ProjectDetail, Task } from '@/api/types';
import { PageContainer } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { CopyButton } from '@/components/ui/CopyButton';
import { Field, FormError, Input, Select } from '@/components/ui/Form';
import { PageHeader } from '@/components/ui/PageHeader';
import { Skeleton } from '@/components/ui/Spinner';
import { EmptyState, ErrorState } from '@/components/ui/States';
import { askInBrowser, browserAiErrorMessage, enableBrowserAi } from '@/features/ai/browserAi';
import { useBrowserAi } from '@/features/ai/useBrowserAi';
import { answerLocally } from '@/features/assistant/localAnswer';
import { useProjectModel } from '@/features/model/useProjectModel';
import { cn } from '@/lib/cn';
import { todayIso } from '@/lib/dates';
import { useDocumentTitle } from '@/lib/hooks';
import { forecastFromModel } from '@/lib/projectAnalysis';
import { learn } from '@/lib/projectLearner';
import type { ProjectModel } from '@/three/projectModel';
import { BUILTIN, CHROME, contenderLabel, pickPair, type Contender } from '@/features/arena/contenders';

interface Answer {
  text: string;
  cited: string[];
}
type Side = { status: 'idle' } | { status: 'loading' } | { status: 'done'; answer: Answer } | { status: 'error'; message: string };

const EXAMPLES = ['Will we make the deadline?', 'What’s most at risk of being late?', 'Who has too much on?', 'What should happen next?'];

/**
 * The Arena: the same question about a project goes to two answer sources at once, shown side by
 * side without their names. You pick the better answer (or a tie, or neither), the names are
 * revealed, and the scoreboard counts which sources people prefer. Only the outcome is stored.
 */
export function ArenaPage() {
  useDocumentTitle('AI arena');
  const projects = useProjectsQuery({ status: 'ACTIVE', size: 50 });
  const [projectId, setProjectId] = useState<number | null>(null);
  useEffect(() => {
    if (projectId === null && projects.data?.content.length) setProjectId(projects.data.content[0].id);
  }, [projects.data, projectId]);
  const projectQ = useProjectQuery(projectId ?? 0, { skip: projectId === null });
  const project = projectQ.currentData ?? null;
  const tasks = useBoardTasksQuery(projectId ?? 0, { skip: projectId === null });
  const pm = useProjectModel(project);
  const models = useAiModelsQuery();
  const browser = useBrowserAi();
  const board = useArenaScoreboardQuery();

  const pool = useMemo<Contender[]>(() => {
    const list: Contender[] = [BUILTIN];
    if (browser.availability === 'available') list.push(CHROME);
    for (const m of models.data ?? []) list.push({ id: `server:${m.name}`, label: m.name, detail: `On the server (${m.provider})` });
    return list;
  }, [browser.availability, models.data]);

  const [pair, setPair] = useState<[Contender, Contender] | null>(null);
  useEffect(() => {
    // A new pair when the choice of sources changes (and there wasn't a valid one).
    setPair((p) => (p && pool.some((c) => c.id === p[0].id) && pool.some((c) => c.id === p[1].id) ? p : pickPair(pool)));
  }, [pool]);

  const [question, setQuestion] = useState('');
  const [asked, setAsked] = useState<string | null>(null);
  const [sides, setSides] = useState<[Side, Side]>([{ status: 'idle' }, { status: 'idle' }]);
  const [voted, setVoted] = useState<ArenaWinner | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [askServer] = useAiAskProjectMutation();
  const [vote, voteState] = useArenaVoteMutation();

  const ready = !!project && !!tasks.currentData && !!pm.model;
  const asking = sides.some((s) => s.status === 'loading');

  const answerWith = async (c: Contender, q: string, p: ProjectDetail, ts: readonly Task[], model: ProjectModel): Promise<Answer> => {
    if (c.id === 'builtin') {
      const a = answerLocally(q, learn(ts, model), ts, model);
      return { text: [a.title, ...a.lines.map((l) => `• ${l.text}`)].join('\n'), cited: [...new Set(a.lines.flatMap((l) => (l.task ? [l.task.key] : [])))] };
    }
    if (c.id === 'chrome') {
      try {
        const a = await askInBrowser({ project: p, tasks: ts, model, question: q, today: todayIso() });
        return { text: a.answer, cited: a.citedTasks };
      } catch (e) {
        throw new Error(browserAiErrorMessage(e));
      }
    }
    const a = await askServer({ projectId: p.id, body: { question: q, forecast: forecastFromModel(model), model: c.id.slice('server:'.length) } })
      .unwrap()
      .catch((e: unknown) => {
        throw new Error(getErrorMessage(e));
      });
    return { text: a.answer, cited: a.citedTasks };
  };

  const ask = async (e?: FormEvent) => {
    e?.preventDefault();
    const q = question.trim();
    setFormError(null);
    if (q.length < 3) {
      setFormError('Ask a question of at least a few words.');
      return;
    }
    if (!pair || !project || !tasks.currentData || !pm.model) return;
    const [a, b] = pair;
    const p = project;
    const ts = tasks.currentData;
    const model = pm.model;
    setAsked(q);
    setVoted(null);
    setSides([{ status: 'loading' }, { status: 'loading' }]);
    const run = (c: Contender, i: 0 | 1) =>
      answerWith(c, q.slice(0, 500), p, ts, model).then(
        (answer) => setSides((s) => (i === 0 ? [{ status: 'done', answer }, s[1]] : [s[0], { status: 'done', answer }])),
        (err: unknown) => {
          const message = err instanceof Error ? err.message : getErrorMessage(err);
          setSides((s) => (i === 0 ? [{ status: 'error', message }, s[1]] : [s[0], { status: 'error', message }]));
        },
      );
    await Promise.all([run(a, 0), run(b, 1)]);
  };

  const cast = async (winner: ArenaWinner) => {
    if (!pair || !project) return;
    setFormError(null);
    try {
      await vote({ projectId: project.id, a: pair[0].id, b: pair[1].id, winner }).unwrap();
      setVoted(winner);
    } catch (e) {
      setFormError(getErrorMessage(e));
    }
  };

  const next = () => {
    setPair(pickPair(pool));
    setAsked(null);
    setVoted(null);
    setQuestion('');
    setSides([{ status: 'idle' }, { status: 'idle' }]);
  };

  const bothAnswered = sides[0].status === 'done' && sides[1].status === 'done';

  return (
    <PageContainer>
      <PageHeader
        title="Which answer is better?"
        description="Ask about one of your projects. Two answer sources reply side by side without their names. Pick the better one, then see who wrote it. The scoreboard counts which sources people prefer."
      />

      {projects.isLoading ? (
        <div className="mt-8 space-y-4">
          <Skeleton className="h-28" />
          <Skeleton className="h-64" />
        </div>
      ) : projects.isError ? (
        <ErrorState error={projects.error} onRetry={projects.refetch} title="Couldn’t load your projects" />
      ) : !projects.data?.content.length ? (
        <Card className="mt-8">
          <EmptyState
            icon={Swords}
            title="The arena needs a project"
            description="Answers come from a project’s records, so create or join an active project first."
            action={
              <Link to="/projects" className="inline-flex min-h-6 items-center py-1 text-[13px] font-medium text-accent hover:underline">
                Go to projects
              </Link>
            }
          />
        </Card>
      ) : (
        <div className="mt-8 grid gap-8 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0 space-y-6">
            <Card>
              <CardBody className="space-y-4">
                <form onSubmit={(e) => void ask(e)} className="grid gap-4 md:grid-cols-[220px_minmax(0,1fr)_auto] md:items-end" noValidate data-arena-form="">
                  <Field label="Project">
                    {(p) => (
                      <Select
                        {...p}
                        value={projectId ?? ''}
                        onChange={(e) => {
                          setProjectId(Number(e.target.value));
                          setAsked(null);
                          setSides([{ status: 'idle' }, { status: 'idle' }]);
                        }}
                        disabled={asking}
                      >
                        {projects.data.content.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                  <Field label="Your question">
                    {(p) => <Input {...p} value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={500} placeholder="e.g. Will we make the deadline?" disabled={asking} />}
                  </Field>
                  <Button type="submit" size="md" leftIcon={<Swords aria-hidden="true" />} loading={asking} disabled={!ready || !pair}>
                    Ask both
                  </Button>
                </form>
                <div className="flex flex-wrap gap-2" aria-label="Example questions">
                  {EXAMPLES.map((ex) => (
                    <button
                      key={ex}
                      type="button"
                      onClick={() => setQuestion(ex)}
                      disabled={asking}
                      className="rounded-full border border-line px-3 py-1 text-[12px] text-ink-2 transition-colors hover:border-ink hover:text-ink disabled:opacity-50"
                    >
                      {ex}
                    </button>
                  ))}
                </div>
                <FormError message={formError} />
                {!ready && projectId !== null && (pm.error || tasks.error) ? (
                  <FormError message={`This project’s records didn’t load: ${getErrorMessage(pm.error ?? tasks.error)}`} />
                ) : !ready ? (
                  <p className="text-[12.5px] text-muted" role="status">
                    Loading the project’s records…
                  </p>
                ) : null}
              </CardBody>
            </Card>

            <PairBar pool={pool} pair={pair} onShuffle={() => setPair(pickPair(pool))} disabled={asking} browser={browser.availability} />

            {pair && asked && (
              <section aria-labelledby="arena-answers" className="space-y-4">
                <h2 id="arena-answers" className="sr-only">
                  Answers to: {asked}
                </h2>
                <p className="text-[13px] text-muted">
                  Asked about <span className="text-ink">{project?.name}</span>: “{asked}”
                </p>
                <div className="grid gap-4 lg:grid-cols-2">
                  {([0, 1] as const).map((i) => (
                    <AnswerCard
                      key={i}
                      letter={i === 0 ? 'A' : 'B'}
                      side={sides[i]}
                      revealed={voted || sides.some((s) => s.status === 'error') ? pair[i] : null}
                      won={voted === (i === 0 ? 'A' : 'B')}
                    />
                  ))}
                </div>
                {bothAnswered && !voted && (
                  <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface p-4" role="group" aria-label="Your vote">
                    <p className="mr-2 text-[13px] font-medium text-ink">Which is better?</p>
                    <Button onClick={() => void cast('A')} loading={voteState.isLoading && voteState.originalArgs?.winner === 'A'} leftIcon={<Trophy aria-hidden="true" />}>
                      A is better
                    </Button>
                    <Button onClick={() => void cast('B')} loading={voteState.isLoading && voteState.originalArgs?.winner === 'B'} leftIcon={<Trophy aria-hidden="true" />}>
                      B is better
                    </Button>
                    <Button variant="secondary" onClick={() => void cast('TIE')} leftIcon={<Scale aria-hidden="true" />} disabled={voteState.isLoading}>
                      About the same
                    </Button>
                    <Button variant="ghost" onClick={() => void cast('NEITHER')} leftIcon={<ThumbsDown aria-hidden="true" />} disabled={voteState.isLoading}>
                      Both are poor
                    </Button>
                  </div>
                )}
                {(voted || sides.some((s) => s.status === 'error')) && !asking && (
                  <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface p-4" role="status">
                    <p className="text-[13px] text-ink-2">
                      {voted
                        ? `Thanks, your vote is counted. ${voteSummary(voted, pair)}`
                        : 'One source couldn’t answer, so there’s nothing to vote on this time. Its name is shown so you know which one.'}
                    </p>
                    <Button variant="secondary" size="sm" leftIcon={<Shuffle aria-hidden="true" />} onClick={next} className="ml-auto">
                      New round
                    </Button>
                  </div>
                )}
              </section>
            )}
          </div>

          <aside className="space-y-6">
            <Scoreboard data={board.data} loading={board.isLoading} error={board.error} onRetry={board.refetch} />
            <Card>
              <CardBody className="space-y-2 text-[12.5px] leading-relaxed text-muted">
                <p className="flex items-center gap-1.5 font-medium text-ink">
                  <Eye className="size-4" aria-hidden="true" /> What’s kept
                </p>
                <p>Only which source won (and in which project). Your question and the answers aren’t stored.</p>
                <p>Answers come only from records of projects you’re a member of. No AI can change anything here.</p>
              </CardBody>
            </Card>
          </aside>
        </div>
      )}
    </PageContainer>
  );
}

function voteSummary(w: ArenaWinner, pair: [Contender, Contender]): string {
  if (w === 'A') return `You preferred ${pair[0].label}.`;
  if (w === 'B') return `You preferred ${pair[1].label}.`;
  if (w === 'TIE') return 'You rated them about the same.';
  return 'Neither answer was good enough.';
}

/** Which sources can take part, and a way to draw a new pair. */
function PairBar({
  pool,
  pair,
  onShuffle,
  disabled,
  browser,
}: {
  pool: Contender[];
  pair: [Contender, Contender] | null;
  onShuffle: () => void;
  disabled: boolean;
  browser: ReturnType<typeof useBrowserAi>['availability'];
}) {
  const [enabling, setEnabling] = useState(false);
  const chromeOffer = browser === 'downloadable' || browser === 'downloading';
  return (
    <div className="flex flex-wrap items-center gap-3 text-[12.5px] text-muted" data-arena-pool={pool.length}>
      <span className="text-[12px] font-medium">Taking part</span>
      {pool.map((c) => (
        <span key={c.id} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-ink-2" title={c.detail}>
          {c.id === 'builtin' ? <Cpu className="size-3.5" aria-hidden="true" /> : <Sparkles className="size-3.5" aria-hidden="true" />}
          {c.label}
        </span>
      ))}
      {pool.length >= 3 && pair && (
        <Button variant="ghost" size="xs" leftIcon={<Shuffle aria-hidden="true" />} onClick={onShuffle} disabled={disabled}>
          Draw another pair
        </Button>
      )}
      {chromeOffer && (
        <Button
          variant="secondary"
          size="xs"
          loading={enabling || browser === 'downloading'}
          onClick={() => {
            setEnabling(true);
            void enableBrowserAi().finally(() => setEnabling(false));
          }}
        >
          Add the AI in this browser
        </Button>
      )}
      {pool.length < 2 && (
        <p className="w-full rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-[12.5px] text-warning" role="status" data-arena-needs-two="">
          The arena needs two answer sources, and only the built-in model is available here.{' '}
          {chromeOffer
            ? 'Add the AI built into this browser with the button above,'
            : 'In Chrome with its built-in AI turned on, the browser’s model joins;'}{' '}
          or run the backend with Ollama on the same computer and each installed model joins.
        </p>
      )}
    </div>
  );
}

function AnswerCard({ letter, side, revealed, won }: { letter: 'A' | 'B'; side: Side; revealed: Contender | null; won: boolean }) {
  return (
    <Card className={cn('flex flex-col', won && 'ring-2 ring-success/60')} data-arena-answer={letter}>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            Answer {letter}
            {won && <Trophy className="size-4 text-success" aria-label="Your pick" />}
          </span>
        }
        description={revealed ? `${revealed.label}: ${revealed.detail}` : 'Source hidden until you vote'}
        action={side.status === 'done' ? <CopyButton text={side.answer.text} what={`answer ${letter}`} iconOnly /> : undefined}
      />
      <CardBody className="flex-1" aria-live="polite" aria-busy={side.status === 'loading'}>
        {side.status === 'loading' || side.status === 'idle' ? (
          <div className="space-y-2" role="status" aria-label={`Answer ${letter} is being written`}>
            <Skeleton className="h-3 w-5/6" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-4/6" />
            <Skeleton className="h-3 w-3/4" />
          </div>
        ) : side.status === 'error' ? (
          <p className="text-[13px] text-danger" role="alert">
            {side.message}
          </p>
        ) : (
          <div className="space-y-3">
            <p className="text-[13.5px] leading-relaxed whitespace-pre-line text-ink-2">{side.answer.text}</p>
            {side.answer.cited.length > 0 && (
              <p className="flex flex-wrap items-baseline gap-x-2 text-[12px]">
                <span className="text-[11.5px] font-medium text-muted">Based on</span>
                {side.answer.cited.map((k) => (
                  <span key={k} className="font-mono text-ink">
                    {k}
                  </span>
                ))}
              </p>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function Scoreboard({ data, loading, error, onRetry }: { data: ArenaScoreboard | undefined; loading: boolean; error: unknown; onRetry: () => void }) {
  return (
    <Card data-arena-scoreboard="">
      <CardHeader
        title="Scoreboard"
        description={data ? `${data.totalVotes} ${data.totalVotes === 1 ? 'vote' : 'votes'} from everyone on this site, ${data.myVotes} of them yours` : 'Which sources people prefer'}
      />
      <CardBody>
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-8" />
            <Skeleton className="h-8" />
          </div>
        ) : error ? (
          <ErrorState error={error} onRetry={onRetry} title="Couldn’t load the scoreboard" className="py-6" />
        ) : !data || data.standings.length === 0 ? (
          <EmptyState icon={Trophy} title="No votes yet" description="Ask a question and pick the better answer to start the scoreboard." compact />
        ) : (
          <ol className="space-y-3">
            {data.standings.map((s, i) => {
              const decided = s.wins + s.losses + s.ties;
              const rate = decided ? (s.wins + s.ties / 2) / decided : 0;
              return (
                <li key={s.contender}>
                  <div className="flex items-baseline justify-between gap-3 text-[13px]">
                    <span className="min-w-0 truncate text-ink">
                      <span className="mr-2 font-mono text-[12px] text-muted tabular">{i + 1}</span>
                      {contenderLabel(s.contender)}
                    </span>
                    <span className="shrink-0 text-[12px] text-muted tabular">{decided ? `${Math.round(rate * 100)}% won` : 'no decisions yet'}</span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-3" aria-hidden="true">
                    <div className="h-full rounded-full bg-accent" style={{ width: `${Math.round(rate * 100)}%` }} />
                  </div>
                  <p className="mt-1 text-[12px] text-muted tabular">
                    {s.votes} {s.votes === 1 ? 'round' : 'rounds'}: {s.wins} won, {s.ties} tied, {s.losses} lost{s.bothBad ? `, ${s.bothBad} both poor` : ''}
                  </p>
                </li>
              );
            })}
          </ol>
        )}
      </CardBody>
    </Card>
  );
}
