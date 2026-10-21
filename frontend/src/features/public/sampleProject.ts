/**
 * Small, fictional sample projects for the public pages (front page, sign-in, introduction) and
 * the tests.
 *
 * The public one is "Launch the mobile onboarding update": seven weeks of a six-person team, with
 * finished research, work in review, a late task that holds others up, and work nobody owns yet.
 * The same records feed the front page's interactive sample, its 3D model and the sign-in page, so
 * every view tells the same story.
 *
 * They're built relative to "now" so the replay always ends today, and they go through exactly the
 * same code as a real project: the records below become Task / StatusChange / Dependency shapes,
 * the scheduler projects the open work, and `buildProjectModel` turns it into the 3D model.
 * Nothing here is sent to or read from the API.
 */
import type { Dependency, DependencyTask, Milestone, Priority, StatusChange, Task, TaskStatus, UserSummary } from '@/api/types';
import { todayIso } from '@/lib/dates';
import { schedule } from '@/lib/scheduler';
import { buildProjectModel, countsAt, DAY_MS, dayToIso, type ProjectModel } from '@/three/projectModel';

interface SampleTask {
  n: number;
  title: string;
  /** A key of the spec's people, or null for work nobody owns yet. */
  who: string | null;
  priority: Priority;
  /** Day offsets from today (negative = past). */
  created: number;
  moves: [day: number, to: TaskStatus][];
  due: number | null;
  /** Estimate in working days (what the forecast learns pace from on finished work, and plans open work with). */
  estimate?: number;
  waitsOn?: number[];
  /** Index into the spec's milestones. */
  milestone?: number;
  description?: string;
  criteria?: string[];
}

export interface SampleSpec {
  key: string;
  name: string;
  description: string;
  color: string;
  startOffset: number;
  deadlineOffset: number;
  people: Record<string, UserSummary & { role: string }>;
  /** Who created the tasks. */
  reporter: string;
  tasks: SampleTask[];
  milestones: { name: string; due: number; completed: boolean }[];
}

const person = (id: number, name: string, color: string, role: string) => ({ id, name, email: `${name.split(' ')[0].toLowerCase()}@example.com`, avatarColor: color, role });

/**
 * "Launch the mobile onboarding update": the front page's sample. Six people, three milestones,
 * seventeen tasks. Sneha's passkey API is two days late and holds up two tasks, the welcome copy
 * has waited two days for review, and two tasks at the end have no owner yet.
 */
