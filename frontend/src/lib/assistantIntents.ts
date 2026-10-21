/**
 * Understanding typed or spoken requests to the assistant, without AI.
 *
 * Task commands ("create a task…", "start LIB-8", "open LIB-8") and the common questions
 * (forecast, risks, recent changes, what's next) are recognised here with plain rules, so they
 * work with no AI provider at all. Anything else is a free question for the AI, when
 * one is configured. Nothing here changes data: commands become proposals a person confirms.
 */
import type { Priority, Task } from '@/api/types';

export type Intent =
  | { kind: 'create-task'; title: string | null; priority: Priority | null; due: string | null; assignee: string | null; estimate: number | null }
  /** "Plan a project" with the brief that followed (null: ask for one). */
  | { kind: 'plan'; brief: string | null }
  | { kind: 'summary' }
  | { kind: 'blockers' }
  | { kind: 'agenda' }
  | { kind: 'start-task'; key: string }
  | { kind: 'open-task'; key: string }
  | { kind: 'open-model' }
  /** A question about one exact task: what it waits on, what waits on it, or how it stands. */
  | { kind: 'task-question'; key: string; aspect: 'blocked' | 'blocks' | 'general' }
  | { kind: 'my-work' }
  | { kind: 'next' }
  | { kind: 'forecast' }
  /** "Why did the date move?": the forecast replayed as of `days` ago, with each kind of change measured. */
  | { kind: 'date-moved'; days: number }
  | { kind: 'my-finish' }
  | { kind: 'risks' }
  | { kind: 'changes'; days: number }
  | { kind: 'help' }
  | { kind: 'greeting' }
  | { kind: 'thanks' }
  | { kind: 'question'; text: string };

const DAY_MS = 86_400_000;
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
/** Month index for a full name or a standard abbreviation ("oct", "sept"); -1 for any other word. */
function monthIndex(word: string): number {
  const w = word.toLowerCase().replace(/\.$/, '');
  const full = MONTHS.indexOf(w);
  if (full >= 0) return full;
  if (w === 'sept') return 8;
  return w.length === 3 ? MONTHS.findIndex((m) => m.startsWith(w)) : -1;
}
const UNITS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
/** Spoken numbers up to 99 ("eight", "twenty three", "twenty-three") as a regex source. */
const NUMBER_WORD = String.raw`(?:(?:${Object.keys(TENS).join('|')})(?:[-\s](?:${Object.keys(UNITS).slice(0, 9).join('|')}))?|${Object.keys(UNITS).join('|')})`;

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}
function toNumber(word: string): number | null {
  const w = word.trim().toLowerCase();
  if (/^\d+$/.test(w)) return Number(w);
  if (w in UNITS) return UNITS[w];
  const m = /^([a-z]+)(?:[-\s]([a-z]+))?$/.exec(w);
  if (m && m[1] in TENS) {
    if (!m[2]) return TENS[m[1]];
    const unit = UNITS[m[2]];
    return unit !== undefined && unit < 10 ? TENS[m[1]] + unit : null;
  }
  return null;
}

/** "Hey Flurry" (also "hi"/"ok"/"okay", and "flurries", "flury" or "flurri"), as speech recognisers write it. */
export const WAKE_PHRASE = /\b(?:hey|hi|okay|ok)[\s,]+(?:flurry|flurries|flury|flurri)\b[\s,.!?]*/i;

/** The words after the wake phrase ('' if nothing followed it), or null if it wasn't said. */
export function afterWakePhrase(transcript: string): string | null {
  const m = WAKE_PHRASE.exec(transcript);
  if (!m) return null;
  return transcript.slice(m.index + m[0].length).trim();
}

/**
 * A due date from a phrase: today, tomorrow, the day after tomorrow, a weekday (the next one after
 * today), next week (next Monday), the end of the week (Friday), "in 3 days", "in 2 weeks",
 * "14 Oct", "October 14", "14/10" (day/month) or "2026-10-14". Null if it isn't a date.
 */
