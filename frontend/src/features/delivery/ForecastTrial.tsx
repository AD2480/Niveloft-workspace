import { FlaskConical } from 'lucide-react';
import { Link } from 'react-router';
import { useForecastTrialQuery } from '@/api/endpoints';
import type { ForecastTrial, ForecastTrialScore, ProjectDetail } from '@/api/types';
import { TaskRef } from '@/features/refs/TaskRef';
import { cn } from '@/lib/cn';
import { formatDate } from '@/lib/dates';

const days = (d: number) => `${d < 10 ? d.toFixed(1) : Math.round(d)} ${d === 1 ? 'day' : 'days'}`;
const miss = (f: number | null) => (f === null ? 'n/a' : `×${f.toFixed(2)}`);

function ScoreRow({ label, score }: { label: string; score: ForecastTrialScore }) {
  return (
    <tr className="border-t border-line" data-trial-score={label}>
      <th scope="row" className="py-2 pr-3 text-left font-normal text-ink-2">
        {label}
        <span className="block text-[12px] text-muted">
          {score.tasks} {score.tasks === 1 ? 'task' : 'tasks'}
        </span>
      </th>
      <td className="py-2 pr-3 tabular-nums text-ink">{miss(score.niveloftMiss)}</td>
      <td className="py-2 pr-3 tabular-nums text-ink">{miss(score.modelMiss)}</td>
      <td className="py-2 text-[12.5px] text-muted tabular-nums">
        {score.tasks ? `model ${score.modelCloser}, Niveloft ${score.niveloftCloser}` : ''}
      </td>
    </tr>
  );
}

/**
 * The forecast model trial on the Delivery page: a model the ml/ kit trained on this team's
 * finished work and recommended, run beside Niveloft's forecast, never instead of it. Shown only
 * when the server has one on trial. Both forecasts are of the same thing (working days from when a
 * task could proceed to its final submission), recorded the first time they were made.
 */
export function ForecastTrialSection({ project }: { project: ProjectDetail }) {
  const { data } = useForecastTrialQuery(project.id);
  if (!data?.available || !data.model) return null;
  return <TrialBody trial={data} projectKey={project.key} />;
}