export const ONBOARDING_SAMPLE: SampleSpec = {
  key: 'ONB',
  name: 'Launch the mobile onboarding update',
  description: 'A shorter, friendlier first run for the mobile app: three welcome screens, passkey sign-in and a well-timed notification prompt.',
  color: '#245b78',
  startOffset: -28,
  deadlineOffset: 20,
  reporter: 'aarav',
  people: {
    aarav: person(9001, 'Aarav Sharma', '#245b78', 'Product lead'),
    priya: person(9002, 'Priya Nair', '#3a5f8f', 'Engineering manager'),
    rohan: person(9003, 'Rohan Mehta', '#2f7a55', 'Mobile developer'),
    sneha: person(9004, 'Sneha Iyer', '#93600e', 'Backend developer'),
    ananya: person(9005, 'Ananya Das', '#7a4f8f', 'Product designer'),
    kabir: person(9006, 'Kabir Singh', '#4f5f6e', 'QA engineer'),
  },
  milestones: [
    { name: 'Research and design', due: -8, completed: true },
    { name: 'Beta build', due: 9, completed: false },
    { name: 'Launch', due: 20, completed: false },
  ],
  tasks: [
    { n: 1, title: 'Agree goals and success measures', who: 'aarav', priority: 'HIGH', created: -28, moves: [[-28, 'IN_PROGRESS'], [-26, 'IN_REVIEW'], [-25, 'DONE']], estimate: 1, due: -25, milestone: 0, description: 'What the new first run must change, and how we’ll know it worked.', criteria: ['Target: 70% of new users finish onboarding (from 52%)', 'Measures agreed with engineering and support'] },
    { n: 2, title: 'Interview eight new users about sign-up', who: 'ananya', priority: 'HIGH', created: -27, moves: [[-26, 'IN_PROGRESS'], [-21, 'IN_REVIEW'], [-20, 'DONE']], estimate: 3, due: -20, milestone: 0, description: 'Short calls with people who signed up in the last month.', criteria: ['Eight interviews, notes shared', 'Top three problems written up'] },
    { n: 3, title: 'Map where people drop out of today’s onboarding', who: 'aarav', priority: 'HIGH', created: -27, moves: [[-25, 'IN_PROGRESS'], [-19, 'IN_REVIEW'], [-18, 'DONE']], estimate: 4, due: -18, milestone: 0, description: 'Funnel from install to first project, from last quarter’s analytics.', criteria: ['Drop-off per screen, with numbers', 'Shared with the team'] },
    { n: 4, title: 'Audit the current sign-up screens', who: 'kabir', priority: 'MEDIUM', created: -26, moves: [[-24, 'IN_PROGRESS'], [-21, 'IN_REVIEW'], [-20, 'DONE']], estimate: 2, due: -19, milestone: 0, description: 'Accessibility and error states of the screens we’re replacing.', criteria: ['Issues listed by severity'] },
    { n: 5, title: 'Design the three welcome screens', who: 'ananya', priority: 'HIGH', created: -22, moves: [[-19, 'IN_PROGRESS'], [-12, 'IN_REVIEW'], [-11, 'IN_PROGRESS'], [-9, 'IN_REVIEW'], [-8, 'DONE']], estimate: 5, due: -9, waitsOn: [2, 3], milestone: 0, description: 'Welcome, what you can do, and sign in. One round of changes after review: bigger touch targets.', criteria: ['Light and dark versions', 'Touch targets at least 44 pt', 'Signed off by product'] },
    { n: 6, title: 'Choose the passkey library', who: 'sneha', priority: 'MEDIUM', created: -21, moves: [[-20, 'IN_PROGRESS'], [-16, 'IN_REVIEW'], [-15, 'DONE']], estimate: 2, due: -15, milestone: 0, description: 'Compare two libraries for passkey sign-in on the server.', criteria: ['Decision written down with reasons'] },
    { n: 7, title: 'Write the welcome copy', who: 'aarav', priority: 'MEDIUM', created: -20, moves: [[-12, 'IN_PROGRESS'], [-2, 'IN_REVIEW']], due: -1, estimate: 1, milestone: 1, description: 'Headlines and one line of body text for each welcome screen.', criteria: ['Under 12 words per headline', 'Reviewed for tone'] },
    { n: 8, title: 'Build the welcome screens for iOS and Android', who: 'rohan', priority: 'URGENT', created: -18, moves: [[-5, 'IN_PROGRESS']], due: 4, estimate: 5, waitsOn: [5], milestone: 1, description: 'The three screens from the signed-off designs, behind a feature flag.', criteria: ['Matches the designs on both platforms', 'Works with the largest text size', 'Behind the onboarding-v2 flag'] },
    { n: 9, title: 'Passkey sign-in: server API', who: 'sneha', priority: 'URGENT', created: -18, moves: [[-12, 'IN_PROGRESS']], due: -2, estimate: 3, waitsOn: [6], milestone: 1, description: 'Registration and sign-in endpoints for passkeys, with a password fallback.', criteria: ['Register and sign in with a passkey', 'Password fallback still works', 'Rate limited'] },
    { n: 10, title: 'Connect passkey sign-in to the app', who: 'rohan', priority: 'HIGH', created: -14, moves: [], due: 8, estimate: 3, waitsOn: [9], milestone: 1, description: 'Use the new endpoints from the sign-in welcome screen.', criteria: ['Sign in with a passkey on iOS and Android', 'Clear message when a device has no passkey'] },
    { n: 11, title: 'Ask for notification permission at the right moment', who: 'rohan', priority: 'MEDIUM', created: -12, moves: [], due: 10, estimate: 2, waitsOn: [8], milestone: 1, description: 'After the first project is created, not on first launch.', criteria: ['Prompt shows once, after the first project', 'Explains what notifications are for'] },
    { n: 12, title: 'Track onboarding events in analytics', who: 'sneha', priority: 'MEDIUM', created: -10, moves: [[-3, 'IN_PROGRESS']], due: 7, estimate: 2, milestone: 1, description: 'One event per welcome screen and for finishing onboarding.', criteria: ['Events visible in the dashboard', 'No personal data in events'] },
    { n: 13, title: 'Accessibility check of the new flow', who: 'kabir', priority: 'HIGH', created: -9, moves: [], due: 11, estimate: 2, waitsOn: [8], milestone: 1, description: 'Screen readers, text size and contrast on both platforms.', criteria: ['VoiceOver and TalkBack walkthrough', 'No blocking issues open'] },
    { n: 14, title: 'Beta test with 50 new users', who: 'priya', priority: 'HIGH', created: -8, moves: [], due: 15, estimate: 4, waitsOn: [10, 13], milestone: 2, description: 'Turn on the flag for 50 new sign-ups and watch completion.', criteria: ['50 users through the new flow', 'Completion rate compared with the old flow'] },
    { n: 15, title: 'Staged rollout plan', who: 'priya', priority: 'MEDIUM', created: -6, moves: [[-2, 'IN_PROGRESS']], due: 12, estimate: 2, milestone: 2, description: '10%, 50%, then everyone, with a rollback plan.', criteria: ['Steps and dates agreed', 'Rollback tested'] },
    { n: 16, title: 'App Store screenshots and release notes', who: null, priority: 'LOW', created: -4, moves: [], due: 17, estimate: 2, milestone: 2, description: 'New screenshots showing the welcome screens.', criteria: ['Screenshots for both stores', 'Release notes reviewed'] },
    { n: 17, title: 'Help article for the new sign-in', who: null, priority: 'LOW', created: -3, moves: [], due: 18, estimate: 1, waitsOn: [10], milestone: 2, description: 'How to sign in with a passkey, and what to do without one.', criteria: ['Published before launch', 'Linked from the sign-in screen'] },
  ],
};