export function parseDue(phrase: string, today: Date): string | null {
  const p = phrase.trim().toLowerCase().replace(/[.,!?]+$/, '');
  if (p === 'today') return iso(today);
  if (p === 'tomorrow') return iso(addDays(today, 1));
  if (p === 'the day after tomorrow' || p === 'day after tomorrow') return iso(addDays(today, 2));
  if (p === 'next week') return iso(addDays(today, ((8 - today.getDay()) % 7) || 7));
  if (/^(?:the\s+)?end of (?:the |this )?week$/.test(p)) return iso(addDays(today, ((5 - today.getDay() + 7) % 7) || 7));
  const weekday = /^(?:(?:this|next|on)\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/.exec(p);
  if (weekday) {
    const target = WEEKDAYS.indexOf(weekday[1]);
    return iso(addDays(today, ((target - today.getDay() + 7) % 7) || 7));
  }
  const inN = /^in\s+(\w+)\s+(days?|weeks?)$/.exec(p);
  if (inN) {
    const n = toNumber(inN[1]);
    if (n !== null) return iso(addDays(today, n * (inN[2].startsWith('week') ? 7 : 1)));
  }
  const isoDate = /^(\d{4})-(\d{2})-(\d{2})$/.exec(p);
  if (isoDate) {
    // Only real dates: 2026-02-30 is not one.
    const d = new Date(Number(isoDate[1]), Number(isoDate[2]) - 1, Number(isoDate[3]));
    return iso(d) === p ? p : null;
  }
  const build = (day: number, monthIndex: number) => {
    if (monthIndex < 0 || day < 1 || day > 31) return null;
    let d = new Date(today.getFullYear(), monthIndex, day);
    if (d.getMonth() !== monthIndex) return null; // e.g. 31 Sep
    if (d < new Date(today.getFullYear(), today.getMonth(), today.getDate())) d = new Date(today.getFullYear() + 1, monthIndex, day);
    return iso(d);
  };
  const dayMonth = /^(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?(?:\s+of)?\s+([a-z]{3,})$/.exec(p);
  if (dayMonth) return build(Number(dayMonth[1]), monthIndex(dayMonth[2]));
  const monthDay = /^([a-z]{3,})\s+(\d{1,2})(?:st|nd|rd|th)?$/.exec(p);
  if (monthDay) return build(Number(monthDay[2]), monthIndex(monthDay[1]));
  const slash = /^(\d{1,2})\/(\d{1,2})$/.exec(p);
  if (slash) return build(Number(slash[1]), Number(slash[2]) - 1);
  return null;
}

/** "lib 8", "LIB-8", "lib eight" → "LIB-8". */
function taskKey(prefix: string, number: string): string | null {
  const n = toNumber(number);
  return n === null ? null : `${prefix.toUpperCase()}-${n}`;
}
const KEY = String.raw`([a-z][a-z0-9]{0,9})[-\s]?(\d+|${NUMBER_WORD})\b`;

const MONTH_WORD = String.raw`(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?(?![a-z])`;
const DATE_WORDS = String.raw`(today|tomorrow|(?:the\s+)?day after tomorrow|next week|(?:the\s+)?end of (?:the |this )?week|(?:(?:this|next|on)\s+)?(?:sun|mon|tues|wednes|thurs|fri|satur)day|in\s+\w+\s+(?:days?|weeks?)|\d{4}-\d{2}-\d{2}|(?:the\s+)?\d{1,2}(?:st|nd|rd|th)?(?:\s+of)?\s+${MONTH_WORD}|${MONTH_WORD}\s+\d{1,2}(?:st|nd|rd|th)?|\d{1,2}\/\d{1,2})`;

/** The details in a phrase describing one task: its title, and any due date, priority, owner or estimate. */
export function parseTaskPhrase(text: string, today: Date = new Date()): Extract<Intent, { kind: 'create-task' }> {
  return parseCreate(text, today);
}

function parseCreate(rest: string, today: Date): Extract<Intent, { kind: 'create-task' }> {
  let text = ` ${rest} `;
  let due: string | null = null;
  let priority: Priority | null = null;
  let assignee: string | null = null;
  let estimate: number | null = null;

  // Quoted titles win: everything else in the sentence is then a detail.
  // (Single quotes only at word boundaries, so apostrophes in "don't" or "Priya's" aren't quotes.)
  const quoted = /["“](.+?)["”]/.exec(rest) ?? /(?:^|\s)['‘](.+?)['’](?=[\s,.]|$)/.exec(rest);

  const dueRe = new RegExp(String.raw`[\s,]+(?:due|by|before|for|on)\s+${DATE_WORDS}(?=[\s,.]|$)`, 'i');
  const dueMatch = dueRe.exec(text);
  if (dueMatch) {
    const d = parseDue(dueMatch[1], today);
    if (d) {
      due = d;
      text = text.replace(dueMatch[0], ' ');
    }
  }
  const prio = /[\s,]+(?:with\s+)?(?:(urgent|high|medium|normal|low)\s+priority|priority\s+(?:is\s+)?(urgent|high|medium|normal|low)|(urgent(?:ly)?))(?=[\s,.]|$)/i.exec(text);
  if (prio) {
    const word = (prio[1] ?? prio[2] ?? prio[3]).toLowerCase().replace(/ly$/, '');
    priority = word === 'urgent' ? 'URGENT' : word === 'high' ? 'HIGH' : word === 'low' ? 'LOW' : 'MEDIUM';
    text = text.replace(prio[0], ' ');
  }
  const who = /[\s,]+(?:and\s+)?assign(?:ed)?\s+(?:it\s+)?to\s+([a-z][a-z'-]+(?:\s+[a-z][a-z'-]+)?)(?=[\s,.]|$)/i.exec(text);
  if (who) {
    assignee = who[1].replace(/\b\w/g, (c) => c.toUpperCase());
    // Only the first word if the second is a connector ("to Priya and …").
    assignee = assignee.replace(/\s+(And|With|Due|By|Priority)$/i, '');
    text = text.replace(who[0], ' ');
  }
  const est = /[\s,]+(?:(?:with\s+(?:an?\s+)?)?estimate[d]?\s+(?:at\s+|of\s+)?(\w+)\s+(?:working\s+)?days?|(?:it\s+)?takes?\s+(\w+)\s+(?:working\s+)?days?|(\w+)[-\s](?:working[-\s])?days?\s+estimate)(?=[\s,.]|$)/i.exec(text);
  if (est) {
    const n = toNumber(est[1] ?? est[2] ?? est[3]);
    if (n !== null && n > 0 && n <= 60) {
      estimate = n;
      text = text.replace(est[0], ' ');
    }
  }
  let title = quoted
    ? quoted[1]
    : text
        .replace(/^\s*(?:called|named|titled|to|for|:|-)\s+/i, ' ')
        .replace(/[\s,]+(?:and|with|that is|which is)\s*$/i, '')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/^(?:called|named|titled|to|:|-)\s+/i, '')
        .replace(/[,.;:\s]+$/, '');
  if (title) title = title.charAt(0).toUpperCase() + title.slice(1);
  if (title && title.length > 200) title = title.slice(0, 200);
  return { kind: 'create-task', title: title || null, priority, due, assignee, estimate };
}

