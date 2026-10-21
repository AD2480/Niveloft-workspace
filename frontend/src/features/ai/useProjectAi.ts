import { useRef, useState } from 'react';
import { api } from '@/api/baseApi';
import { useAiAskProjectMutation, useAiPlanProjectMutation, useAiStatusQuery } from '@/api/endpoints';
import { getErrorMessage } from '@/api/errors';
import type { AiAnswer, AiPlan, AiTurn, ProjectDetail, Task } from '@/api/types';
import { useAppDispatch, useAppSelector } from '@/app/store';
import { newIdempotencyKey } from '@/lib/requestPolicy';
import { todayIso } from '@/lib/dates';
import { aiRange } from '@/lib/forecastText';
import { forecastProgress } from '@/lib/progressForecast';
import { forecastFromModel } from '@/lib/projectAnalysis';
import type { ProjectModel } from '@/three/projectModel';
import { AskRefused, AskStopped, stopAsk, streamAsk, type AskProgress } from './askStream';
import { askInBrowser, browserAiErrorMessage, BROWSER_MODEL_NAME, planInBrowser, type BrowserAiAvailability } from './browserAi';
import { useBrowserAi } from './useBrowserAi';

export { AskStopped, type AskProgress } from './askStream';

/**
 * Refusals that mean the stream itself didn't work, not the question: signed out (the ordinary
 * request renews a kept sign-in), a server without the stream, or no response at all. Nothing ran,
 * so the question is asked again the ordinary way.
 */
const ASK_PLAINLY = new Set([0, 401, 404, 405, 415]);

/** Where a free question goes: the server's AI, the AI in this browser, or neither (the built-in model answers). */
export type AiRoute =
  | { kind: 'checking' }
  | { kind: 'server'; model: string | null }
  | { kind: 'browser'; model: string }
  | { kind: 'none'; reason: string; browser: BrowserAiAvailability };

export interface ProjectQuestion {
  project: ProjectDetail;
  question: string;
  /** Earlier turns about this same project. */
  previous: AiTurn[];
  model: ProjectModel | null;
  /** The project's tasks (needed only by the AI in the browser, which builds its own context). */
  tasks: readonly Task[] | undefined;
}

/**
 * One way to ask the AI about a project, wherever the AI is. The server's AI comes first (its
 * context is gathered on the server after checking membership). Without one, Chrome's built-in
 * model answers on this device from the records this page already has. Both are labelled.
 */
