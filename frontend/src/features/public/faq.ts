/**
 * Questions and answers for the FAQ page (and the site search). Plain text, so the same words go
 * into the page, the search index and the FAQPage structured data for search engines.
 * Keep answers true to what the product does; update FAQ_UPDATED with every change.
 */

export const FAQ_UPDATED = '28 September 2026';

export interface FaqEntry {
  /** Stable anchor: /faq#<id>. */
  id: string;
  question: string;
  /** Paragraphs. */
  answer: string[];
  /** Extra words people might search with. */
  keywords?: string;
  link?: { to: string; label: string };
}

export interface FaqGroup {
  id: string;
  title: string;
  entries: FaqEntry[];
}

export const FAQ: FaqGroup[] = [
  {
    id: 'start',
    title: 'Getting started',
    entries: [
      {
        id: 'what-is-projectflow',
        question: 'What is Niveloft?',
        answer: [
          'A project workspace for focused teams: tasks, owners, deadlines and milestones in one place, so everyone knows what matters, who owns it and what comes next.',
          'Work counts as done only when someone else has checked it against criteria agreed before it began. Flurry, the AI assistant, helps you plan, summarise progress and review blockers, and asks before it changes anything.',
          '“Niveloft” is a working name for this capstone project.',
        ],
        keywords: 'about overview tool software',
        link: { to: '/introduction', label: 'Read the five-minute introduction' },
      },
      {
        id: 'is-it-free',
        question: 'Does it cost anything?',
        answer: [
          'Creating an account is free. Niveloft is a capstone project; whoever runs this copy decides who may sign up.',
          'The optional AI features can use free models (Ollama on the server’s computer, or the AI built into Chrome), so they don’t have to cost anything either.',
        ],
        keywords: 'price pricing payment subscription plan',
      },
      {
        id: 'first-project',
        question: 'How do I start my first project?',
        answer: [
          'Sign in, press New project on Today or Projects, give it a name, a short key (such as ONB) and its dates. You become its owner and can invite your team from the People chapter.',
        ],
        keywords: 'create new project setup',
        link: { to: '/introduction#first-steps', label: 'Your first ten minutes' },
      },
    ],
  },
  {
    id: 'roles',
    title: 'Roles and permissions',
    entries: [
      {
        id: 'four-roles',
        question: 'What can owners, managers, members and viewers do?',
        answer: [
          'Owners can do everything, including appointing managers and deleting the project. Managers run the work: they assign tasks, invite people and review submissions. Members create tasks and do the work assigned to them. Viewers see everything and change nothing.',
          'The server checks the role on every request, so hiding a button is never the only protection.',
        ],
        keywords: 'owner manager member viewer permission access rights',
        link: { to: '/introduction#roles', label: 'See the full permission table' },
      },
      {
        id: 'only-the-assignee',
        question: 'Why does it say only the assignee can submit?',
        answer: [
          'The assignee is the one person a task is given to. Submitting work for review is their step, so nobody else (not even a manager) can submit it on their behalf. Ask a manager to reassign the task if someone else should hand it in.',
        ],
        keywords: 'assignee submit error only the assignee',
      },
      {
        id: 'review-own-work',
        question: 'Can a manager approve their own work?',
        answer: ['No. A reviewer never judges their own submission. Another manager or the owner has to review it.'],
        keywords: 'approve self review conflict',
      },
      {
        id: 'change-role',
        question: 'How do I change someone’s role?',
        answer: ['In the project’s People chapter, choose a new role next to their name. Managers can give the member and viewer roles; only the owner can appoint managers.'],
        keywords: 'promote demote team people',
      },
    ],
  },
  {
    id: 'work',
    title: 'Tasks and reviews',
    entries: [
      {
        id: 'drag-to-done',
        question: 'Why can’t I drag a task to Done?',
        answer: [
          'Done is reached only through an approved review. The assignee submits evidence, and a reviewer checks every acceptance criterion. The server refuses a direct request too, so no one can skip the review.',
        ],
        keywords: 'board drag done column blocked',
      },
      {
        id: 'evidence',
        question: 'What counts as evidence?',
        answer: [
          'Links (a repository, a deployment or any other address), screenshots and files, plus notes for the reviewer. Every checklist item must be ticked and at least one piece of evidence added before submitting.',
        ],
        keywords: 'submit proof attachment upload link file',
      },
      {
        id: 'changes-requested',
        question: 'What happens when a reviewer requests changes?',
        answer: [
          'The task goes back to In progress with the reviewer’s feedback. The next submission becomes version 2, and every earlier version and decision stays on the task.',
        ],
        keywords: 'rework feedback reject version history',
      },
      {
        id: 'upload-limits',
        question: 'How big can uploaded files be?',
        answer: ['Up to 10 MB per file and 55 MB per submission, with 1 GB of evidence per project on the default settings.'],
        keywords: 'file size limit upload attachment',
      },
    ],
  },
  {
    id: 'model',
    title: 'Model, forecast and predictions',
    entries: [
      {
        id: 'what-is-the-model',
        question: 'What is the 3D model?',
        answer: [
          'Each project drawn as a scene: time runs left to right, every person has a lane, and each task is a block whose height is its priority. You can replay any past day from the recorded status changes.',
        ],
        keywords: '3d three model replay',
      },
      {
        id: 'how-predictions-work',
        question: 'How does the Prediction model work?',
        answer: [
          'It simulates the open work 400 times, using each person’s own pace against their estimates and how long reviews usually take. It shows a likely finish date and a range for each person, each role and the whole project.',
          'With little history the range is wide, and the page says so. It’s an estimate, not a promise.',
        ],
        keywords: 'forecast prediction estimate deadline monte carlo',
      },
    ],
  },
  {
    id: 'ai',
    title: 'AI and the assistant',
    entries: [
      {
        id: 'need-ai',
        question: 'Do I need AI to use Niveloft?',
        answer: [
          'No. Flurry’s summaries, blocker reviews, agendas and forecasts are worked out from your project’s records, and plans can be drafted from the lines of your brief, all without an AI service. Each answer says so.',
          'AI answers are an optional extra: a free Ollama model on the server’s computer, a hosted service the operator sets up, or the AI built into Chrome.',
        ],
        keywords: 'ai required ollama chrome gemini nano built-in',
      },
      {
        id: 'who-is-flurry',
        question: 'Who is Flurry?',
        answer: [
          'Flurry is Niveloft’s AI project assistant: the small snow creature in the corner of every page once you’re signed in. Click it, or press Alt+A (Option+A on a Mac).',
          'It turns a brief into draft tasks, summarises progress, reviews blockers and missing owners, drafts meeting agendas and answers questions about a project, citing the tasks it used. It only sees what you can see, it says what the records don’t show, and it asks before creating or changing anything.',
          'You can drag Flurry anywhere, minimise or hide it, turn its sounds on and keep it still.',
        ],
        keywords: 'assistant flurry mascot ai helper ask',
      },
      {
        id: 'ai-changes',
        question: 'Can the AI change my project?',
        answer: [
          'No. It can only suggest. It never approves work, assigns people or changes deadlines by itself; any suggested task is shown for a person to check and confirm. It also can’t open links or files, and says so.',
        ],
        keywords: 'ai safety approve assign automatic',
      },
      {
        id: 'arena',
        question: 'What is the Arena?',
        answer: [
          'A page where two answer sources reply to the same question about your project side by side, with their names hidden. You pick the better answer, the names are revealed, and a scoreboard keeps count of which source people prefer.',
        ],
        keywords: 'arena compare models vote blind leaderboard',
        link: { to: '/arena', label: 'Open the Arena (sign-in needed)' },
      },
    ],
  },
  {
    id: 'account',
    title: 'Account, privacy and data',
    entries: [
      {
        id: 'forgot-password',
        question: 'I forgot my password. What now?',
        answer: [
          'Use “Forgot password?” on the sign-in page. If this copy sends emails, you’ll get a link to choose a new one. If it doesn’t, contact whoever runs it.',
        ],
        keywords: 'reset password login sign in locked',
        link: { to: '/forgot-password', label: 'Reset your password' },
      },
      {
        id: 'password-rules',
        question: 'What makes a valid password?',
        answer: ['8 to 72 characters with at least one letter and one number. The eye button in the field shows what you typed.'],
        keywords: 'password requirements length strength',
      },
      {
        id: 'delete-data',
        question: 'How do I see, export or delete my data?',
        answer: ['Send a message with the Contact button, or write to the address on the privacy policy. The operator answers requests about your data.'],
        keywords: 'gdpr delete account export privacy data request',
        link: { to: '/privacy#rights', label: 'Your choices and rights' },
      },
      {
        id: 'what-is-tracked',
        question: 'What does the site measure about visits?',
        answer: [
          'Without your consent, only counts: how often each form is opened, sent, succeeds or fails (no contents, no identity). If you arrived from a link with campaign tags (utm_source and similar), those tags are saved with a new account so the operator can see which campaigns bring sign-ups.',
          'Analytics that set cookies load only if you agree in the cookie banner.',
        ],
        keywords: 'utm tracking analytics cookies campaign measurement',
        link: { to: '/privacy#collect', label: 'What we collect' },
      },
    ],
  },
  {
    id: 'trouble',
    title: 'Troubleshooting',
    entries: [
      {
        id: 'too-many-requests',
        question: 'Why does it say “too many requests”?',
        answer: [
          'Each person can make a few hundred requests a minute, which protects the server for everyone. The app waits and retries by itself; if you still see the message, wait a minute.',
        ],
        keywords: 'rate limit 429 slow error busy',
      },
      {
        id: 'error-reference',
        question: 'Something went wrong and showed a reference. What do I do?',
        answer: [
          'Copy the reference with the button next to it and send it with the Contact button. It lets the operator find exactly what happened in the server’s log.',
        ],
        keywords: 'error bug reference request id crash',
      },
      {
        id: 'offline',
        question: 'What happens if my connection drops?',
        answer: [
          'A banner says you’re offline. Pages you’ve opened stay readable, and requests are retried once the connection is back. Changes you send twice by accident are made only once.',
        ],
        keywords: 'offline internet connection network retry',
      },
    ],
  },
];

export const FAQ_ENTRIES: (FaqEntry & { group: string })[] = FAQ.flatMap((g) => g.entries.map((e) => ({ ...e, group: g.title })));

/** Structured data for search engines (schema.org FAQPage). */
export function faqJsonLd(): string {
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQ_ENTRIES.map((e) => ({
      '@type': 'Question',
      name: e.question,
      acceptedAnswer: { '@type': 'Answer', text: e.answer.join(' ') },
    })),
  }).replace(/</g, '\\u003c');
}