/** An older, smaller sample (a library app) kept as a fixture for the analysis tests. */
export const LIBRARY_SAMPLE: SampleSpec = {
  key: 'LIB',
  name: 'Library app',
  description: 'A library catalogue and borrowing app.',
  color: '#2b59c3',
  startOffset: -31,
  deadlineOffset: 16,
  reporter: 'aarav',
  people: {
    aarav: person(9001, 'Aarav Sharma', '#2b59c3', 'Product lead'),
    priya: person(9002, 'Priya Nair', '#3a5f8f', 'Engineering manager'),
    rohan: person(9003, 'Rohan Mehta', '#2f7a55', 'Developer'),
    sneha: person(9004, 'Sneha Iyer', '#93600e', 'Developer'),
  },
  milestones: [
    { name: 'Scope agreed', due: -24, completed: true },
    { name: 'Beta', due: 6, completed: false },
    { name: 'Launch', due: 15, completed: false },
  ],
  tasks: [
  { n: 1, title: 'Agree scope and acceptance criteria', who: 'aarav', priority: 'HIGH', created: -30, moves: [[-29, 'IN_PROGRESS'], [-26, 'IN_REVIEW'], [-25, 'DONE']], due: -24 },
  { n: 2, title: 'Design the data model', who: 'priya', priority: 'HIGH', created: -29, moves: [[-27, 'IN_PROGRESS'], [-22, 'IN_REVIEW'], [-21, 'DONE']], due: -20, waitsOn: [1] },
  { n: 3, title: 'Set up repository and CI', who: 'rohan', priority: 'MEDIUM', created: -29, moves: [[-28, 'IN_PROGRESS'], [-26, 'IN_REVIEW'], [-25, 'DONE']], due: -25 },
  {
    n: 4,
    title: 'Sign-in and roles',
    who: 'rohan',
    priority: 'URGENT',
    created: -26,
    moves: [[-24, 'IN_PROGRESS'], [-17, 'IN_REVIEW'], [-16, 'IN_PROGRESS'], [-13, 'IN_REVIEW'], [-12, 'DONE']],
    due: -14,
    waitsOn: [3],
  },
  { n: 5, title: 'Catalogue search API', who: 'priya', priority: 'HIGH', created: -22, moves: [[-20, 'IN_PROGRESS'], [-11, 'IN_REVIEW'], [-10, 'DONE']], due: -9, waitsOn: [2] },
  { n: 6, title: 'Admin dashboard', who: 'sneha', priority: 'HIGH', created: -19, moves: [[-18, 'IN_PROGRESS'], [-9, 'IN_REVIEW'], [-8, 'DONE']], due: -7, waitsOn: [4] },
  { n: 7, title: 'Borrowing rules', who: 'aarav', priority: 'HIGH', created: -18, moves: [[-12, 'IN_PROGRESS'], [-5, 'IN_REVIEW'], [-4, 'DONE']], due: -3, waitsOn: [2] },
  { n: 8, title: 'Search screen', who: 'sneha', priority: 'MEDIUM', created: -16, moves: [[-7, 'IN_PROGRESS'], [-2, 'IN_REVIEW']], due: -2, estimate: 1, waitsOn: [5] },
  { n: 9, title: 'Reminder emails', who: 'rohan', priority: 'LOW', created: -15, moves: [[-6, 'IN_PROGRESS']], due: 4, estimate: 4, waitsOn: [7] },
  { n: 10, title: 'Load test', who: 'priya', priority: 'MEDIUM', created: -9, moves: [[-4, 'IN_PROGRESS']], due: 3, estimate: 3, waitsOn: [5] },
  { n: 11, title: 'Usability test with five students', who: 'aarav', priority: 'HIGH', created: -7, moves: [[-2, 'IN_PROGRESS']], due: 5, estimate: 3, waitsOn: [8] },
  { n: 12, title: 'Accessibility pass', who: 'sneha', priority: 'MEDIUM', created: -10, moves: [], due: 8, estimate: 3, waitsOn: [8] },
  { n: 13, title: 'Deploy to staging', who: 'rohan', priority: 'URGENT', created: -8, moves: [], due: 7, estimate: 2, waitsOn: [9, 10] },
  { n: 14, title: 'Release notes', who: 'priya', priority: 'LOW', created: -6, moves: [], due: 13, estimate: 2, waitsOn: [12, 13] },
  ],
};

