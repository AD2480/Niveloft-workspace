import * as RD from '@radix-ui/react-dialog';
import { CopyButton } from '@/components/ui/CopyButton';
import { ArrowUp, CalendarClock, Info, ListTree, Mic, MoreHorizontal, PanelRight, PanelRightClose, RotateCcw, Snowflake, Sparkles, Square, TrafficCone, Volume2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { endpoints, useBoardTasksQuery, useDependenciesQuery, useMilestonesQuery, useMyTasksQuery, useProjectQuery, useProjectsQuery } from '@/api/endpoints';
import { changeHeadline, daysAgo, explainForecastChange, STEP_LABEL } from '@/lib/forecastChanges';
import type { AnalysisFact } from '@/lib/projectAnalysis';
import { getErrorMessage } from '@/api/errors';
import type { AiAnswer, AiLookup, ProjectDetail, Task } from '@/api/types';
import { LookupGlyph, type LookupResult } from '@/components/glyphs';
import { TaskRef } from '@/features/refs/TaskRef';
import { EvidenceLinks } from './EvidenceLinks';
import { AnswerFeedback } from './AnswerFeedback';
import { buttonClass } from '@/components/ui/buttonStyles';
import { Menu, MenuCheckItem, MenuContent, MenuItem, MenuLabel, MenuRadioGroup, MenuRadioItem, MenuSeparator, MenuTrigger } from '@/components/ui/Menu';
import { useAppDispatch, useAppSelector } from '@/app/store';
import { API_BASE_URL } from '@/config';
import { CORNER_GAP, TOP_BAR } from '@/features/flurry/FlurryCompanion';
import { FlurryFigure } from '@/features/flurry/FlurryFigure';
import { FLURRY_MODES, FLURRY_MOTIONS, isStill, useFlurryPrefs, type FlurryMode, type FlurryMotion } from '@/features/flurry/flurryPrefs';
import { briefFrom, draftPlanFromBrief } from '@/lib/planDraft';
import { todayIso } from '@/lib/dates';
import { useMediaQuery } from '@/lib/hooks';
import { BrowserAiOffer } from '@/features/ai/BrowserAiOffer';
import { AskStopped, useProjectAi } from '@/features/ai/useProjectAi';
import { AnswerInProgress } from '@/features/ai/AnswerInProgress';
import { useProjectModel } from '@/features/model/useProjectModel';
import { parseIntent, suggestNext, type Intent } from '@/lib/assistantIntents';
import { learn } from '@/lib/projectLearner';
import { cn } from '@/lib/cn';
import { can } from '@/lib/permissions';
import { STATUS_LABEL } from '@/lib/constants';
import { myForecastFacts, projectForecastFacts } from '@/lib/forecastText';
import { forecastProgress } from '@/lib/progressForecast';
import { recentChanges, shortDate } from '@/lib/projectAnalysis';
import { dayToIso, type ProjectModel } from '@/three/projectModel';
import { useAssistant, type InputSource, type Reply } from './assistantContext';
import { meetingAgenda, reviewBlockers, summariseProgress, type BlockerFinding, type ReportLine } from './flurryReports';
import { answerLocally } from './localAnswer';
import { answerAboutTask, type TaskAnswer } from './taskAnswer';
import { PlanCard, type PlanView } from './PlanCard';
import { ProposalCard } from './ProposalCard';
import { canReadAloud, speak, stopSpeaking, voiceErrorMessage, voiceInputSupported } from './voice';

const SOURCE_LABEL: Record<Reply['kind'], string | null> = {
  info: null,
  summary: 'Flurry, computed from the records (no AI model)',
  blockers: 'Flurry, computed from the records (no AI model)',
  agenda: 'Flurry, drafted from the records (no AI model)',
  plan: null,
  facts: 'Computed from the records, not by AI',
  changes: 'Computed from the records, not by AI',
  tasks: 'Computed from the records, not by AI',
  action: 'A command: nothing changes until you confirm',
  ai: 'AI',
  local: 'Built-in model, trained on this project’s records (no AI service)',
  task: 'Flurry, computed from the records (no AI model)',
  'choose-project': null,
};

/** Short text for reading a reply aloud, saying where it came from. */
function spoken(r: Reply): string {
  switch (r.kind) {
    case 'info':
      return r.text;
    case 'summary':
      return `From the records. ${r.summary.title}. ${r.summary.recorded.slice(0, 3).map((l) => l.text).join(' ')}`;
    case 'blockers':
      return r.findings.length ? `From the records. ${r.findings.slice(0, 3).map((f) => `${f.title}. ${f.suggestion}`).join(' ')}` : 'From the records. Nothing is blocked, overdue or without an owner.';
    case 'agenda':
      return 'I’ve drafted a meeting agenda from the records. You can copy it and edit it before sending.';
    case 'plan':
      return `I’ve drafted ${r.plan.tasks.length === 1 ? 'one task' : `${r.plan.tasks.length} tasks`}. Review them, then press Create; nothing changes until you do.`;
    case 'facts':
      return `From the records. ${r.facts.length ? [r.title, ...r.facts.slice(0, 3).map((f) => `${f.title}. ${f.detail}`)].join('. ') : (r.empty ?? r.title)}`;
    case 'changes':
      return `From the records. ${r.events.length ? `${r.title}. ${r.events.slice(0, 3).map((e) => `${e.event.key} ${e.event.kind}`).join(', ')}.` : r.title}`;
    case 'tasks':
      return `From the records. ${r.items.length ? `${r.title}. ${r.items.slice(0, 3).map((i) => `${i.task.key}, ${i.task.title}, ${i.reason}`).join('. ')}.` : r.title}`;
    case 'action':
      return r.draft.type === 'create' ? 'I’ve prepared a task draft. Review it and press Create to save it.' : `Press the button to start ${r.draft.key}.`;
    case 'ai':
      return `AI answer, which can be wrong. ${r.answer.answer}`;
    case 'local':
      return `From the built-in model. ${r.answer.title}. ${r.answer.lines.slice(0, 3).map((l) => l.text).join(' ')}`;
    case 'task':
      return `From the records. ${r.answer.title} ${r.answer.next}`;
    case 'choose-project':
      return r.text;
  }
}

function examples(project: ProjectDetail | undefined, tasks: readonly Task[] | undefined): string[] {
  const todo = tasks?.find((t) => t.status === 'TODO');
  return [
    'Will we make the deadline?',
    'What should I work on next?',
    'What changed this week?',
    'Why did the date move?',
    'Draft a meeting agenda',
    'Create a task to write release notes, due Friday',
    ...(todo ? [`Start ${todo.key}`] : project ? [`Open ${project.key}-1`] : []),
  ];
}

/** Flurry's three starting abilities, shown as the first thing in an empty conversation. */
const STARTERS = [
  { ask: 'Plan a project', icon: ListTree, blurb: 'Turn a brief into draft tasks you review first.' },
  { ask: 'Summarise progress', icon: CalendarClock, blurb: 'Where things stand, what that suggests, what isn’t known.' },
  { ask: 'Review blockers', icon: TrafficCone, blurb: 'Waiting work, overdue work and missing owners, with next moves.' },
] as const;

/**
 * Flurry, Niveloft's AI project assistant, available from every signed-in page (Flurry in the
 * corner, or Alt+A). Its starting abilities (plan a project, summarise progress, review blockers)
 * and the predictive questions and task commands are worked out from the records without AI, and
 * labelled so; a plan can also be drafted by AI. Free questions go to the server's AI when it has
 * one, otherwise to the AI built into Chrome (on this device), otherwise to the built-in model.
 * Everything that would change data becomes a draft or a confirm button: nothing changes until the
 * person confirms, voice can't confirm, and completed changes offer Undo.
 */
export function AssistantPanel() {
  const a = useAssistant();
  const userId = useAppSelector((s) => s.auth.user?.id ?? 0);
  const [prefs] = useFlurryPrefs(userId);
  const phone = !useMediaQuery('(min-width: 640px)');
  const large = useMediaQuery('(min-width: 1024px)');
  const pinned = prefs.pinned && large;
  // The card grows wider only when a reply needs the room (a plan to review, an agenda).
  const roomy = a.messages.some((m) => m.role === 'assistant' && (m.reply.kind === 'plan' || m.reply.kind === 'agenda'));

  // Pinned beside the page, the page makes room for it instead of being covered.
  useEffect(() => {
    const dock = a.open && pinned;
    document.documentElement.style.setProperty('--flurry-dock', dock ? `${DOCK_WIDTH}px` : '0px');
    return () => {
      document.documentElement.style.removeProperty('--flurry-dock');
    };
  }, [a.open, pinned]);

  const [v, h] = prefs.corner.split('-');
  const style: CSSProperties | undefined =
    phone || pinned
      ? undefined
      : {
          width: `min(${roomy ? 520 : 400}px, calc(100vw - 2rem))`,
          height: v === 'top' ? `min(640px, calc(100dvh - ${TOP_BAR + CORNER_GAP * 2}px))` : `min(640px, calc(100dvh - ${CORNER_GAP * 2}px))`,
          [v === 'top' ? 'top' : 'bottom']: v === 'top' ? TOP_BAR + CORNER_GAP : CORNER_GAP,
          ...(h === 'left' ? { left: `calc(${large ? 'var(--app-sidebar, 0px)' : '0px'} + ${CORNER_GAP}px)` } : { right: CORNER_GAP }),
        };

  return (
    <RD.Root open={a.open} onOpenChange={a.setOpen} modal={false}>
      <RD.Portal>
        <RD.Content
          data-assistant-panel=""
          data-flurry-surface={phone ? 'full' : pinned ? 'pinned' : 'card'}
          style={style}
          className={cn(
            'fixed z-40 flex flex-col bg-surface focus:outline-none dark:bg-surface-2',
            phone
              ? 'inset-0'
              : pinned
                ? 'inset-y-0 right-0 border-l border-line animate-slide-in-right'
                : 'overflow-hidden rounded-2xl border border-line shadow-float animate-rise-in',
          )}
          aria-describedby={undefined}
          // Stay open while the person works on the page beside it; Esc or the close button closes it.
          onInteractOutside={(e) => e.preventDefault()}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            document.querySelector<HTMLTextAreaElement>('[data-assistant-input]')?.focus();
          }}
          // Flurry in the corner takes focus back when it reappears (see FlurryCompanion).
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          {pinned && <style>{`[data-assistant-panel][data-flurry-surface="pinned"]{width:${DOCK_WIDTH}px}`}</style>}
          <AssistantBody canPin={large && !phone} />
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}

