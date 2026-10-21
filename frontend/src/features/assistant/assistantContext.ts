import { createContext, useContext } from 'react';
import type { AiAnswer, ProjectDetail, Task } from '@/api/types';
import type { AnalysisFact, ChangeEvent } from '@/lib/projectAnalysis';
import type { FlurryMood } from '@/features/flurry/FlurryFigure';
import type { BlockerFinding, ProgressSummary } from './flurryReports';
import type { LocalAnswer } from './localAnswer';
import type { PlanView } from './PlanCard';
import type { TaskAnswer } from './taskAnswer';
import type { ActionDraft } from './ProposalCard';
import type { VoiceController } from './voice';

export type InputSource = 'typed' | 'voice';

/** One reply in the conversation. `question` lets a computed reply offer "Ask the AI to explain". */
export type Reply =
  /** `retry`: the request to send again (shown as Try again) when something failed on the way. */
  | { kind: 'info'; text: string; examples?: string[]; tone?: 'error'; retry?: string }
  | { kind: 'summary'; project: ProjectDetail; summary: ProgressSummary; question: string }
  | { kind: 'blockers'; project: ProjectDetail; findings: BlockerFinding[]; question: string }
  | { kind: 'agenda'; project: ProjectDetail; text: string }
  | { kind: 'plan'; project: ProjectDetail; plan: PlanView }
  | { kind: 'facts'; title: string; facts: AnalysisFact[]; empty?: string; question?: string }
  | { kind: 'changes'; title: string; events: { event: ChangeEvent; date: string }[]; more: number; question?: string }
  | { kind: 'tasks'; title: string; summary?: string; items: { task: Task; reason: string }[]; question?: string }
  | { kind: 'action'; project: ProjectDetail; draft: ActionDraft }
  | { kind: 'ai'; project: ProjectDetail; answer: AiAnswer; asked: string }
  /** From Niveloft's built-in model (trained on the project's records; no AI service). */
  | { kind: 'local'; answer: LocalAnswer; question: string }
  /** About one exact task, from the records. */
  | { kind: 'task'; project: ProjectDetail; answer: TaskAnswer; question: string }
  /** The question needs one project and the scope is all of them: which one? */
  | { kind: 'choose-project'; text: string; projects: { id: number; key: string; name: string }[]; question: string };

export type NewMessage = { role: 'user'; text: string; source: InputSource } | { role: 'assistant'; reply: Reply };
export type Message = NewMessage & { id: number };

/** What Flurry should show: something finished, something went wrong, or work started/stopped. */
export type FlurrySignal = 'busy' | 'idle' | 'success' | 'error';

export interface AssistantState {
  open: boolean;
  setOpen: (open: boolean) => void;
  /** A request waiting for the panel to handle (e.g. heard after "Hey Flurry"). */
  pending: { id: number; text: string; source: InputSource } | null;
  submit: (text: string, source: InputSource) => void;
  consumePending: (id: number) => void;
  /** Set when the wake phrase was heard alone: the panel should listen for the command. */
  listenRequested: boolean;
  clearListenRequest: () => void;
  /** The conversation, kept while the panel is closed (it's cleared on sign-out). */
  messages: Message[];
  pushMessage: (m: NewMessage) => void;
  clearMessages: () => void;
  voice: VoiceController;
  /** The person's choice; `wakeActive` is whether the listener is actually running right now. */
  wakeEnabled: boolean;
  wakeActive: boolean;
  setWakeEnabled: (on: boolean) => void;
  wakeError: string | null;
  speakAnswers: boolean;
  setSpeakAnswers: (on: boolean) => void;
  /** Flurry's expression, from what the assistant is doing and whether the person is busy typing. */
  mood: FlurryMood;
  signal: (s: FlurrySignal) => void;
}

export const AssistantContext = createContext<AssistantState | null>(null);

/** The assistant's shared state; available inside the signed-in app. */
export function useAssistant(): AssistantState {
  const ctx = useContext(AssistantContext);
  if (!ctx) throw new Error('useAssistant must be used inside <AssistantProvider>');
  return ctx;
}

/** Same, but null outside the provider (for components that also render elsewhere). */
export function useOptionalAssistant(): AssistantState | null {
  return useContext(AssistantContext);
}