/** The project on the public pages. */
export const SAMPLE_PROJECT = ONBOARDING_SAMPLE;

export interface SampleProjectData {
  now: Date;
  tasks: Task[];
  dependencies: Dependency[];
  milestones: Milestone[];
  history: StatusChange[];
  projectStart: string;
  deadline: string;
}

/** A sample project's records as of `now` (the public sample unless another spec is given). */
export function sampleProjectData(now: Date = new Date(), spec: SampleSpec = SAMPLE_PROJECT): SampleProjectData {
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  // Events happen during working hours on their day; the hour varies by task so nothing ties.
  const at = (day: number, n: number) => new Date(midnight + day * DAY_MS + (9.5 + ((n * 3) % 7)) * 3_600_000).toISOString();
  const date = (day: number) => dayToIso(midnight, day);
  const key = (n: number) => `${spec.key}-${n}`;
  const user = (k: string | null): UserSummary | null => {
    if (!k) return null;
    const { role: _role, ...u } = spec.people[k];
    return u;
  };
  const reporter = user(spec.reporter)!;

  const milestones: Milestone[] = spec.milestones.map((m, i) => {
    const inIt = spec.tasks.filter((t) => t.milestone === i);
    const done = inIt.filter((t) => t.moves.some(([, to]) => to === 'DONE') && t.moves[t.moves.length - 1][1] === 'DONE').length;
    return {
      id: i + 1,
      projectId: 0,
      name: m.name,
      description: null,
      dueDate: date(m.due),
      completed: m.completed,
      completedAt: m.completed ? at(m.due, 1) : null,
      taskCount: inIt.length,
      doneCount: done,
      progress: inIt.length ? Math.round((done / inIt.length) * 100) : m.completed ? 100 : 0,
      createdAt: at(spec.startOffset, 0),
    };
  });

  const history: StatusChange[] = [];
  const tasks: Task[] = spec.tasks.map((s) => {
    const createdAt = at(s.created, s.n);
    let status: TaskStatus = 'TODO';
    history.push({ taskId: s.n, from: null, to: 'TODO', at: createdAt });
    for (const [day, to] of s.moves) {
      history.push({ taskId: s.n, from: status, to, at: at(day, s.n) });
      status = to;
    }
    const firstStart = s.moves.find(([, to]) => to === 'IN_PROGRESS');
    const done = s.moves.find(([, to]) => to === 'DONE');
    const last = s.moves[s.moves.length - 1];
    const milestone = s.milestone !== undefined ? milestones[s.milestone] : null;
    return {
      id: s.n,
      projectId: 0,
      projectKey: spec.key,
      projectName: spec.name,
      projectColor: spec.color,
      key: key(s.n),
      title: s.title,
      description: s.description ?? null,
      status,
      priority: s.priority,
      assignee: user(s.who),
      reporter,
      dueDate: s.due === null ? null : date(s.due),
      milestoneId: milestone?.id ?? null,
      milestoneName: milestone?.name ?? null,
      position: s.n,
      commentCount: 0,
      submissionCount: s.moves.filter(([, to]) => to === 'IN_REVIEW').length,
      overdue: status !== 'DONE' && s.due !== null && s.due < 0,
      createdAt,
      updatedAt: last ? at(last[0], s.n) : createdAt,
      startedAt: firstStart ? at(firstStart[0], s.n) : null,
      completedAt: done ? at(done[0], s.n) : null,
      acceptanceCriteria: (s.criteria ?? []).map((text, i) => ({ id: s.n * 100 + i, text, position: i })),
      checklist: [],
      version: 1,
      estimateDays: s.estimate ?? null,
    };
  });

  const byId = new Map(tasks.map((t) => [t.id, t]));
  const summary = (t: Task): DependencyTask => ({
    id: t.id,
    key: t.key,
    title: t.title,
    status: t.status,
    dueDate: t.dueDate,
    assignee: t.assignee,
    overdue: t.overdue,
    startedAt: t.startedAt,
    completedAt: t.completedAt,
    milestoneId: t.milestoneId,
  });
  let depId = 0;
  const dependencies: Dependency[] = spec.tasks.flatMap((s) =>
    (s.waitsOn ?? []).map((blocker) => ({
      id: ++depId,
      projectId: 0,
      blocker: summary(byId.get(blocker)!),
      blocked: summary(byId.get(s.n)!),
      createdBy: reporter,
      createdAt: at(s.created, s.n),
    })),
  );

  return { now, tasks, dependencies, milestones, history, projectStart: date(spec.startOffset), deadline: date(spec.deadlineOffset) };
}