/** Width of the conversation when it's pinned beside the page. */
export const DOCK_WIDTH = 420;

function AssistantBody({ canPin }: { canPin: boolean }) {
  const a = useAssistant();
  const navigate = useNavigate();
  const location = useLocation();
  const routeProjectId = Number(/^\/projects\/(\d+)/.exec(location.pathname)?.[1] ?? NaN);
  const routeTaskId = Number(/^\/projects\/\d+\/(?:board\/)?tasks\/(\d+)/.exec(location.pathname)?.[1] ?? NaN);
  const projects = useProjectsQuery({ status: 'ACTIVE', size: 50 });
  // Scope: the project you're in, or all your projects (Today, My work, …). Never a guess.
  const [chosen, setChosen] = useState<number | 'all'>(Number.isFinite(routeProjectId) ? routeProjectId : 'all');
  useEffect(() => {
    setChosen(Number.isFinite(routeProjectId) ? routeProjectId : 'all');
  }, [routeProjectId]);
  const projectId = chosen === 'all' ? null : chosen;
  const projectQ = useProjectQuery(projectId ?? 0, { skip: projectId === null });
  // currentData: never answer about the previous project while switching.
  const project = projectQ.currentData;
  const pm = useProjectModel(project ?? null);
  const board = useBoardTasksQuery(projectId ?? 0, { skip: projectId === null });
  const mine = useMyTasksQuery({ status: 'OPEN', size: 100 });
  const deps = useDependenciesQuery(projectId ?? 0, { skip: projectId === null });
  const milestones = useMilestonesQuery(projectId ?? 0, { skip: projectId === null });
  const ai = useProjectAi();
  const firstName = useAppSelector((s) => s.auth.user?.name?.split(' ')[0] ?? '');
  const userId = useAppSelector((s) => s.auth.user?.id ?? null);
  const token = useAppSelector((s) => s.auth.token);
  const dispatch = useAppDispatch();
  const [awaitingBrief, setAwaitingBrief] = useState(false);
  const aiAvailable = ai.route.kind === 'server' || ai.route.kind === 'browser';

  const [text, setText] = useState('');
  const [listening, setListening] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  /** Why the browser's voice read the last answer instead of the server's. */
  const [voiceNote, setVoiceNote] = useState<string | null>(null);
  const [lastSource, setLastSource] = useState<InputSource>('typed');
  const [waiting, setWaiting] = useState<{ text: string; source: InputSource }[]>([]);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const mounted = useRef(true);
  const canListen = useMemo(() => voiceInputSupported(), []);
  const canSpeak = canReadAloud(ai.voice);
  const messages = a.messages;

  // Everything a request might need has either loaded or failed; until then requests wait.
  const ready =
    !projects.isLoading &&
    (projectId === null || (!projectQ.isLoading && !(projectQ.isFetching && !project))) &&
    (projectId === null || !board.isLoading) &&
    !pm.loading &&
    !mine.isLoading &&
    ai.route.kind !== 'checking';

  // The latest data, for requests handled after a delay (voice, the wake phrase, loading).
  const snapshot = () => ({
    project,
    model: pm.model,
    analysis: pm.analysis,
    modelError: pm.error,
    board: board.currentData,
    deps: deps.currentData,
    milestones: milestones.currentData,
    mine: mine.data?.content,
    projectsList: projects.data?.content,
    aiAvailable,
    aiBusy: ai.busy,
    messages,
    speakAnswers: a.speakAnswers,
    serverVoice: ai.voice,
    token,
  });
  const latest = useRef(snapshot());
  latest.current = snapshot();

  /** Reads a reply aloud: the server's natural voice when it has one, else (or if that fails) the browser's. */
  const readAloud = (t: string) => {
    if (!latest.current.speakAnswers || !mounted.current) return;
    setVoiceNote(null);
    speak(t, { serverVoice: latest.current.serverVoice, token: latest.current.token, apiBase: API_BASE_URL, onFallback: (why) => mounted.current && setVoiceNote(why) });
  };

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      stopSpeaking();
    };
  }, []);

  useEffect(() => {
    // The intro starts at the top; once there's a conversation, keep the latest in view.
    if (!messages.length && !waiting.length) return;
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' });
  }, [messages, ai.busy, waiting.length]);

  const reply = (r: Reply) => {
    a.pushMessage({ role: 'assistant', reply: r });
    if (r.kind === 'info' && r.tone === 'error') a.signal('error');
    readAloud(spoken(r));
  };

  // Flurry thinks while the AI works or requests wait for the records.
  const thinking = ai.busy || waiting.length > 0;
  useEffect(() => {
    a.signal(thinking ? 'busy' : 'idle');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thinking]);

  /** Why AI can't answer right now, in the server's own words when it gave them. */
  const aiUnavailableText = () => (ai.route.kind === 'none' ? ai.route.reason : 'AI isn’t available right now.');

  const answer = async (intent: Intent, question: string) => {
    const { project: p, model, analysis, modelError, board: tasks, mine: myTasks, projectsList, aiAvailable: aiOn, aiBusy } = latest.current;
    // Scope is all projects: say so, and ask which one (never answer about a guessed project).
    const noProject = () =>
      projectsList?.length === 0 || !projectsList
        ? reply({ kind: 'info', text: 'You’re not a member of any active project yet.' })
        : reply({
            kind: 'choose-project',
            text: 'I’m looking at all your projects right now. Which one is this about?',
            projects: projectsList.slice(0, 6).map((x) => ({ id: x.id, key: x.key, name: x.name })),
            question,
          });
    const needModel = (): boolean => {
      if (model && analysis) return true;
      reply({ kind: 'info', text: modelError ? `I couldn’t load this project’s records (${getErrorMessage(modelError)}).` : 'This project has no records to work from yet.' });
      return false;
    };
    const otherProject = (key: string) => projectsList?.find((x) => x.key === key.split('-')[0] && x.id !== p?.id);

    const reportInput = () => ({
      project: p!,
      tasks: tasks ?? [],
      dependencies: latest.current.deps ?? [],
      milestones: latest.current.milestones ?? [],
      analysis,
      today: todayIso(),
    });
    const needTasks = (): boolean => {
      if (tasks) return true;
      reply({ kind: 'info', tone: 'error', text: `I couldn’t load the tasks of ${p?.name ?? 'this project'}, so I can’t work that out. Try again in a moment.` });
      return false;
    };

    switch (intent.kind) {
      case 'plan': {
        if (!p) return noProject();
        const brief = intent.brief ? briefFrom(rawInput.current) || intent.brief : null;
        if (!brief) {
          setAwaitingBrief(true);
          return reply({
            kind: 'info',
            text: `Paste the brief or describe the work for ${p.name}: one piece of work per line works best. I’ll draft tasks for you to review; nothing is created until you confirm.`,
          });
        }
        return planFrom(p, brief, tasks);
      }
      case 'summary':
        if (!p) return noProject();
        if (!needTasks()) return;
        return reply({ kind: 'summary', project: p, summary: summariseProgress(reportInput()), question });
      case 'blockers':
        if (!p) return noProject();
        if (!needTasks()) return;
        return reply({ kind: 'blockers', project: p, findings: reviewBlockers(reportInput()), question });
      case 'agenda':
        if (!p) return noProject();
        if (!needTasks()) return;
        return reply({ kind: 'agenda', project: p, text: meetingAgenda(reportInput()) });
      case 'greeting':
        return reply({
          kind: 'info',
          text: `Hi${firstName ? ` ${firstName}` : ''}. I’m Flurry, your project assistant. I work from ${p ? `${p.name}’s` : 'your projects’'} records, keep facts and estimates apart, and ask before changing anything. What would you like to do?`,
          examples: ['Plan a project', 'Summarise progress', 'Review blockers'],
        });
      case 'thanks':
        return reply({ kind: 'info', text: 'You’re welcome. Ask whenever you need the next move.' });
      case 'help':
        return reply({
          kind: 'info',
          text: 'I can plan a project from a brief, summarise progress, review blockers, draft a meeting agenda, forecast, suggest what to work on next, and prepare tasks for you to confirm. Try:',
          examples: ['Plan a project', 'Summarise progress', 'Review blockers', ...examples(p, tasks)],
        });
      case 'create-task':
        if (!p) return noProject();
        return reply({ kind: 'action', project: p, draft: { type: 'create', title: intent.title, priority: intent.priority, due: intent.due, assignee: intent.assignee, estimate: intent.estimate } });
      case 'start-task': {
        if (!p) return noProject();
        const other = otherProject(intent.key);
        if (other) return reply({ kind: 'info', text: `${intent.key} belongs to ${other.name}. Choose it at the top, then ask again.` });
        return reply({ kind: 'action', project: p, draft: { type: 'start', key: intent.key } });
      }
      case 'open-task': {
        if (!p) return noProject();
        const t = tasks?.find((x) => x.key.toUpperCase() === intent.key);
        if (t) {
          navigate(`/projects/${p.id}/tasks/${t.id}`);
          return reply({ kind: 'info', text: `Opened ${t.key} “${t.title}”.` });
        }
        const other = otherProject(intent.key);
        if (other) return reply({ kind: 'info', text: `${intent.key} belongs to ${other.name}. Choose it at the top, then ask again.` });
        return reply({ kind: 'info', text: tasks ? `There’s no ${intent.key} in ${p.name}.` : `I couldn’t load the tasks of ${p.name}, so I can’t find ${intent.key}.` });
      }
      case 'task-question': {
        const prefix = intent.key.split('-')[0];
        const owner = projectsList?.find((x) => x.key === prefix);
        if (!p || p.key !== prefix) {
          if (owner) return reply({ kind: 'choose-project', text: `${intent.key} is in ${owner.name}${p ? `, not ${p.name}` : ''}. Look at it there?`, projects: [{ id: owner.id, key: owner.key, name: owner.name }], question });
          return reply({ kind: 'info', text: `I can’t find ${intent.key} in your projects. Check the key, or open the task and ask from there.` });
        }
        if (!needTasks()) return;
        const found = answerAboutTask(intent.key, intent.aspect, tasks ?? [], latest.current.deps ?? [], todayIso());
        if (!found) return reply({ kind: 'info', text: `There’s no ${intent.key} in ${p.name}.` });
        return reply({ kind: 'task', project: p, answer: found, question });
      }
      case 'open-model':
        if (!p) return noProject();
        navigate(`/projects/${p.id}/model`);
        return reply({ kind: 'info', text: `Opened the 3D model of ${p.name}.` });
      case 'my-work':
      case 'next': {
        if (!myTasks) return reply({ kind: 'info', text: 'I couldn’t load your tasks. Try again in a moment.' });
        const ranked = suggestNext(myTasks);
        const inReview = myTasks.filter((t) => t.status === 'IN_REVIEW');
        if (!ranked.length) {
          return reply({
            kind: 'info',
            text: inReview.length
              ? `Everything assigned to you is waiting for a reviewer: ${inReview.map((t) => t.key).join(', ')}.`
              : 'Nothing open is assigned to you right now.',
          });
        }
        if (intent.kind === 'next') {
          return reply({ kind: 'tasks', title: 'Suggested order for your open work', summary: 'Overdue first, then work in progress, then what’s due soonest.', items: ranked.slice(0, 3), question });
        }
        const byStatus = (s: Task['status']) => myTasks.filter((t) => t.status === s).length;
        return reply({
          kind: 'tasks',
          title: `${myTasks.length} open ${myTasks.length === 1 ? 'task is' : 'tasks are'} assigned to you`,
          summary: `${byStatus('TODO')} to do, ${byStatus('IN_PROGRESS')} in progress, ${byStatus('IN_REVIEW')} waiting for review.`,
          items: ranked.slice(0, 5),
          question,
        });
      }
      case 'forecast': {
        if (!p) return noProject();
        if (!needModel()) return;
        // The dependency-aware forecast (a range), computed here from the records; Flurry explains it, it doesn't invent it.
        const f = tasks?.length ? forecastProgress({ model: model!, tasks, members: p.members }) : null;
        if (f) return reply({ kind: 'facts', title: `Forecast for ${p.name}`, facts: projectForecastFacts(f, model!.originMs), question });
        return reply({ kind: 'facts', title: `Forecast for ${p.name}`, facts: analysis!.facts.filter((x) => ['finish', 'assumed', 'late', 'clears'].includes(x.id)), question });
      }
      case 'date-moved': {
        if (!p) return noProject();
        if (!needTasks()) return;
        return void whyDateMoved(p, intent.days, question);
      }
      case 'my-finish': {
        if (!p) return noProject();
        if (!needModel()) return;
        const f = tasks?.length ? forecastProgress({ model: model!, tasks, members: p.members }) : null;
        const facts = f ? myForecastFacts(f, model!.originMs, userId) : null;
        if (!facts) return reply({ kind: 'info', text: `Nothing open is assigned to you in ${p.name}, so there’s nothing of yours to forecast.`, examples: ['Will we make the deadline?', 'Review blockers'] });
        return reply({ kind: 'facts', title: `Your forecast in ${p.name}`, facts, question });
      }
      case 'risks': {
        if (!p) return noProject();
        if (!needModel()) return;
        const flagged = analysis!.facts.filter((f) => f.tone === 'danger' || f.tone === 'warning');
        // Only claim what was checked: without a forecast, lateness can't be judged.
        const empty = analysis!.forecastFinish
          ? 'Nothing is flagged: no overdue work, nothing estimated to finish after its due date and no long review waits.'
          : 'No overdue work and no long review waits. There’s no forecast for the open work, so whether it will be late can’t be judged.';
        return reply({ kind: 'facts', title: `What needs attention in ${p.name}`, facts: flagged, empty, question });
      }
      case 'changes': {
        if (!p) return noProject();
        if (!needModel()) return;
        const all = recentChanges(model!, intent.days);
        const shown = all.slice(0, 14);
        return reply({
          kind: 'changes',
          title: all.length ? `In the last ${intent.days} days in ${p.name}` : `No status changes were recorded in ${p.name} in the last ${intent.days} days.`,
          events: shown.map((event) => ({ event, date: shortDate(dayToIso(model!.originMs, event.day)) })),
          more: all.length - shown.length,
          question,
        });
      }
      case 'question':
        if (!p) return noProject();
        if (!aiOn) {
          // No AI service: answer from the built-in model trained on this project's records.
          if (model && tasks?.length) return reply({ kind: 'local', answer: answerLocally(question, learn(tasks, model), tasks, model), question });
          return reply({ kind: 'info', text: `That question needs the AI. ${aiUnavailableText()} These work without AI:`, examples: examples(p, tasks) });
        }
        if (aiBusy || aiInFlight.current) return reply({ kind: 'info', text: 'I’m still answering your last question. Ask again when it’s done.' });
        return askAi(p, question, model, tasks);
    }
  };

  /** "Why did the date move?": the forecast replayed from the records as of `days` ago (no AI). */
  const whyDateMoved = async (p: ProjectDetail, days: number, question: string) => {
    const since = daysAgo(days);
    const log = dispatch(endpoints.endpoints.projectChanges.initiate({ projectId: p.id, since: since.toISOString() }));
    const hist = dispatch(endpoints.endpoints.projectHistory.initiate(p.id));
    try {
      const [changes, history] = await Promise.all([log.unwrap(), hist.unwrap()]);
      const cur = latest.current;
      const c = explainForecastChange({
        now: new Date(),
        since,
        project: { startDate: p.startDate, deadline: p.deadline },
        tasks: cur.board ?? [],
        dependencies: cur.deps ?? [],
        milestones: cur.milestones ?? [],
        history,
        members: p.members,
        log: changes,
      });
      const ids = new Map((cur.board ?? []).map((t) => [t.key, t.id]));
      const dateText = (iso: string) => shortDate(iso);
      const facts: AnalysisFact[] = c.steps
        .filter((s) => s.facts.length || (s.days ?? 0) !== 0)
        .map((s) => ({
          id: `moved-${s.kind}`,
          source: 'recorded' as const,
          tone: s.days && s.days > 0 ? ('warning' as const) : s.days && s.days < 0 ? ('good' as const) : ('neutral' as const),
          title: `${STEP_LABEL[s.kind]}: ${s.days === null ? 'can’t be measured' : s.days === 0 ? 'no change to the date' : `${Math.abs(s.days)} working ${Math.abs(s.days) === 1 ? 'day' : 'days'} ${s.days > 0 ? 'later' : 'earlier'}`}`,
          detail: s.facts.map((f) => f.text).join('; ') + (s.facts.length ? '.' : ''),
          taskIds: [...new Set(s.facts.flatMap((f) => f.keys))].map((k) => ids.get(k)).filter((x): x is number => x !== undefined),
        }));
      for (const n of c.notes) facts.push({ id: `moved-note-${facts.length}`, source: 'recorded', tone: 'neutral', title: 'Not in this account', detail: n, taskIds: [] });
      return reply({ kind: 'facts', title: changeHeadline(c, dateText), facts, empty: 'Nothing that moves the date was recorded in that time.', question });
    } catch (e) {
      return reply({ kind: 'info', tone: 'error', text: `I couldn’t load what changed (${getErrorMessage(e)}), so I can’t say why the date moved. Try again in a moment.`, retry: question });
    } finally {
      log.unsubscribe();
      hist.unsubscribe();
    }
  };

  /** The text as typed (line breaks kept), for briefs. */
  const rawInput = useRef('');

  /** Drafts a plan: with AI when there is one (falling back to the brief's own lines), otherwise from the lines. */
  const planFrom = async (p: ProjectDetail, brief: string, tasks: readonly Task[] | undefined) => {
    setAwaitingBrief(false);
    const local = (fallback?: string) => {
      const d = draftPlanFromBrief(brief);
      if (!d.tasks.length) {
        return reply({
          kind: 'info',
          text: `${fallback ? 'The AI couldn’t draft a plan, and ' : ''}I couldn’t find any work to do in that brief. Write one piece of work per line, like “Write the welcome copy by Friday”, and ask again.`,
        });
      }
      const view: PlanView = {
        source: 'local',
        tasks: d.tasks,
        open: d.gaps,
        skipped: d.skipped,
        limits: ['Drafted from the lines of your brief without AI: each task is one line or sentence, and details come only from your words.'],
        fallback,
      };
      reply({ kind: 'plan', project: p, plan: view });
    };
    const { aiAvailable: aiOn } = latest.current;
    if (!aiOn) return local();
    if (aiInFlight.current) return reply({ kind: 'info', text: 'I’m still working on your last request. Ask again when it’s done.' });
    aiInFlight.current = true;
    try {
      const res = await ai.plan({ project: p, tasks, brief });
      reply({
        kind: 'plan',
        project: p,
        plan: { source: 'ai', model: res.model, tasks: res.tasks.map((t) => ({ ...t, source: '' })), open: res.questions, skipped: [], limits: res.limits },
      });
    } catch (e) {
      console.warn('[Flurry] AI plan failed; drafting from the brief instead:', e);
      const why = e instanceof Error ? e.message : getErrorMessage(e);
      local(`The AI couldn’t draft this plan, so this draft comes from your brief’s own lines instead. What went wrong: ${why.charAt(0).toLowerCase()}${why.slice(1)}`);
    } finally {
      aiInFlight.current = false;
    }
  };

  const aiInFlight = useRef(false);
  const askAi = async (p: ProjectDetail, question: string, model: ProjectModel | null, tasks: readonly Task[] | undefined) => {
    if (aiInFlight.current) return;
    aiInFlight.current = true;
    // Earlier AI turns about this same project only.
    const previous = latest.current.messages
      .flatMap((m) => (m.role === 'assistant' && m.reply.kind === 'ai' && m.reply.project.id === p.id ? [m.reply] : []))
      .slice(-3)
      .map((r) => ({ question: r.asked.slice(0, 500), answer: r.answer.answer.slice(0, 3900) }));
    try {
      const res = await ai.ask({ project: p, question, previous, model, tasks });
      reply({ kind: 'ai', project: p, answer: res, asked: question.slice(0, 500) });
    } catch (e) {
      if (e instanceof AskStopped) {
        reply({ kind: 'info', text: e.message, retry: question });
        return;
      }
      console.warn('[Flurry] AI answer failed:', e);
      reply({ kind: 'info', tone: 'error', text: e instanceof Error ? e.message : getErrorMessage(e), retry: question });
    } finally {
      aiInFlight.current = false;
    }
  };

  const handle = (raw: string, source: InputSource) => {
    let q = raw.trim();
    if (!q) return;
    // "this task" on a task's page means that task.
    const here = Number.isFinite(routeTaskId) ? board.currentData?.find((t) => t.id === routeTaskId) : undefined;
    if (here && /\b(?:this|the current) task\b/i.test(q) && !/\b[a-z][a-z0-9]{1,9}-\d+\b/i.test(q)) q = q.replace(/\b(?:this|the current) task\b/i, here.key);
    input.current?.focus();
    setLastSource(source);
    a.pushMessage({ role: 'user', text: q, source });
    setText('');
    rawInput.current = raw;
    // After "Plan a project", the next message is the brief (unless it's clearly another request).
    const intent = parseIntent(q);
    if (awaitingBrief && intent.kind === 'question') {
      if (!ready) return setWaiting((w) => [...w, { text: q, source }]);
      const p = latest.current.project;
      if (!p) return void answer({ kind: 'plan', brief: null }, q);
      return void planFrom(p, raw.trim(), latest.current.board);
    }
    if (awaitingBrief) setAwaitingBrief(false);
    if (ready) void answer(intent, q);
    else setWaiting((w) => [...w, { text: q, source }]);
  };

  // A question asked before choosing a project: answered once that project's records are in.
  const [afterScope, setAfterScope] = useState<{ projectId: number; question: string } | null>(null);
  const chooseProject = (id: number, question: string) => {
    setChosen(id);
    setAfterScope({ projectId: id, question });
  };
  useEffect(() => {
    if (!afterScope || !ready || project?.id !== afterScope.projectId) return;
    const q = afterScope.question;
    setAfterScope(null);
    rawInput.current = q;
    void answer(parseIntent(q), q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [afterScope, ready, project?.id]);

  // A different project: a new conversation, so answers about one project never sit under another.
  // Between all projects and one, a visible line says what the scope is now.
  const lastScope = useRef<number | 'all'>(chosen);
  useEffect(() => {
    const was = lastScope.current;
    lastScope.current = chosen;
    if (was === chosen || !latest.current.messages.length) return;
    const nameOf = (id: number | 'all') => (id === 'all' ? 'all your projects' : (projects.data?.content.find((x) => x.id === id)?.name ?? 'another project'));
    if (was !== 'all' && chosen !== 'all') {
      a.clearMessages();
      a.pushMessage({ role: 'assistant', reply: { kind: 'info', text: `New conversation about ${nameOf(chosen)}. The earlier one was about ${nameOf(was)}, so I set it aside to keep answers apart.` } });
    } else {
      a.pushMessage({ role: 'assistant', reply: { kind: 'info', text: `Scope: now ${nameOf(chosen)}. Answers above were about ${nameOf(was)}.` } });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosen]);

  // Requests that arrived while the records were loading.
  useEffect(() => {
    if (!ready || waiting.length === 0) return;
    const queue = waiting;
    setWaiting([]);
    for (const w of queue) {
      rawInput.current = w.text;
      const intent = parseIntent(w.text);
      if (awaitingBrief && intent.kind === 'question' && latest.current.project) void planFrom(latest.current.project, w.text, latest.current.board);
      else void answer(intent, w.text);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, waiting]);

  // Requests from the provider (the wake phrase with a command after it).
  const pending = a.pending;
  const handled = useRef(new Set<number>());
  useEffect(() => {
    if (!pending || handled.current.has(pending.id)) return;
    handled.current.add(pending.id);
    a.consumePending(pending.id);
    handle(pending.text, pending.source);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);

  const startListening = () => {
    setVoiceError(null);
    stopSpeaking();
    const ok = a.voice.listenOnce({
      onInterim: (t) => mounted.current && setText(t),
      onFinal: (t) => mounted.current && handle(t, 'voice'),
      onError: (code) => mounted.current && setVoiceError(voiceErrorMessage(code)),
      onEnd: () => mounted.current && setListening(false),
    });
    setListening(ok);
    if (!ok) setVoiceError('Voice input isn’t available in this browser.');
  };
  const stopListening = () => a.voice.stopOnce();

  // "Hey Flurry" on its own: listen for the command.
  useEffect(() => {
    if (!a.listenRequested) return;
    a.clearListenRequest();
    if (canListen) startListening();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a.listenRequested]);

  useEffect(() => () => a.voice.stopOnce(), [a.voice]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    handle(text, 'typed');
  };

  const projectOptions = projects.data?.content ?? [];
  const here = Number.isFinite(routeTaskId) ? board.currentData?.find((t) => t.id === routeTaskId) : undefined;
  const empty = messages.length === 0;
  const lastMessage = messages[messages.length - 1];
  // After a built-in model answer, offer the AI in this browser if it can be turned on.
  const offerAfterLocal = ai.route.kind === 'none' && lastMessage?.role === 'assistant' && lastMessage.reply.kind === 'local';
  const aiChip =
    ai.route.kind === 'checking'
      ? ''
      : ai.route.kind === 'server'
        ? `AI model on${ai.route.model ? `: ${ai.route.model}` : ''}`
        : ai.route.kind === 'browser'
          ? 'AI model on, in this browser'
          : 'No AI model: built-in answers';

  return (
    <>
      <header className="flex items-center gap-2.5 border-b border-line px-3.5 py-3">
        <FlurryAvatar />
        <div className="min-w-0 flex-1">
          <RD.Title className="text-[15px] leading-tight font-semibold text-ink">Flurry</RD.Title>
          <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-[12px] leading-snug text-muted">
            <span className="shrink-0">AI project assistant.</span>
            {aiChip && (
              <span className={cn('min-w-0', aiAvailable ? 'text-success' : 'text-muted')} title={ai.route.kind === 'none' ? ai.route.reason : undefined}>
                {aiChip}
              </span>
            )}
          </p>
        </div>
        {a.wakeEnabled && (
          <span
            className={cn('flex shrink-0 items-center gap-1 text-[12px] font-medium whitespace-nowrap', a.wakeActive ? 'text-accent' : 'text-muted')}
            role="status"
            title={a.wakeActive ? 'Listening for “Hey Flurry”' : 'The wake phrase is on but paused (hidden tab or push-to-talk)'}
          >
            <Mic className="size-3" aria-hidden="true" />
            {a.wakeActive ? 'Listening' : 'Wake paused'}
            <span className="sr-only">{a.wakeActive ? ' for “Hey Flurry”' : ''}</span>
          </span>
        )}
        <div className="flex shrink-0 items-center gap-0.5">
          {canPin && <PinButton />}
          <FlurryMenu canClear={!empty} onClear={a.clearMessages} />
          <RD.Close className="flex size-8 items-center justify-center rounded-md text-muted hover:bg-surface-3/70 hover:text-ink" aria-label="Close Flurry">
            <X className="size-4" />
          </RD.Close>
        </div>
      </header>

      <div className="flex items-center gap-2 border-b border-line bg-surface-2/60 px-4 py-2 dark:bg-surface/40" data-flurry-scope={projectId === null ? 'all' : here ? 'task' : 'project'}>
        <label htmlFor="assistant-project" className="shrink-0 text-[12px] text-muted">
          Scope
        </label>
        <select
          id="assistant-project"
          value={projectId ?? 'all'}
          onChange={(e) => setChosen(e.target.value === 'all' ? 'all' : Number(e.target.value))}
          className="min-w-0 flex-1 rounded-md border border-line bg-surface px-2 py-1.5 text-[12.5px] text-ink focus:border-brand focus:ring-[3px] focus:ring-[var(--ring)] focus:outline-none"
        >
          <option value="all">All projects</option>
          {projects.isLoading && <option disabled>Loading projects…</option>}
          {projectOptions.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.key})
            </option>
          ))}
          {project && !projectOptions.some((p) => p.id === project.id) && <option value={project.id}>{`${project.name} (${project.key})`}</option>}
        </select>
        {here && projectId === here.projectId && (
          <span className="shrink-0 rounded-full bg-surface-3 px-2 py-1 text-[11.5px] font-medium text-ink-2 tabular" title={`“this task” means ${here.key}`} data-flurry-scope-task={here.key}>
            Task {here.key}
          </span>
        )}
      </div>

      <div ref={scroller} className="scrollbar-thin flex-1 space-y-4 overflow-y-auto px-4 py-4" aria-live="polite">
        {empty && (
          <div className="space-y-4" data-flurry-intro="">
            <div>
              <p className="display-wide text-[24px] text-ink">Find your next move.</p>
              <p className="mt-2 text-[13.5px] leading-relaxed text-ink-2">
                I work from {project ? `${project.name}’s records` : 'the records of all your projects'} (only what you can see) and ask before changing anything.
              </p>
            </div>
            <ul className="-mx-2 grid gap-0.5" aria-label="Start with">
              {STARTERS.map((st) => (
                <li key={st.ask}>
                  <button
                    type="button"
                    onClick={() => handle(st.ask, 'typed')}
                    className="group flex w-full items-start gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-surface-3/60"
                    data-flurry-starter=""
                  >
                    <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-accent">
                      <st.icon className="size-4" aria-hidden="true" />
                    </span>
                    <span>
                      <span className="block text-[13.5px] font-medium text-ink">{st.ask}</span>
                      <span className="block text-[12px] leading-snug text-muted">{st.blurb}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <div>
              <p className="mb-1.5 text-[12px] font-medium text-muted">Or ask</p>
              <Examples items={examples(project, board.currentData).slice(0, 3)} onPick={(q) => handle(q, 'typed')} />
            </div>
            <p className="text-[12px] leading-relaxed text-muted">
              {ai.route.kind === 'server'
                ? ai.tools
                  ? 'Plans and free questions use the AI model, which can look up descriptions, comments, reviews and recent activity in the project you ask about. Summaries and blockers come straight from the records.'
                  : 'Plans and free questions use the AI model, working from a summary of the project’s tasks, dates and dependencies. Summaries and blockers come straight from the records.'
                : ai.route.kind === 'browser'
                  ? 'Plans and free questions use the AI in this browser, on this device. Summaries and blockers come straight from the records.'
                  : 'No AI model is connected, so I work from the records. Free questions go to the built-in model.'}
            </p>
            {ai.route.kind === 'none' && <BrowserAiOffer />}
          </div>
        )}
        {messages.map((m) =>
          m.role === 'user' ? (
            <div key={m.id} className="ml-10 rounded-2xl rounded-br-md bg-brand px-3.5 py-2 text-[13.5px] whitespace-pre-line text-white dark:text-canvas">
              {m.text}
              {m.source === 'voice' && (
                <span className="ml-2 inline-flex items-center gap-1 text-[12px] opacity-75">
                  <Mic className="size-2.5" aria-hidden="true" /> spoken
                </span>
              )}
            </div>
          ) : (
            <ReplyView
              key={m.id}
              reply={m.reply}
              aiAvailable={aiAvailable}
              onAsk={(q) => handle(q, 'typed')}
              onChooseProject={chooseProject}
              onAskAi={(q) => {
                if (project && !ai.busy) void askAi(project, q, pm.model, board.currentData);
              }}
              onDone={(t) => {
                a.signal('success');
                readAloud(t);
              }}
            />
          ),
        )}
        {(ai.busy || waiting.length > 0) && (
          <AnswerInProgress
            label={ai.busy && ai.route.kind === 'browser' ? 'Thinking on this device…' : ai.busy ? 'Thinking with the project’s records…' : 'Reading the project’s records…'}
            progress={ai.busy ? ai.progress : null}
            onStop={ai.canStop ? ai.stop : null}
          />
        )}
        {offerAfterLocal && <BrowserAiOffer />}
      </div>

      <form onSubmit={onSubmit} className="border-t border-line px-4 py-3">
        {awaitingBrief ? (
          <div className="mb-2 flex items-center justify-between gap-2 rounded-md bg-brand-soft px-2.5 py-1.5 text-[12px] text-brand-ink">
            <span>Next message is the brief. Shift+Enter starts a new line.</span>
            <button type="button" className="font-medium underline-offset-2 hover:underline" onClick={() => setAwaitingBrief(false)}>
              Cancel
            </button>
          </div>
        ) : (
          !empty && (
            <div className="scrollbar-thin mb-2 flex gap-1.5 overflow-x-auto pb-1">
              {['Summarise progress', 'Review blockers', 'Plan a project', 'What should I work on next?', 'Draft a meeting agenda'].map((q) => (
                <button key={q} type="button" onClick={() => handle(q, 'typed')} className="shrink-0 rounded-full border border-line px-2.5 py-1 text-[12px] text-ink-2 transition-colors hover:border-ink hover:text-ink">
                  {q}
                </button>
              ))}
            </div>
          )
        )}
        <div className="flex items-end gap-2">
          <label htmlFor="assistant-input" className="sr-only">
            Message Flurry
          </label>
          <textarea
            id="assistant-input"
            ref={input}
            data-assistant-input=""
            rows={awaitingBrief ? 4 : 2}
            maxLength={awaitingBrief ? 4000 : 500}
            value={text}
            readOnly={listening}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                handle(text, 'typed');
              }
            }}
            placeholder={listening ? 'Listening…' : awaitingBrief ? 'Paste the brief: goals, pieces of work, dates and owners if you know them…' : 'Ask Flurry, or say what to do…'}
            className="min-h-[48px] flex-1 resize-none rounded-lg border border-line-strong bg-surface px-3 py-2.5 text-[13px] text-ink placeholder:text-subtle focus:border-ink focus:outline-none"
          />
          {canListen && (
            <button
              type="button"
              onClick={listening ? stopListening : startListening}
              aria-pressed={listening}
              aria-label={listening ? 'Stop listening' : 'Speak a request'}
              className={cn('flex size-12 shrink-0 items-center justify-center rounded-lg border', listening ? 'border-danger bg-danger-soft text-danger' : 'border-line-strong text-ink hover:border-ink')}
            >
              {listening ? <Square className="size-3.5" /> : <Mic className="size-4" />}
            </button>
          )}
          <button type="submit" disabled={!text.trim() || listening} className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-brand text-white hover:bg-brand-hover disabled:opacity-40 dark:text-canvas" aria-label="Send">
            <ArrowUp className="size-4" />
          </button>
        </div>
        {listening && (
          <p className="mt-1.5 flex items-center gap-1.5 text-[12px] text-danger" role="status">
            <span className="size-1.5 animate-pulse rounded-full bg-danger" aria-hidden="true" /> Listening. Speak your request; it’s sent when you stop.
          </p>
        )}
        {voiceError && <p className="mt-1.5 text-[12px] text-danger">{voiceError}</p>}
        {voiceNote && (
          <p className="mt-1.5 text-[12px] text-muted" role="status" data-voice-fallback="">
            {voiceNote}
          </p>
        )}
        <p className="mt-1.5 text-[12px] text-muted">
          Flurry is AI and can be wrong. Enter sends; Esc or Alt+A closes.{lastSource === 'voice' ? ' Voice can prepare changes but never confirms them.' : ''}
        </p>
        <VoiceSettings canListen={canListen} canSpeak={canSpeak} serverVoice={ai.voice} />
      </form>
    </>
  );
}