function TrialBody({ trial, projectKey }: { trial: ForecastTrial; projectKey: string }) {
  const m = trial.model!;
  // One model per server, run on every project: say so when this project's work wasn't in its training.
  const newGround = m.trainedProjects.length > 0 && !m.trainedProjects.includes(projectKey);
  const before = trial.beforeFinish;
  const after = trial.afterTheFact;
  return (
    <section className="rounded-xl border border-line bg-surface" aria-labelledby="forecast-trial-title" data-forecast-trial="">
      <header className="border-b border-line px-5 py-4">
        <h2 id="forecast-trial-title" className="flex items-center gap-2 text-[16px] font-semibold text-ink">
          <FlaskConical className="size-4 text-muted" aria-hidden="true" /> Forecast model trial
        </h2>
        <p className="mt-0.5 max-w-2xl text-[12.5px] text-muted">
          A model trained on finished work, run beside Niveloft’s forecast to see whether it keeps doing better on new work. Niveloft’s forecast is still the one the app uses.
        </p>
      </header>
      <div className="space-y-4 px-5 py-4">
        <p className="text-[12.5px] text-ink-2" data-trial-model="">
          {m.description || m.name}, trained on {m.trainedTasks} finished {m.trainedTasks === 1 ? 'task' : 'tasks'}
          {m.trainedThrough ? ` up to ${formatDate(m.trainedThrough, 'd MMM yyyy')}` : ''}.
          {newGround && ' None of them were from this project, so here it’s being tried on a project it has never seen.'}
        </p>
        {m.synthetic && (
          <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-[12.5px] text-ink" data-trial-synthetic="">
            Trained on the kit’s made-up data: this shows how the trial works, and says nothing about this team.
          </p>
        )}
        {trial.verdict && (
          <p className="text-[14px] leading-relaxed text-ink" data-trial-verdict="">
            {trial.verdict}
          </p>
        )}
        {before && after && (before.tasks > 0 || after.tasks > 0) && (
          <table className="w-full max-w-3xl text-[13px]" data-trial-scores="">
            <caption className="sr-only">How each forecast did on finished work</caption>
            <thead>
              <tr className="text-left text-[12px] text-muted">
                <th scope="col" className="pb-1.5 pr-3 font-medium">
                  Finished work
                </th>
                <th scope="col" className="pb-1.5 pr-3 font-medium">
                  Niveloft’s typical miss
                </th>
                <th scope="col" className="pb-1.5 pr-3 font-medium">
                  The model’s
                </th>
                <th scope="col" className="pb-1.5 font-medium">
                  Closer
                </th>
              </tr>
            </thead>
            <tbody>
              <ScoreRow label="Forecast before it was submitted" score={before} />
              {after.tasks > 0 && <ScoreRow label="Checked after the fact" score={after} />}
            </tbody>
          </table>
        )}
        {trial.open.length > 0 && (
          <div>
            <h3 className="text-[13px] font-medium text-ink">Work in progress</h3>
            <ul className="mt-2 divide-y divide-line rounded-lg border border-line" data-trial-open={trial.open.length}>
              {trial.open.map((o) => {
                const longer = o.modelDays > o.niveloftDays;
                return (
                  <li key={o.taskId} className="grid gap-x-4 gap-y-1 px-4 py-2.5 text-[13px] sm:grid-cols-[minmax(0,1fr)_auto]">
                    <span className="min-w-0">
                      <TaskRef taskKey={o.taskKey} /> <span className="text-muted">going for {days(o.elapsedDays)}</span>
                    </span>
                    <span className="tabular-nums text-ink-2">
                      Niveloft: about {days(o.niveloftDays)} in all.{' '}
                      <span className={cn(Math.abs(o.modelDays - o.niveloftDays) >= 1 && 'font-medium text-ink')}>
                        The model: about {days(o.modelDays)}
                        {Math.abs(o.modelDays - o.niveloftDays) >= 1 ? (longer ? ', longer' : ', shorter') : ''}.
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        {trial.recent.length > 0 && (
          <details className="text-[12.5px]">
            <summary className="cursor-pointer text-muted hover:text-ink">The latest finished work in the trial</summary>
            <table className="mt-2 w-full max-w-3xl" data-trial-recent="">
              <thead>
                <tr className="text-left text-[12px] text-muted">
                  <th scope="col" className="py-1 pr-3 font-medium">
                    Task
                  </th>
                  <th scope="col" className="py-1 pr-3 font-medium">
                    Took
                  </th>
                  <th scope="col" className="py-1 pr-3 font-medium">
                    Niveloft
                  </th>
                  <th scope="col" className="py-1 font-medium">
                    Model
                  </th>
                </tr>
              </thead>
              <tbody>
                {trial.recent.map((r) => (
                  <tr key={r.taskId} className="border-t border-line tabular-nums">
                    <td className="py-1.5 pr-3">
                      <TaskRef taskKey={r.taskKey} />
                      {!r.beforeFinish && <span className="ml-1 text-muted">(after the fact)</span>}
                    </td>
                    <td className="py-1.5 pr-3 text-ink">{days(r.actualDays)}</td>
                    <td className="py-1.5 pr-3">{days(r.niveloftDays)}</td>
                    <td className="py-1.5">{days(r.modelDays)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        )}
        <p className="max-w-3xl text-[12px] leading-relaxed text-muted">
          Both forecasts are of the same thing: working days from when a task could proceed to its final submission for review. Each is recorded the first time it’s made and never
          changed. An operator can stop the trial in Site health; nothing else changes.
        </p>
      </div>
    </section>
  );
}

/** One line for the project settings: whether a model is on trial, and where to see it. */
export function ForecastTrialStatus({ project }: { project: ProjectDetail }) {
  const { data } = useForecastTrialQuery(project.id);
  if (!data) return null;
  return (
    <p className="mt-3 border-t border-line pt-3 text-xs leading-relaxed text-muted" data-trial-status={data.available ? 'on' : 'off'}>
      {data.available ? (
        <>
          A trained model is on trial beside Niveloft’s forecast:{' '}
          <Link to={`/projects/${project.id}/delivery`} className="text-accent hover:underline">
            see it on Delivery
          </Link>
          .
        </>
      ) : (
        data.reason
      )}
    </p>
  );
}
