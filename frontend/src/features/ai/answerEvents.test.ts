import { describe, expect, it } from 'vitest';
import type { AiAnswer } from '@/api/types';
import { AskStopped, createSseParser, followAnswer, type AskProgress } from './answerEvents';

const answer: AiAnswer = {
  model: 'qwen3:8b',
  answer: 'ONB-9 is waiting for its review.',
  citedTasks: ['ONB-9'],
  notInRecords: [],
  limits: ['Written by AI.'],
  asOf: '2026-10-21T07:00:00Z',
  proposals: [],
  lookedUp: [],
} as unknown as AiAnswer;

/** What Spring's SseEmitter writes: event:name, data:json, a blank line; comments as keep-alives. */
const WIRE = [
  ':working\n\n',
  'event:lookup\ndata:{"tool":"get_task","label":"Read ONB-9","result":"found","refs":[]}\n\n',
  'event:delta\ndata:{"text":"Let me "}\n\n',
  'event:reset\ndata:{}\n\n',
  'event:lookup\r\ndata:{"tool":"get_comments","label":"Read the comments on ONB-9","result":"nothing","refs":[]}\r\n\r\n',
  'event:delta\ndata:{"text":"ONB-9 is waiting "}\n\n',
  'event:delta\ndata:{"text":"for its review. 😀"}\n\n',
  `event:answer\ndata:${JSON.stringify(answer)}\n\n`,
].join('');

function streamOf(text: string, cuts: number[]): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  const at = [0, ...cuts.filter((c) => c > 0 && c < bytes.length).sort((a, b) => a - b), bytes.length];
  return new ReadableStream({
    start(c) {
      for (let i = 0; i + 1 < at.length; i++) c.enqueue(bytes.slice(at[i], at[i + 1]));
      c.close();
    },
  });
}

describe('reading a streamed answer', () => {
  it('parses events however the text is split, including \\r\\n split in two', () => {
    const whole = createSseParser();
    const expected = [...whole.push(WIRE), ...whole.end()];
    expect(expected.map((m) => m.event)).toEqual(['lookup', 'delta', 'reset', 'lookup', 'delta', 'delta', 'answer']);
    for (let i = 0; i <= WIRE.length; i += 3) {
      const p = createSseParser();
      const got = [...p.push(WIRE.slice(0, i)), ...p.push(WIRE.slice(i)), ...p.end()];
      expect(got).toEqual(expected);
    }
    const crlf = createSseParser();
    expect([...crlf.push('event:delta\r'), ...crlf.push('\ndata:{"text":"x"}\r'), ...crlf.push('\n\r\n')]).toEqual([{ event: 'delta', data: '{"text":"x"}' }]);
  });

  it('reports lookups and words as they come, clears words on a reset, and ends with the checked answer', async () => {
    for (const cuts of [[], [1, 2, 3, 50, 51, 140, 141, 142, 300], Array.from({ length: 120 }, (_, i) => i * 7)]) {
      const seen: AskProgress[] = [];
      const got = await followAnswer(streamOf(WIRE, cuts), new AbortController().signal, (p) => seen.push(p));
      expect(got.answer).toBe(answer.answer);
      expect(seen.map((p) => p.lookups.length)).toEqual([1, 1, 1, 2, 2, 2]);
      expect(seen.map((p) => p.draft)).toEqual(['', 'Let me ', '', '', 'ONB-9 is waiting ', 'ONB-9 is waiting for its review. 😀']);
      expect(seen[3].lookups[1].result).toBe('nothing');
    }
  });

  it('stops, fails with the server’s words, and never passes off a cut-off stream as an answer', async () => {
    const stopped = followAnswer(streamOf('event:delta\ndata:{"text":"Half"}\n\nevent:stopped\ndata:{"message":"Stopped. Nothing was changed."}\n\n', []), new AbortController().signal, () => undefined);
    await expect(stopped).rejects.toBeInstanceOf(AskStopped);
    const failed = followAnswer(streamOf('event:error\ndata:{"status":502,"code":"AI_FAILED","message":"The AI provider didn’t respond successfully."}\n\n', []), new AbortController().signal, () => undefined);
    await expect(failed).rejects.toThrow('The AI provider didn’t respond successfully.');
    const cut = followAnswer(streamOf('event:delta\ndata:{"text":"Half an ans"}\n\n', []), new AbortController().signal, () => undefined);
    await expect(cut).rejects.toThrow('cut off');
    // Stopped by the person while reading: the reading ends as stopped.
    const controller = new AbortController();
    const never = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode('event:delta\ndata:{"text":"Hi"}\n\n'));
        controller.signal.addEventListener('abort', () => c.error(new DOMException('aborted', 'AbortError')));
      },
    });
    const pending = followAnswer(never, controller.signal, () => controller.abort());
    await expect(pending).rejects.toBeInstanceOf(AskStopped);
  });
});