/** Flurry's face in the panel header, showing what it's doing (thinking, done, a problem). */
function FlurryAvatar() {
  const a = useAssistant();
  const userId = useAppSelector((s) => s.auth.user?.id ?? 0);
  const [prefs] = useFlurryPrefs(userId);
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const phone = !useMediaQuery('(min-width: 640px)');
  const mood = a.mood === 'settled' ? 'idle' : a.mood;
  // Flurry itself perches beside the conversation on larger screens; here a small mark will do.
  const perched = prefs.mode !== 'hide' && !phone;
  const still = isStill(prefs, reduceMotion);
  return (
    <span className="relative flex size-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-brand-soft to-[color-mix(in_srgb,var(--frost)_35%,var(--surface))] ring-1 ring-brand/10" data-flurry-avatar={mood}>
      {perched ? (
        <Snowflake className={cn('size-4 text-accent', mood === 'thinking' && !still && 'animate-spin [animation-duration:2.4s]')} aria-hidden="true" />
      ) : (
        <FlurryFigure mood={mood} still={still} glow={false} mini className="size-8" />
      )}
      <span className="sr-only">{mood === 'thinking' ? 'Flurry is working' : mood === 'error' ? 'Flurry hit a problem' : mood === 'success' ? 'Done' : ''}</span>
    </span>
  );
}

