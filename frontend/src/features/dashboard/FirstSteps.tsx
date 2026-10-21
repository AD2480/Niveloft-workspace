import { Check, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/Button';
import { PersonaOptions } from '@/features/roles/RolePicker';
import { cn } from '@/lib/cn';
import { PERSONAS, personaFor, savePersona, type Persona } from '@/lib/persona';
import { readJson, writeStorage } from '@/lib/storage';

interface Step {
  id: string;
  title: string;
  text: ReactNode;
  /** Proven by the records (for example, you have a project). Otherwise the person ticks it. */
  done?: boolean;
  action?: ReactNode;
}

interface Facts {
  projects: number;
  myOpenTasks: number;
  onCreateProject: () => void;
}

const linkCls = 'text-[12.5px] font-medium text-accent hover:underline';

function stepsFor(persona: Persona, f: Facts): Step[] {
  const hasProject = f.projects > 0;
  const joined = { done: hasProject, action: hasProject ? undefined : <span className="text-[12.5px] text-muted">Invitations appear at the top of this page.</span> };
  switch (persona) {
    case 'OWNER':
      return [
        {
          id: 'create',
          title: 'Create your first project',
          text: 'You become its Owner: you set its dates, its team and who reviews.',
          done: hasProject,
          action: hasProject ? undefined : (
            <Button size="xs" onClick={f.onCreateProject}>
              New project
            </Button>
          ),
        },
        { id: 'invite', title: 'Invite your team', text: 'In the project, open Team. Give leads the Manager role; people doing the work are Members.', action: <Link to="/projects" className={linkCls}>Your projects</Link> },
        { id: 'tasks', title: 'Add tasks with acceptance criteria', text: 'Say what “done” means before work starts, and assign each task to one person.' },
        { id: 'review', title: 'Review submitted work', text: 'Waiting reviews show under “What needs attention” below. You can’t approve your own work.' },
      ];
    case 'MANAGER':
      return [
        { id: 'join', title: 'Join your project as Manager', text: 'Ask its owner to add you with the Manager role. Projects you create yourself are yours as Owner.', ...joined },
        { id: 'plan', title: 'Plan and assign tasks', text: 'Give every task criteria, a due date and one assignee.', action: <Link to="/projects" className={linkCls}>Your projects</Link> },
        { id: 'review', title: 'Review submitted work', text: 'Check each criterion against the evidence, then approve or ask for changes.' },
      ];
    case 'MEMBER':
      return [
        { id: 'join', title: 'Join your team’s project', text: 'Accept the invitation, or ask the project’s owner to add you.', ...joined },
        {
          id: 'tasks',
          title: 'Open your tasks',
          text: 'Everything assigned to you, soonest due first.',
          action: <Link to="/my-tasks" className={linkCls}>My tasks{f.myOpenTasks ? ` (${f.myOpenTasks})` : ''}</Link>,
        },
        { id: 'submit', title: 'Finish, prove, submit', text: 'Tick the checklist, attach evidence, then submit. Only the assignee can submit; a manager reviews it.' },
      ];
    case 'VIEWER':
      return [
        { id: 'join', title: 'Join a project as Viewer', text: 'Ask its owner to add you. Viewers can see everything and change nothing.', ...joined },
        { id: 'overview', title: 'Read the Overview', text: 'Status, the forecast, deadlines and milestones on one page.', action: <Link to="/projects" className={linkCls}>Your projects</Link> },
        { id: 'model', title: 'Replay it in 3D', text: 'Open Model and press play to watch the project happen day by day.' },
      ];
  }
}

/**
 * "Your first steps" on Today, for the way the person said they'd use Niveloft. Steps the
 * records prove are ticked for them; the rest they tick themselves. It can be hidden for good.
 */
export function FirstSteps({ userId, ...facts }: Facts & { userId: number }) {
  const hiddenKey = `projectflow.firststeps.hidden.${userId}`;
  const tickedKey = `projectflow.firststeps.ticked.${userId}`;
  const [persona, setPersona] = useState<Persona | null>(() => personaFor(userId));
  const [hidden, setHidden] = useState(() => readJson<boolean>(hiddenKey) === true);
  const [ticked, setTicked] = useState<string[]>(() => readJson<string[]>(tickedKey) ?? []);
  if (hidden) return null;

  const hide = () => {
    writeStorage(hiddenKey, 'true');
    setHidden(true);
  };
  const toggle = (id: string) => {
    const next = ticked.includes(id) ? ticked.filter((t) => t !== id) : [...ticked, id];
    writeStorage(tickedKey, JSON.stringify(next));
    setTicked(next);
  };

  const steps = persona ? stepsFor(persona, facts) : [];
  const isDone = (s: Step) => s.done === true || ticked.includes(s.id);
  const doneCount = steps.filter(isDone).length;
  const label = persona ? PERSONAS.find((p) => p.value === persona)!.line : null;

  return (
    <section aria-labelledby="first-steps-heading" className="rounded-lg border border-line bg-surface shadow-card">
      <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
        <div className="min-w-0">
          <h2 id="first-steps-heading" className="text-[15px] font-semibold text-ink">
            Your first steps
          </h2>
          <p className="mt-0.5 text-[12.5px] text-muted">
            {persona ? (
              <>
                For how you said you’d work: <span className="font-medium text-ink-2">{label}</span>.{' '}
                <span className="tabular">
                  {doneCount} of {steps.length} done
                </span>
                .{' '}
                <button type="button" className="text-accent hover:underline" onClick={() => setPersona(null)}>
                  Change
                </button>
              </>
            ) : (
              'Tell us how you’ll use Niveloft and we’ll list what to do first.'
            )}
          </p>
        </div>
        <Button variant="ghost" size="icon-sm" aria-label="Hide first steps" onClick={hide}>
          <X />
        </Button>
      </div>

      {persona ? (
        <ol className={cn('grid gap-px overflow-hidden rounded-b-lg bg-line', steps.length === 4 ? 'sm:grid-cols-2 lg:grid-cols-4' : 'sm:grid-cols-3')}>
          {steps.map((s, i) => {
            const done = isDone(s);
            const proven = s.done === true;
            return (
              <li key={s.id} className="flex flex-col bg-surface p-4">
                <div className="flex items-start gap-3">
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={done}
                    aria-label={`${s.title}: ${done ? 'done' : 'not done'}`}
                    disabled={proven}
                    title={proven ? 'Done: your records show it' : done ? 'Mark as not done' : 'Mark as done'}
                    onClick={() => toggle(s.id)}
                    className={cn(
                      'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold tabular transition-colors',
                      done ? 'border-success bg-success text-white dark:text-canvas' : 'border-line-strong text-muted hover:border-ink',
                    )}
                  >
                    {done ? <Check className="size-3" strokeWidth={3} /> : i + 1}
                  </button>
                  <div className="min-w-0">
                    <p className={cn('text-[13.5px] font-medium', done ? 'text-muted line-through decoration-line-strong' : 'text-ink')}>{s.title}</p>
                    <p className="mt-1 text-[12.5px] leading-relaxed text-muted">{s.text}</p>
                  </div>
                </div>
                {s.action && !done && <div className="mt-3 pl-8">{s.action}</div>}
              </li>
            );
          })}
        </ol>
      ) : (
        <div className="p-4">
          <PersonaOptions
            value={null}
            compact
            name="first-steps-persona"
            onChange={(p) => {
              savePersona(userId, p);
              setPersona(p);
            }}
          />
          <p className="mt-2 text-xs text-muted">This only changes this list and your start page. What you can do in a project depends on the role that project gives you.</p>
        </div>
      )}
    </section>
  );
}