/** A sample project as a 3D model, including the scheduler's estimate for the open work. */
export function buildSampleModel(now: Date = new Date(), spec: SampleSpec = SAMPLE_PROJECT): ProjectModel {
  return modelFromData(sampleProjectData(now, spec));
}

/** Records → scheduler projection → model, exactly as a project's Model page does it. */
export function modelFromData(data: SampleProjectData): ProjectModel {
  const now = data.now;
  const projection = schedule({
    today: todayIso(now),
    tasks: data.tasks.map((t) => ({
      id: t.id,
      key: t.key,
      title: t.title,
      status: t.status,
      priority: t.priority,
      assigneeId: t.assignee?.id ?? null,
      dueDate: t.dueDate,
      estimateDays: t.estimateDays,
      startedOn: t.startedAt ? todayIso(new Date(t.startedAt)) : null,
      milestoneId: t.milestoneId,
    })),
    dependencies: data.dependencies.map((d) => ({ blockerId: d.blocker.id, blockedId: d.blocked.id })),
  });
  return buildProjectModel({
    now,
    projectStart: data.projectStart,
    deadline: data.deadline,
    tasks: data.tasks,
    dependencies: data.dependencies,
    milestones: data.milestones,
    history: data.history,
    projection,
  });
}

/** How many tasks, people and weeks a sample spans, for captions. */
export function sampleFacts(spec: SampleSpec = SAMPLE_PROJECT) {
  return { tasks: spec.tasks.length, people: Object.keys(spec.people).length, weeks: Math.round((spec.deadlineOffset - spec.startOffset) / 7) };
}
export const SAMPLE_FACTS = sampleFacts();

/** One sentence for screen readers (the canvas itself is decorative for them). */
export function sampleSummary(model: ProjectModel, spec: SampleSpec = SAMPLE_PROJECT): string {
  const c = countsAt(model, model.todayDay);
  const f = sampleFacts(spec);
  return (
    `A sample project, ${spec.name}: ${f.tasks} tasks shared by ${f.people} people over about ${f.weeks} weeks. ` +
    `Today ${c.DONE} are approved, ${c.IN_REVIEW} ${c.IN_REVIEW === 1 ? 'is' : 'are'} in review, ${c.IN_PROGRESS} in progress and ${c.TODO} not started.`
  );
}