/** What the person asked for. `today` is only used to turn phrases like "Friday" into dates. */
export function parseIntent(input: string, today: Date = new Date()): Intent {
  let text = input.trim().replace(/\s+/g, ' ');
  const afterWake = afterWakePhrase(text);
  if (afterWake !== null) {
    // "Hey Flurry" on its own is a greeting.
    if (!afterWake.replace(/[\s,.!?]+/g, '')) return { kind: 'greeting' };
    text = afterWake;
  }
  const polite = /^(?:please|can you|could you|would you|will you|i want to|i'd like to|let's)\s+/i;
  text = text.replace(polite, '').replace(/[?!.]+$/, '').trim();
  // "Hi", "Hello Flurry, what's at risk?": a greeting on its own gets a greeting back, without AI;
  // with a request after it, the request is what counts.
  const greeting = /^(?:hi|hii+|hello|hey|hiya|howdy|namaste|yo|good (?:morning|afternoon|evening|day))(?:\s+(?:there|flurry|team|all|everyone))?(?:[\s,!.]+|$)/i.exec(text);
  if (greeting) {
    const rest = text.slice(greeting[0].length).trim();
    if (!rest) return { kind: 'greeting' };
    text = rest.replace(polite, '').trim();
  }
  const lower = text.toLowerCase();
  if (!lower) return { kind: 'help' };

  if (/^(?:who are you|what are you|what(?:'s| is) your name|are you (?:an? )?(?:ai|bot|robot|human))\b/.test(lower)) return { kind: 'greeting' };
  if (/^(?:thanks|thank you|thank u|thx|ty|cheers|great|perfect|nice|awesome|cool|got it|ok(?:ay)?|alright)(?:\s+(?:so much|a lot|very much|flurry))*$/.test(lower)) return { kind: 'thanks' };
  if (/^(?:help|what can you do|commands|how do i use (?:this|you))\b/.test(lower)) return { kind: 'help' };

  const start = new RegExp(String.raw`^(?:start|begin|start working on|work on|pick up)\s+(?:task\s+)?${KEY}`, 'i').exec(text);
  if (start) {
    const key = taskKey(start[1], start[2]);
    if (key) return { kind: 'start-task', key };
  }
  const open = new RegExp(String.raw`^(?:open|show(?:\s+me)?|go to|view|find)\s+(?:task\s+)?${KEY}`, 'i').exec(text);
  if (open) {
    const key = taskKey(open[1], open[2]);
    if (key) return { kind: 'open-task', key };
  }
  if (/^(?:open|show(?:\s+me)?|go to|view)\b.*\b(?:3d|3-d|model)\b/.test(lower)) return { kind: 'open-model' };

  // "Plan a project: …", "Draft a plan for …", "Turn this brief into a plan: …".
  const plan = /^(?:plan(?:\s+(?:a|the|this|my|our)\s+(?:new\s+)?project)?|draft\s+(?:a\s+|the\s+)?(?:project\s+)?plan|make\s+(?:a\s+)?plan|turn\s+(?:this|the|my|a)\s+brief\s+into\s+(?:a\s+)?(?:plan|tasks))\b\s*(?:for|from|of|with)?\s*[:\-–—]?\s*(.*)$/i.exec(text);
  if (plan) {
    const brief = plan[1].trim();
    return { kind: 'plan', brief: brief.length >= 12 ? brief : null };
  }

  // After the key commands, so "open task LIB-8" opens it rather than drafting a task called "LIB-8".
  const create = /^(?:create|add|make|new|open)\s+(?:a\s+|an\s+)?(?:new\s+)?(?:task|to-?do)\b[\s:,-]*(.*)$/i.exec(text);
  if (create) return parseCreate(create[1], today);

  // A question about one exact task ("Why is ONB-9 blocked?", "What depends on ONB-9?"): answered
  // about that task, in the right direction, not with a project-wide report.
  const exact = /\b([a-z][a-z0-9]{1,9})-(\d{1,5})\b/i.exec(text);
  if (exact) {
    const key = `${exact[1].toUpperCase()}-${Number(exact[2])}`;
    const k = exact[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const blocks = new RegExp(String.raw`(?:depends?\s+on|depending\s+on|waits?\s+(?:on|for)|waiting\s+(?:on|for))\s+(?:task\s+)?${k}|${k}\s+(?:is\s+)?(?:block(?:s|ing)?|hold(?:s|ing)?(?:\s+up)?)\b|what\s+(?:does|is)\s+${k}\s+(?:block|hold)`, 'i');
    const blocked = new RegExp(String.raw`(?:holding\s+up|holds\s+up|blocking|blocks|delaying|stopping)\s+(?:task\s+)?${k}|${k}\s+(?:is\s+)?(?:blocked|stuck|waiting|held\s+up|delayed)|why\s+(?:can['’]?t|cannot)\s+${k}|what\s+(?:is|does)\s+${k}\s+(?:wait|waiting)`, 'i');
    return { kind: 'task-question', key, aspect: blocks.test(text) ? 'blocks' : blocked.test(text) ? 'blocked' : 'general' };
  }

  // "When will I finish?", "How long will I be working on this?": my own forecast (before "my work").
  if (/\b(?:when (?:will|do|would|can|should) i (?:be )?(?:finish(?:ed)?|done|complete|be done)|how long (?:will|do|would) i (?:be working|need|have|take)|how much (?:work|effort) (?:do i have|have i got|is) left|when am i (?:done|finished|free)|my (?:finish date|remaining (?:work|effort)|forecast))\b/.test(lower)) return { kind: 'my-finish' };
  if (/\b(?:what should i (?:do|work on)|what(?:'s| is) next|next task|work on next|where should i start|what do i do next)\b/.test(lower)) return { kind: 'next' };
  if (/\b(?:my (?:tasks|work)|assigned to me|on my plate)\b/.test(lower)) return { kind: 'my-work' };

  if (/\b(?:agenda|meeting|stand-?up|check-?in)\b/.test(lower)) return { kind: 'agenda' };
  if (/\b(?:summar(?:y|ise|ize)|progress|status (?:update|report)|how (?:are|is) (?:we|it|the project|this project) (?:doing|going)|where (?:are we|do we stand))\b/.test(lower)) return { kind: 'summary' };
  if (/\b(?:block(?:ers?|ed|ing)|stuck|missing owners?|no owners?|unassigned|who owns)\b/.test(lower)) return { kind: 'blockers' };

  // "Why did the date move?" before the forecast: it's about the change, not the date.
  if (
    /\b(?:why (?:did|has|have|is|was) (?:the |our )?(?:date|deadline|forecast|finish(?: date)?|delivery(?: date)?|end date|estimate)s? (?:move|moved|change|changed|slip|slipped|shift|shifted|get later|got later|go up|gone up|later|earlier)|why (?:are we|is it|is the project|is this project|did we get|did it get) (?:later|behind|slipping|late)|what (?:moved|pushed|changed|shifted) (?:the |our )?(?:date|deadline|forecast|finish)|why (?:the )?(?:date|forecast|finish) (?:moved|changed|slipped))\b/.test(lower)
  ) {
    const weeks = /\b(?:last|past|since) (\w+) weeks?\b/.exec(lower);
    const daysSpan = /\b(?:last|past) (\w+) days\b/.exec(lower);
    const n = daysSpan ? toNumber(daysSpan[1]) : weeks ? (toNumber(weeks[1]) ?? 1) * 7 : /\b(?:a|last|this|past) month\b/.test(lower) ? 30 : null;
    return { kind: 'date-moved', days: n && n > 0 && n <= 90 ? n : 7 };
  }

  // Forecast and risks before changes: "will we finish this week?" is a forecast question.
  if (/\b(?:on track|deadline|when will (?:we|it|the project|this) (?:finish|be done|end)|forecast|predict(?:ion)?|projection|estimated finish|finish date|will we (?:make|finish|hit|meet))\b/.test(lower)) return { kind: 'forecast' };
  if (/\b(?:risks?|at risk|overdue|late|behind|what(?:'s| is) wrong|problems?|bottlenecks?)\b/.test(lower)) return { kind: 'risks' };
  if (/\b(?:what (?:changed|happened)|what(?:'s| has) (?:changed|happened)|last \w+ days|recent(?:ly)?|lately|changes this week)\b/.test(lower)) {
    const span = /\blast (\w+) days\b/.exec(lower);
    const n = span ? toNumber(span[1]) : null;
    return { kind: 'changes', days: n && n > 0 && n <= 60 ? n : 7 };
  }

  return { kind: 'question', text };
}

/** A person's open tasks in the order to pick them up, with the reason for each (no AI). */
export function suggestNext(tasks: readonly Task[], today: Date = new Date()): { task: Task; reason: string }[] {
  const todayIso = iso(today);
  const days = (d: string) => Math.round((new Date(`${d}T12:00:00`).getTime() - new Date(`${todayIso}T12:00:00`).getTime()) / DAY_MS);
  const rankPriority: Record<Priority, number> = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
  const open = tasks.filter((t) => t.status === 'TODO' || t.status === 'IN_PROGRESS');
  const score = (t: Task) => {
    const due = t.dueDate ? days(t.dueDate) : null;
    const bucket = due !== null && due < 0 ? 0 : t.status === 'IN_PROGRESS' ? 1 : due !== null && due <= 3 ? 2 : 3;
    return [bucket, due ?? 9999, rankPriority[t.priority]];
  };
  return [...open]
    .sort((a, b) => {
      const x = score(a);
      const y = score(b);
      return x[0] - y[0] || x[1] - y[1] || x[2] - y[2] || a.key.localeCompare(b.key, undefined, { numeric: true });
    })
    .map((task) => {
      const due = task.dueDate ? days(task.dueDate) : null;
      const reason =
        due !== null && due < 0
          ? `overdue by ${-due} ${due === -1 ? 'day' : 'days'}`
          : task.status === 'IN_PROGRESS'
            ? due === null
              ? 'already in progress'
              : `in progress, due ${due === 0 ? 'today' : due === 1 ? 'tomorrow' : `in ${due} days`}`
            : due === null
              ? `${task.priority.toLowerCase()} priority, no due date`
              : `due ${due === 0 ? 'today' : due === 1 ? 'tomorrow' : `in ${due} days`}`;
      return { task, reason };
    });
}