/** Pins the conversation beside the page (which makes room for it), or lets it float again. */
function PinButton() {
  const userId = useAppSelector((s) => s.auth.user?.id ?? 0);
  const [prefs, setPrefs] = useFlurryPrefs(userId);
  return (
    <button
      type="button"
      onClick={() => setPrefs({ pinned: !prefs.pinned })}
      aria-pressed={prefs.pinned}
      className={cn('flex size-8 items-center justify-center rounded-md hover:bg-surface-2 hover:text-ink', prefs.pinned ? 'text-accent' : 'text-muted')}
      aria-label={prefs.pinned ? 'Unpin: float over the page' : 'Pin beside the page'}
      title={prefs.pinned ? 'Unpin: float over the page' : 'Pin beside the page (the page makes room)'}
      data-flurry-pin=""
    >
      {prefs.pinned ? <PanelRightClose className="size-4" aria-hidden="true" /> : <PanelRight className="size-4" aria-hidden="true" />}
    </button>
  );
}

/** Flurry's own settings: where it stays, its motion, sounds, and clearing the conversation. */
function FlurryMenu({ canClear, onClear }: { canClear: boolean; onClear: () => void }) {
  const userId = useAppSelector((s) => s.auth.user?.id ?? 0);
  const [prefs, setPrefs] = useFlurryPrefs(userId);
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  return (
    <Menu>
      <MenuTrigger asChild>
        <button type="button" className="flex size-8 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-ink" aria-label="Flurry settings">
          <MoreHorizontal className="size-4" aria-hidden="true" />
        </button>
      </MenuTrigger>
      <MenuContent align="end" className="w-64">
        <MenuLabel>Flurry should</MenuLabel>
        <MenuRadioGroup value={prefs.mode} onValueChange={(v) => setPrefs({ mode: v as FlurryMode })} label="Where Flurry stays">
          {FLURRY_MODES.map((m) => (
            <MenuRadioItem key={m.value} value={m.value} hint={m.hint}>
              {m.label}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
        <MenuSeparator />
        <MenuLabel>Motion{reduceMotion ? ' (your system reduces motion)' : ''}</MenuLabel>
        <MenuRadioGroup value={reduceMotion ? 'off' : prefs.motion} onValueChange={(v) => !reduceMotion && setPrefs({ motion: v as FlurryMotion })} label="Flurry’s motion">
          {FLURRY_MOTIONS.map((m) => (
            <MenuRadioItem key={m.value} value={m.value} disabled={reduceMotion && m.value !== 'off'}>
              {m.label}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
        <MenuSeparator />
        <MenuCheckItem checked={prefs.sounds} onSelect={() => setPrefs({ sounds: !prefs.sounds })}>
          Sounds
        </MenuCheckItem>
        <MenuSeparator />
        <MenuItem onSelect={onClear} disabled={!canClear}>
          Clear the conversation
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}

/** An answer about one task: what it is, what the records show and don't, the next move, and where to go. */
function TaskAnswerView({ project, answer }: { project: ProjectDetail; answer: TaskAnswer }) {
  const t = answer.task;
  const review = t.status === 'IN_REVIEW';
  return (
    <div className="space-y-2" data-flurry-task-answer={t.key}>
      <p className="text-[13px] leading-snug font-medium text-ink">{answer.title}</p>
      <ReportSection heading="What the records show" lines={answer.recorded.map((text) => ({ text, source: 'recorded' as const }))} />
      {answer.unknown.length > 0 && <ReportSection heading="What the records don’t show" lines={answer.unknown.map((text) => ({ text, source: 'missing' as const }))} />}
      <p className="text-[12.5px] leading-relaxed text-ink-2">
        <span className="font-medium text-ink">Next: </span>
        {answer.next}
      </p>
      <div className="flex flex-wrap gap-1.5">
        <Link to={review && can.review(project.myRole) ? `/projects/${project.id}/tasks/${t.id}/review` : `/projects/${project.id}/tasks/${t.id}`} className={buttonClass('primary', 'xs')}>
          {review && can.review(project.myRole) ? 'Open the review' : `Open ${t.key}`}
        </Link>
        <Link to={`/projects/${project.id}/map`} className={buttonClass('secondary', 'xs')}>
          Trace dependencies
        </Link>
        <Link to={`/projects/${project.id}/delivery`} className={buttonClass('secondary', 'xs')}>
          Compare a scenario
        </Link>
      </div>
    </div>
  );
}

function Examples({ items, onPick }: { items: string[]; onPick: (q: string) => void }) {
  return (
    <ul className="space-y-1">
      {items.map((q) => (
        <li key={q}>
          <button type="button" onClick={() => onPick(q)} className="w-full border-l-2 border-line py-1 pl-3 text-left text-[12.5px] text-ink-2 transition-colors hover:border-accent hover:text-ink">
            {q}
          </button>
        </li>
      ))}
    </ul>
  );
}

function ReplyView({
  reply,
  aiAvailable,
  onAsk,
  onChooseProject,
  onAskAi,
  onDone,
}: {
  reply: Reply;
  aiAvailable: boolean;
  onAsk: (q: string) => void;
  onChooseProject: (id: number, question: string) => void;
  onAskAi: (q: string) => void;
  onDone: (text: string) => void;
}) {
  const label = reply.kind === 'ai' ? `Flurry, ${reply.answer.model ? `AI model ${reply.answer.model}` : 'AI model'}` : SOURCE_LABEL[reply.kind];
  const question = reply.kind !== 'ai' && 'question' in reply ? reply.question : undefined;
  return (
    <article className="space-y-2">
      {label && (
        <div className="flex items-center justify-between gap-2">
          <p className={cn('flex items-center gap-1.5 text-[12px] font-medium', reply.kind === 'ai' ? 'text-accent' : 'text-muted')}>
            {reply.kind === 'ai' && <Sparkles className="size-3" aria-hidden="true" />}
            {label}
          </p>
          {reply.kind !== 'action' && reply.kind !== 'plan' && (
            <CopyButton text={() => (reply.kind === 'agenda' ? reply.text : spoken(reply))} what={reply.kind === 'agenda' ? 'the agenda' : 'this answer'} iconOnly className="-my-1 text-muted" />
          )}
        </div>
      )}
      {reply.kind === 'info' && (
        <>
          <p className={cn('text-[13px] leading-relaxed', reply.tone === 'error' ? 'text-danger' : 'text-ink-2')} role={reply.tone === 'error' ? 'alert' : undefined}>
            {reply.text}
          </p>
          {reply.examples && <Examples items={reply.examples} onPick={onAsk} />}
          {reply.retry && (
            <button type="button" onClick={() => onAskAi(reply.retry!)} className={buttonClass('secondary', 'sm')} data-flurry-retry="">
              <RotateCcw aria-hidden="true" /> Try again
            </button>
          )}
        </>
      )}
      {reply.kind === 'summary' && (
        <>
          <p className="text-[13px] font-medium text-ink">{reply.summary.title}</p>
          <ReportSection heading="What the records show" lines={reply.summary.recorded} />
          {reply.summary.inferred.length > 0 && <ReportSection heading="What that suggests" note="Estimates, not commitments" lines={reply.summary.inferred} />}
          {reply.summary.missing.length > 0 && <ReportSection heading="What the records don’t show" lines={reply.summary.missing} />}
        </>
      )}
      {reply.kind === 'blockers' && <BlockerList findings={reply.findings} onAsk={onAsk} projectId={reply.project.id} />}
      {reply.kind === 'choose-project' && (
        <>
          <p className="text-[13px] leading-relaxed text-ink-2">{reply.text}</p>
          <div className="flex flex-wrap gap-1.5" data-flurry-choose-project="">
            {reply.projects.map((x) => (
              <button key={x.id} type="button" onClick={() => onChooseProject(x.id, reply.question)} className="rounded-full border border-line px-2.5 py-1 text-[12px] text-ink-2 transition-colors hover:border-ink hover:text-ink">
                {x.name} <span className="text-muted">({x.key})</span>
              </button>
            ))}
          </div>
        </>
      )}
      {reply.kind === 'task' && <TaskAnswerView project={reply.project} answer={reply.answer} />}
      {reply.kind === 'agenda' && (
        <>
          <p className="text-[13px] font-medium text-ink">Meeting agenda for {reply.project.name}</p>
          <pre className="max-h-80 overflow-auto rounded-lg border border-line bg-surface-2 px-3 py-2.5 font-sans text-[12.5px] leading-relaxed whitespace-pre-wrap text-ink-2">{reply.text}</pre>
          <p className="text-[12px] text-muted">Copy it with the button above and edit it before you send it. I don’t send messages for you.</p>
        </>
      )}
      {reply.kind === 'plan' && <PlanCard project={reply.project} plan={reply.plan} />}
      {reply.kind === 'facts' && (
        <>
          <p className="text-[13px] font-medium text-ink">{reply.title}</p>
          {reply.facts.length === 0 ? (
            <p className="text-[12.5px] text-ink-2">{reply.empty ?? 'Nothing to report.'}</p>
          ) : (
            <ul className="divide-y divide-line border-y border-line">
              {reply.facts.map((f) => (
                <li key={f.id} className="py-2">
                  <p className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-[12.5px] font-medium text-ink">{f.title}</span>
                    <SourceTag source={f.source} />
                    {f.tone === 'danger' && <span className="text-[11.5px] font-semibold text-danger">At risk</span>}
                    {f.tone === 'warning' && <span className="text-[11.5px] font-semibold text-warning">Watch</span>}
                  </p>
                  <p className="text-[12px] leading-relaxed text-muted">{f.detail}</p>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {reply.kind === 'changes' && (
        <>
          <p className="text-[13px] font-medium text-ink">{reply.title}</p>
          {reply.events.length > 0 && (
            <ul className="space-y-1 text-[12.5px]">
              {reply.events.map(({ event, date }) => (
                <li key={`${event.taskId}-${event.kind}-${event.day}`} className="flex gap-2">
                  <span className="w-12 shrink-0 text-muted tabular">{date}</span>
                  <span className="text-ink-2">
                    <span className="font-mono text-[12px] text-ink">{event.key}</span> {event.kind}
                    <span className="text-muted">: {event.title}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {reply.more > 0 && <p className="text-[12px] text-muted">…and {reply.more} earlier {reply.more === 1 ? 'change' : 'changes'}. The project’s Activity page lists them all.</p>}
        </>
      )}
      {reply.kind === 'tasks' && (
        <>
          <p className="text-[13px] font-medium text-ink">{reply.title}</p>
          {reply.summary && <p className="text-[12px] text-muted">{reply.summary}</p>}
          <ol className="divide-y divide-line border-y border-line">
            {reply.items.map(({ task, reason }) => (
              <li key={task.id} className="py-2">
                <Link to={`/projects/${task.projectId}/tasks/${task.id}`} className="text-[12.5px] text-ink hover:text-accent">
                  <span className="font-mono text-[12px] text-muted">{task.key}</span> {task.title}
                </Link>
                <p className="text-[12px] text-muted">
                  {STATUS_LABEL[task.status]}. {reason}
                </p>
              </li>
            ))}
          </ol>
        </>
      )}
      {reply.kind === 'action' && <ProposalCard project={reply.project} draft={reply.draft} origin="command" onDone={onDone} />}
      {reply.kind === 'ai' && <AiReply project={reply.project} answer={reply.answer} asked={reply.asked} onDone={onDone} />}
      {reply.kind === 'local' && (
        <>
          <p className="text-[13px] font-medium text-ink">{reply.answer.title}</p>
          {reply.answer.lines.length > 0 && (
            <ul className="divide-y divide-line border-y border-line">
              {reply.answer.lines.map((l, i) => (
                <li key={i} className="py-2 text-[12.5px] leading-relaxed text-ink-2">
                  {l.task ? (
                    <Link to={`/projects/${l.task.projectId}/tasks/${l.task.id}`} className="hover:text-accent">
                      {l.text}
                    </Link>
                  ) : (
                    l.text
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="text-[12px] leading-relaxed text-muted">{reply.answer.basis}</p>
          {reply.answer.limit && <p className="text-[12px] leading-relaxed text-muted">{reply.answer.limit}</p>}
        </>
      )}
      {question && aiAvailable && (
        <button type="button" onClick={() => onAskAi(question)} className="flex items-center gap-1.5 text-[12px] font-medium text-accent hover:text-ink">
          <Sparkles className="size-3" aria-hidden="true" /> Ask the AI model to explain
        </button>
      )}
    </article>
  );
}

const LOOKUP_STATE: Record<LookupResult, string> = {
  found: 'found',
  nothing: 'found nothing',
  unavailable: 'couldn’t be read',
  declined: 'not suggested',
};

/**
 * What Flurry looked up to answer, in the order it did it. "Found nothing" and "couldn't be read"
 * are kept apart: the first means the records show nothing (not that nothing happened), the second
 * that it's unknown.
 */
function Lookups({ items, projectId }: { items: AiLookup[]; projectId: number }) {
  if (!items.length) {
    return (
      <p className="text-[12px] leading-relaxed text-muted" data-flurry-lookups="0">
        From the project summary only: tasks, owners, dates, dependencies and status changes. No descriptions or comments were read for this answer.
      </p>
    );
  }
  const nothing = items.some((l) => l.result === 'nothing');
  const unavailable = items.some((l) => l.result === 'unavailable');
  return (
    <details className="text-[12px]" open={unavailable || undefined} data-flurry-lookups={items.length}>
      <summary className="cursor-pointer text-muted hover:text-ink">How I found this: {items.length === 1 ? 'one lookup' : `${items.length} lookups`} in the project</summary>
      <ol className="mt-1.5 space-y-1">
        {items.map((l, i) => (
          <li key={i} className="flex items-start gap-2 leading-snug text-ink-2" data-lookup={l.result}>
            <LookupGlyph result={l.result} className="mt-[3px]" />
            <span className="min-w-0">
              {l.label}
              <span className="sr-only">: {LOOKUP_STATE[l.result]}</span>
              {l.refs && l.refs.length > 0 && <EvidenceLinks projectId={projectId} refs={l.refs} />}
            </span>
          </li>
        ))}
      </ol>
      {(nothing || unavailable) && (
        <p className="mt-1.5 leading-relaxed text-muted">
          {nothing && 'An empty ring means the records show nothing there, which isn’t proof it didn’t happen. '}
          {unavailable && 'A broken ring means that part couldn’t be read, so it’s unknown.'}
        </p>
      )}
    </details>
  );
}

function AiReply({ project, answer, asked, onDone }: { project: ProjectDetail; answer: AiAnswer; asked: string; onDone: (text: string) => void }) {
  return (
    <div className="space-y-2">
      <p className="text-[13px] leading-relaxed whitespace-pre-line text-ink-2">{answer.answer}</p>
      {answer.lookedUp && <Lookups items={answer.lookedUp} projectId={project.id} />}
      {answer.citedTasks.length > 0 && (
        <p className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 text-[12px]" data-cited-tasks={answer.citedTasks.length}>
          <span className="text-[12px] font-medium text-muted">Based on</span>
          {answer.citedTasks.map((k) => (
            <TaskRef key={k} taskKey={k} className="text-[12px]" />
          ))}
        </p>
      )}
      {answer.notInRecords.length > 0 && (
        <div className="rounded-md bg-surface-2 px-3 py-2 text-[12px] text-ink-2">
          <p className="text-[12px] font-medium text-muted">Not in the records</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {answer.notInRecords.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </div>
      )}
      {(answer.proposals ?? []).map((p, i) => (
        <ProposalCard
          key={i}
          project={project}
          origin="ai"
          onDone={onDone}
          draft={
            p.type === 'START_TASK'
              ? { type: 'start', key: p.taskKey ?? '' }
              : { type: 'create', title: p.title, description: p.description, priority: p.priority, due: p.dueDate, assignee: p.assigneeName, estimate: p.estimateDays }
          }
        />
      ))}
      <AnswerFeedback project={project} answer={answer} asked={asked} />
      <details className="text-[12px] text-muted">
        <summary className="cursor-pointer hover:text-ink">What this answer can and can’t tell you</summary>
        <ul className="mt-1 space-y-1">
          {answer.limits.map((l) => (
            <li key={l} className="flex gap-1.5">
              <Info className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
              {l}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

function VoiceSettings({ canListen, canSpeak, serverVoice }: { canListen: boolean; canSpeak: boolean; serverVoice: string | null }) {
  const a = useAssistant();
  return (
    <details className="mt-2 text-[12px] text-muted" open={!!a.wakeError}>
      <summary className="cursor-pointer text-[12px] font-medium hover:text-ink">Voice</summary>
      <div className="mt-2 space-y-2">
        {!canListen ? (
          <p>This browser doesn’t offer speech recognition. Voice works in Chrome, Edge and Safari.</p>
        ) : (
          <label className="flex cursor-pointer items-start gap-2 text-ink-2">
            <input type="checkbox" className="mt-0.5 size-3.5 accent-[var(--accent)]" checked={a.wakeEnabled} onChange={(e) => a.setWakeEnabled(e.target.checked)} />
            <span>
              Listen for “Hey Flurry”
              <span className="block text-muted">
                Only while this tab is open and visible, and only for you on this browser. Say “Hey Flurry, what’s at risk?”, or pause after it for the command.
              </span>
            </span>
          </label>
        )}
        {canSpeak && (
          <label className="flex cursor-pointer items-start gap-2 text-ink-2">
            <input type="checkbox" className="mt-0.5 size-3.5 accent-[var(--accent)]" checked={a.speakAnswers} onChange={(e) => a.setSpeakAnswers(e.target.checked)} />
            <span>
              <span className="flex items-center gap-1.5">
                <Volume2 className="size-3" aria-hidden="true" /> Read answers aloud
              </span>
              {serverVoice === 'elevenlabs' && (
                <span className="block text-muted" data-server-voice="elevenlabs">
                  In a natural voice from ElevenLabs. The answer’s text goes to Niveloft’s server, which sends it to ElevenLabs; if that isn’t available, your browser’s voice reads it.
                </span>
              )}
            </span>
          </label>
        )}
        {a.wakeError && <p className="text-danger">{a.wakeError}</p>}
        <p className="leading-relaxed">
          Voice uses your browser’s speech recognition, which may send audio to the browser’s maker (Google for Chrome, Apple for Safari) to turn it into text.
          Niveloft only receives the text, never audio. Voice can prepare a task or a change, but you always confirm it with a click.
        </p>
      </div>
    </details>
  );
}

function SourceTag({ source }: { source: 'recorded' | 'estimate' | 'missing' }) {
  const text = source === 'estimate' ? 'Estimate' : source === 'missing' ? 'Not in the records' : 'Recorded';
  return <span className={cn('rounded-sm px-1 text-[11.5px] font-semibold', source === 'estimate' ? 'bg-brand-soft text-brand-ink' : source === 'missing' ? 'bg-surface-3 text-muted' : 'text-muted')}>{text}</span>;
}

function ReportSection({ heading, note, lines }: { heading: string; note?: string; lines: ReportLine[] }) {
  return (
    <section>
      <h3 className="flex items-baseline gap-2 text-[12px] font-semibold text-muted">
        {heading}
        {note && <span className="font-normal">({note})</span>}
      </h3>
      <ul className="mt-1 divide-y divide-line rounded-md border border-line">
        {lines.map((l, i) => (
          <li key={i} className="px-3 py-2 text-[12.5px] leading-relaxed text-ink-2">
            <span className={cn(l.tone === 'danger' && 'text-danger', l.tone === 'warning' && 'text-warning')}>{l.text}</span>{' '}
            {l.tasks && l.tasks.length > 0 && (
              <span className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5">
                {l.tasks.map((t) => (
                  <Link key={t.id} to={`/projects/${t.projectId}/tasks/${t.id}`} className="font-mono text-[12px] text-accent hover:underline" title={t.title}>
                    {t.key}
                  </Link>
                ))}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Blockers with a suggested next move each. Suggestions can be dismissed; dismissing changes nothing else. */
function BlockerList({ findings, onAsk, projectId }: { findings: BlockerFinding[]; onAsk: (q: string) => void; projectId: number }) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const shown = findings.filter((f) => !dismissed.has(f.id));
  if (!findings.length) {
    return <p className="text-[13px] text-ink-2">Nothing is blocked: no work waits on unfinished tasks, nothing is overdue, every open task has an owner and no review has waited long.</p>;
  }
  return (
    <div className="space-y-2">
      <p className="text-[13px] font-medium text-ink">
        {findings.length === 1 ? 'One thing' : `${findings.length} things`} could hold the work up
      </p>
      <ul className="space-y-2">
        {shown.map((f) => (
          <li key={f.id} className="rounded-lg border border-line bg-surface px-3 py-2.5" data-blocker={f.kind}>
            <div className="flex items-start justify-between gap-2">
              <p className="text-[12.5px] font-medium text-ink">{f.title}</p>
              <button
                type="button"
                onClick={() => setDismissed((d) => new Set(d).add(f.id))}
                className="-mt-0.5 -mr-1 flex size-6 shrink-0 items-center justify-center rounded text-muted hover:bg-surface-2 hover:text-ink"
                aria-label={`Dismiss: ${f.title}`}
                title="Dismiss this suggestion"
              >
                <X className="size-3.5" aria-hidden="true" />
              </button>
            </div>
            <p className="mt-0.5 text-[12px] leading-relaxed text-muted">{f.detail}</p>
            <p className="mt-1.5 text-[12px] leading-relaxed text-ink-2">
              <span className="font-medium text-accent">Next move: </span>
              {f.suggestion}
            </p>
            <p className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5">
              {f.tasks.map((t) => (
                <Link key={t.id} to={`/projects/${t.projectId}/tasks/${t.id}`} className="font-mono text-[12px] text-accent hover:underline" title={t.title}>
                  {t.key}
                </Link>
              ))}
            </p>
          </li>
        ))}
      </ul>
      {dismissed.size > 0 && (
        <button type="button" className="text-[12px] text-muted hover:text-ink" onClick={() => setDismissed(new Set())}>
          Show {dismissed.size === 1 ? 'the dismissed suggestion' : `${dismissed.size} dismissed suggestions`}
        </button>
      )}
      <p className="text-[12px] text-muted">
        Computed from due dates, owners, dependencies and review times. I don’t know the reasons behind them.{' '}
        <Link to={`/projects/${projectId}/delivery?ways=1`} className="text-accent hover:underline" data-flurry-ways-forward="">
          See what the main one costs and compare ways forward
        </Link>
        , or{' '}
        <button type="button" className="text-accent hover:underline" onClick={() => onAsk('Draft a meeting agenda')}>
          turn this into a meeting agenda
        </button>
        .
      </p>
    </div>
  );
}
