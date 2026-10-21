import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAppSelector } from '@/app/store';
import { afterWakePhrase } from '@/lib/assistantIntents';
import { readStorage, writeStorage } from '@/lib/storage';
import type { FlurryMood } from '@/features/flurry/FlurryFigure';
import { readFlurryPrefs } from '@/features/flurry/flurryPrefs';
import { playFlurrySound } from '@/features/flurry/sounds';
import { AssistantContext, type AssistantState, type FlurrySignal, type InputSource, type Message, type NewMessage } from './assistantContext';
import { VoiceController, voiceErrorMessage } from './voice';

/** Voice choices are per person on this browser, so one person's opt-in never applies to another. */
const keys = (userId: number) => ({ wake: `projectflow.assistant.wake.${userId}`, speak: `projectflow.assistant.speak.${userId}` });

/**
 * The assistant's state for the signed-in app: whether the panel is open, the conversation, a
 * request waiting for the panel, voice (push-to-talk, the optional "Hey Flurry" listener, reading
 * answers aloud) and Flurry's mood. It lives inside the app shell, so signing out stops all listening.
 * Alt+A opens the panel, moves into it, or closes it when you're already in it.
 */
export function AssistantProvider({ children }: { children: ReactNode }) {
  const userId = useAppSelector((s) => s.auth.user?.id ?? 0);
  const k = keys(userId);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<AssistantState['pending']>(null);
  const [listenRequested, setListenRequested] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [wakeEnabled, setWakeEnabledState] = useState(() => readStorage(k.wake) === 'on');
  const [wakeActive, setWakeActive] = useState(false);
  const [speakAnswers, setSpeakAnswersState] = useState(() => readStorage(k.speak) === 'on');
  const [wakeError, setWakeError] = useState<string | null>(null);
  const [voice] = useState(() => new VoiceController());
  const nextId = useRef(1);
  const nextMessage = useRef(1);
  const [busy, setBusy] = useState(false);
  const [reaction, setReaction] = useState<'success' | 'error' | null>(null);
  const [settled, setSettled] = useState(false);
  const reactionTimer = useRef<number | undefined>(undefined);

  // Flurry's reactions: success and error show briefly, then it goes back to idle.
  const signal = useCallback(
    (s: FlurrySignal) => {
      if (s === 'busy' || s === 'idle') {
        setBusy(s === 'busy');
        return;
      }
      setBusy(false);
      setReaction(s);
      window.clearTimeout(reactionTimer.current);
      reactionTimer.current = window.setTimeout(() => setReaction(null), s === 'success' ? 1600 : 5000);
      if (readFlurryPrefs(userId).sounds) playFlurrySound(s);
    },
    [userId],
  );
  useEffect(() => () => window.clearTimeout(reactionTimer.current), []);

  // While the person types elsewhere on the page, Flurry settles down (and wakes 12 s after they stop).
  useEffect(() => {
    let timer: number | undefined;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t || t.closest('[data-assistant-panel]')) return;
      if (!(t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      setSettled(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setSettled(false), 12_000);
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.clearTimeout(timer);
    };
  }, []);

  const mood: FlurryMood = reaction ?? (busy ? 'thinking' : wakeActive ? 'listening' : settled ? 'settled' : 'idle');

  // A soft chime when the panel opens, if the person turned Flurry's sounds on.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current && readFlurryPrefs(userId).sounds) playFlurrySound('open');
    wasOpen.current = open;
  }, [open, userId]);

  // If a different person signs in without the shell unmounting, use their own choices.
  useEffect(() => {
    setWakeEnabledState(readStorage(k.wake) === 'on');
    setSpeakAnswersState(readStorage(k.speak) === 'on');
    setMessages([]);
  }, [k.wake, k.speak]);

  // Attach on mount and release on unmount (also correct under React's development double-mount).
  useEffect(() => {
    voice.attach();
    voice.onWakeActiveChange = setWakeActive;
    return () => {
      voice.onWakeActiveChange = null;
      voice.dispose();
      setWakeActive(false);
    };
  }, [voice]);

  const submit = useCallback((text: string, source: InputSource) => {
    setOpen(true);
    setPending({ id: nextId.current++, text, source });
  }, []);

  const consumePending = useCallback((id: number) => setPending((p) => (p && p.id === id ? null : p)), []);
  const pushMessage = useCallback((m: NewMessage) => setMessages((list) => [...list, { ...m, id: nextMessage.current++ }]), []);
  const clearMessages = useCallback(() => setMessages([]), []);

  // "Hey Flurry …": open the panel and hand it the rest of the sentence, or listen for it.
  useEffect(() => {
    voice.setWake(
      wakeEnabled,
      (transcript) => {
        const rest = afterWakePhrase(transcript);
        if (rest === null) return;
        if (rest) submit(rest, 'voice');
        else {
          setOpen(true);
          setListenRequested(true);
        }
      },
      (code) => {
        setWakeError(voiceErrorMessage(code));
        setWakeEnabledState(false);
        writeStorage(k.wake, null);
      },
    );
  }, [voice, wakeEnabled, submit, k.wake]);

  const setWakeEnabled = useCallback(
    (on: boolean) => {
      setWakeError(null);
      setWakeEnabledState(on);
      writeStorage(k.wake, on ? 'on' : null);
    },
    [k.wake],
  );
  const setSpeakAnswers = useCallback(
    (on: boolean) => {
      setSpeakAnswersState(on);
      writeStorage(k.speak, on ? 'on' : null);
    },
    [k.speak],
  );

  // Alt+A: open the panel; if it's open but you're elsewhere, go into it; if you're in it, close it.
  // Never while typing in a field (so Option+A still types "å" on a Mac); the assistant's own box
  // counts as a field once something is typed in it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.isComposing) return;
      if (e.code !== 'KeyA' && e.key.toLowerCase() !== 'a') return;
      const t = e.target as HTMLElement | null;
      const emptyAssistantBox = t?.hasAttribute('data-assistant-input') && (t as HTMLTextAreaElement).value === '';
      if (t && !emptyAssistantBox && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      e.preventDefault();
      const panel = document.querySelector('[data-assistant-panel]');
      if (!panel) setOpen(true);
      else if (panel.contains(document.activeElement)) setOpen(false);
      else document.querySelector<HTMLTextAreaElement>('[data-assistant-input]')?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const value = useMemo<AssistantState>(
    () => ({
      open,
      setOpen,
      pending,
      submit,
      consumePending,
      listenRequested,
      clearListenRequest: () => setListenRequested(false),
      messages,
      pushMessage,
      clearMessages,
      voice,
      wakeEnabled,
      wakeActive,
      setWakeEnabled,
      wakeError,
      speakAnswers,
      setSpeakAnswers,
      mood,
      signal,
    }),
    [open, pending, submit, consumePending, listenRequested, messages, pushMessage, clearMessages, voice, wakeEnabled, wakeActive, setWakeEnabled, wakeError, speakAnswers, setSpeakAnswers, mood, signal],
  );

  return <AssistantContext.Provider value={value}>{children}</AssistantContext.Provider>;
}