export function useProjectAi() {
  const status = useAiStatusQuery();
  const browser = useBrowserAi();
  const [askServer, serverState] = useAiAskProjectMutation();
  const [planServer, planState] = useAiPlanProjectMutation();
  const [browserBusy, setBrowserBusy] = useState(false);
  const [streaming, setStreaming] = useState(false);
  /** A question is being answered (not a plan): it can be stopped. */
  const [asking, setAsking] = useState(false);
  const [progress, setProgress] = useState<AskProgress | null>(null);
  const inFlight = useRef(false);
  const token = useAppSelector((s) => s.auth.token);
  const dispatch = useAppDispatch();
  /** The question being answered, so it can be stopped. */
  const current = useRef<{ controller: AbortController; projectId: number; requestId: string | null } | null>(null);

  const route: AiRoute = status.isLoading
    ? { kind: 'checking' }
    : status.data?.available
      ? { kind: 'server', model: status.data.model }
      : browser.availability === 'available'
        ? { kind: 'browser', model: BROWSER_MODEL_NAME }
        : {
            kind: 'none',
            reason: status.isError ? `I couldn’t check the server’s AI (${getErrorMessage(status.error)}).` : (status.data?.reason ?? 'There’s no AI service on the server.'),
            browser: browser.availability,
          };

  /**
   * Throws an Error with a readable message when nothing could be answered, and AskStopped when
   * the person stopped it. With the server's AI the answer is followed as it's written:
   * {@code progress} holds the lookups so far and the answer's words.
   */
  const ask = async ({ project, question, previous, model, tasks }: ProjectQuestion): Promise<AiAnswer> => {
    if (inFlight.current) throw new Error('I’m still answering your last question. Ask again when it’s done.');
    inFlight.current = true;
    const controller = new AbortController();
    current.current = { controller, projectId: project.id, requestId: null };
    setAsking(true);
    // The dates come from Niveloft's own forecast; the AI only explains them.
    const range = model && tasks?.length ? aiRange(forecastProgress({ model, tasks, members: project.members }), model.originMs) : null;
    try {
      if (route.kind === 'server') {
        const scheduled = model ? forecastFromModel(model) : null;
        const body = { question: question.slice(0, 500), previous: previous.slice(-3), forecast: scheduled || range ? { finish: scheduled?.finish ?? null, tasks: scheduled?.tasks ?? [], range } : null };
        const requestId = newIdempotencyKey();
        current.current.requestId = requestId;
        setStreaming(true);
        setProgress({ lookups: [], draft: '' });
        try {
          return await streamAsk({ projectId: project.id, body, token, requestId, signal: controller.signal, onProgress: setProgress });
        } catch (e) {
          if (!(e instanceof AskRefused) || !ASK_PLAINLY.has(e.status) || controller.signal.aborted) throw e;
          setProgress(null);
          const plain = askServer({ projectId: project.id, body });
          controller.signal.addEventListener('abort', () => plain.abort());
          return await plain.unwrap();
        } finally {
          // The hour's count of questions changed.
          dispatch(api.util.invalidateTags(['AiStatus']));
        }
      }
      if (route.kind === 'browser') {
        if (!tasks) throw new Error('This project’s tasks haven’t loaded yet. Try again in a moment.');
        setBrowserBusy(true);
        try {
          return await askInBrowser({ project, tasks, model, question: question.slice(0, 500), previous: previous.slice(-2), today: todayIso(), range }, controller.signal);
        } catch (e) {
          if (controller.signal.aborted) throw new AskStopped();
          throw new Error(browserAiErrorMessage(e));
        }
      }
      throw new Error(route.kind === 'none' ? route.reason : 'Still checking where AI is available.');
    } catch (e) {
      if (e instanceof AskStopped || controller.signal.aborted) throw e instanceof AskStopped ? e : new AskStopped();
      throw e instanceof Error ? e : new Error(getErrorMessage(e));
    } finally {
      inFlight.current = false;
      current.current = null;
      setAsking(false);
      setBrowserBusy(false);
      setStreaming(false);
      setProgress(null);
    }
  };

  /** Stops the question being answered: the request ends, and the server stops the AI. Nothing is changed. */
  const stop = () => {
    const c = current.current;
    if (!c || c.controller.signal.aborted) return;
    c.controller.abort();
    if (c.requestId) stopAsk(c.projectId, c.requestId, token);
  };

  /** Flurry's "Plan a project" with AI: draft tasks from a brief. Throws a readable Error when it can't. */
  const plan = async ({ project, tasks, brief }: { project: ProjectDetail; tasks: readonly Task[] | undefined; brief: string }): Promise<AiPlan> => {
    if (inFlight.current) throw new Error('I’m still working on your last request. Ask again when it’s done.');
    inFlight.current = true;
    try {
      if (route.kind === 'server') return await planServer({ projectId: project.id, body: { brief: brief.slice(0, 4000) } }).unwrap();
      if (route.kind === 'browser') {
        setBrowserBusy(true);
        try {
          return await planInBrowser({ project, tasks: tasks ?? [], brief: brief.slice(0, 4000), today: todayIso() });
        } catch (e) {
          throw new Error(browserAiErrorMessage(e));
        }
      }
      throw new Error(route.kind === 'none' ? route.reason : 'Still checking where AI is available.');
    } catch (e) {
      throw e instanceof Error ? e : new Error(getErrorMessage(e));
    } finally {
      inFlight.current = false;
      setBrowserBusy(false);
    }
  };

  return {
    route,
    ask,
    plan,
    busy: serverState.isLoading || planState.isLoading || browserBusy || streaming,
    /** The question being answered: its lookups so far and the answer's words as they're written (server AI only). */
    progress,
    stop,
    /** Whether {@link stop} has a question to stop. */
    canStop: asking,
    browser,
    refetchStatus: status.refetch,
    remaining: status.data?.remainingThisHour ?? null,
    /** The server's AI can look things up in the project (descriptions, comments, reviews, activity). */
    tools: route.kind === 'server' && status.data?.tools === true,
    /** The server's natural voice for reading answers aloud ("elevenlabs"), or null for the browser's own. */
    voice: status.data?.voice ?? null,
  };
}
