/**
 * Sample data for the in-browser test API (the automated tests' stand-in for the real one). All
 * dates are relative to "now" so the tests always see a realistic mix of overdue, upcoming and
 * completed work.
 *
 * Every seeded account uses the password `Password@123`. None of this ships in a production build.
 */
import type { Priority, ProjectStatus, Role, TaskStatus } from '@/api/types';
import { todayIso } from '@/lib/dates';
import { POSITION_GAP } from '@/lib/ordering';
import { excerpt, mentionsIn } from '@/lib/richText';
import { DEMO_PASSWORD } from './demoAccounts';
import { hashPassword } from './password';
import { SEED_CRITERIA } from './seedCriteria';
import {
  emptyDb,
  nextId,
  type MockDb,
  type EvidenceRow,
  type NotificationRow,
  type ProjectRow,
  type SubmissionCriterionRow,
  type SubmissionRow,
  type TaskRow,
  type UserRow,
} from './schema';

export { DEMO_PASSWORD };

const USERS: [name: string, email: string, color: string, title: string][] = [
  ['Aarav Sharma', 'aarav@projectflow.dev', '#4f46e5', 'Product Lead'],
  ['Priya Nair', 'priya@projectflow.dev', '#0ea5e9', 'Engineering Manager'],
  ['Rohan Mehta', 'rohan@projectflow.dev', '#f97316', 'Frontend Developer'],
  ['Sneha Iyer', 'sneha@projectflow.dev', '#10b981', 'Backend Developer'],
  ['Kabir Singh', 'kabir@projectflow.dev', '#8b5cf6', 'QA Engineer'],
  ['Ananya Das', 'ananya@projectflow.dev', '#ec4899', 'UI/UX Designer'],
  ['Vikram Rao', 'vikram@projectflow.dev', '#64748b', 'Faculty Mentor'],
];
// ids: 1 Aarav, 2 Priya, 3 Rohan, 4 Sneha, 5 Kabir, 6 Ananya, 7 Vikram

/**
 * Sample estimates (working days). Every sixth task is unestimated.
 * Finished tasks get the estimate their recorded time suggests they had (they took 0.9–1.65× it,
 * about 1.3× on average, a common overrun), so the forecast learns a realistic pace and spread;
 * open tasks use a simple formula.
 */
export function estimateFor(number: number, priority: Priority, created?: number, completed?: number | null): number | null {
  if (number % 6 === 0) return null;
  if (created !== undefined && completed !== null && completed !== undefined) {
    const workingDays = (Math.max(1, completed - (created + 1)) * 5) / 7;
    const overrun = 0.9 + ((number * 7) % 6) * 0.15; // 0.9–1.65×, about 1.3× on average
    return Math.min(10, Math.max(1, Math.round(workingDays / overrun)));
  }
  return 1 + ((number * 3) % 5) + (priority === 'URGENT' || priority === 'HIGH' ? 1 : 0);
}

/** Local date `offset` days from today (yyyy-MM-dd). */
function day(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return todayIso(d);
}

/** Timestamp `offset` days from now at a given local time. */
function at(offset: number, hour = 10, minute = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  d.setHours(hour, minute, 0, 0);
  // Never produce timestamps in the future for past events.
  if (offset <= 0 && d.getTime() > Date.now()) d.setTime(Date.now() - 60_000 * (60 - minute));
  return d.toISOString();
}

interface ProjectSpec {
  key: string;
  name: string;
  description: string;
  color: string;
  status: ProjectStatus;
  start: number;
  deadline: number;
  owner: number;
  members: [userId: number, role: Role][];
  milestones: [name: string, description: string, due: number, completed: boolean][];
  /** [title, status, priority, assignee, due, milestoneIndex, createdOffset, completedOffset, description] */
  tasks: [string, TaskStatus, Priority, number | null, number | null, number | null, number, number | null, string][];
}

const PROJECTS: ProjectSpec[] = [
  {
    key: 'CCP',
    name: 'Campus Connect Portal',
    description:
      'A single web portal where students discover campus events, join clubs and register for activities. Built as the flagship capstone with a Spring Boot API and a React client.',
    color: '#4f46e5',
    status: 'ACTIVE',
    start: -56,
    deadline: 34,
    owner: 1,
    members: [
      [2, 'MANAGER'],
      [3, 'MEMBER'],
      [4, 'MEMBER'],
      [5, 'MEMBER'],
      [6, 'MEMBER'],
      [7, 'VIEWER'],
    ],
    milestones: [
      ['Design & architecture', 'Personas, design system, database schema and CI.', -28, true],
      ['Core features beta', 'Authentication, events, clubs and registration ready for beta testers.', 6, false],
      ['Public launch', 'Admin analytics, performance work, documentation and deployment.', 34, false],
    ],
    tasks: [
      ['Define user personas and journeys', 'DONE', 'MEDIUM', 6, -45, 0, -55, -46, 'Interview 10 students and 2 club leads. Produce 3 personas and the key journeys: discover an event, join a club, register for an activity.'],
      ['Design system: colours, type and components', 'DONE', 'HIGH', 6, -35, 0, -50, -36, 'Create the Figma component library (buttons, inputs, cards, badges) with light and dark themes.'],
      ['Database schema and ER diagram', 'DONE', 'HIGH', 4, -30, 0, -50, -31, 'Model users, events, clubs, memberships and registrations. Include indexes and foreign keys.'],
      ['Set up Spring Boot project and CI pipeline', 'DONE', 'HIGH', 4, -32, 0, -49, -33, 'Spring Boot 3, Flyway, MySQL, GitHub Actions build with tests on every pull request.'],
      ['JWT authentication (login and register)', 'DONE', 'URGENT', 4, -20, 1, -40, -18, 'BCrypt password hashing, stateless JWT, refresh on app load, 401 handling on the client.'],
      ['Student profile page', 'DONE', 'MEDIUM', 3, -12, 1, -30, -10, 'Profile with avatar, department, year and joined clubs. Editable by the student.'],
      ['Event listing with search and filters', 'DONE', 'MEDIUM', 3, -8, 1, -28, -7, 'Paginated list with text search, category and date filters. Empty and loading states.'],
      ['Club directory API', 'IN_REVIEW', 'MEDIUM', 4, 2, 1, -20, null, 'REST endpoints for listing, searching and viewing clubs, with pagination and validation.'],
      ['Event registration flow', 'IN_PROGRESS', 'HIGH', 3, 4, 1, -18, null, 'Register / cancel registration, capacity limits, waitlist and confirmation e-mail.'],
      ['Notification service (email and in-app)', 'IN_PROGRESS', 'HIGH', 4, -2, 1, -16, null, 'Send reminders 24h before events. In-app notifications stored in the database.'],
      ['Accessibility audit of core screens', 'TODO', 'MEDIUM', 5, 6, 1, -10, null, 'Check keyboard navigation, focus order, colour contrast and screen-reader labels (WCAG 2.1 AA).'],
      ['End-to-end tests for auth and events', 'IN_PROGRESS', 'MEDIUM', 5, 8, 1, -9, null, 'Playwright tests for sign-up, login, browsing and registering for an event.'],
      ['Admin dashboard wireframes', 'IN_REVIEW', 'LOW', 6, 5, 2, -6, null, 'Low-fidelity wireframes for the admin analytics dashboard.'],
      ['Admin analytics dashboard', 'TODO', 'HIGH', 3, 20, 2, -5, null, 'Charts for registrations over time, popular events and club growth.'],
      ['Load testing and performance tuning', 'TODO', 'MEDIUM', 5, 26, 2, -4, null, 'JMeter test at 500 concurrent users; add caching where p95 > 300ms.'],
      ['Deployment runbook', 'TODO', 'LOW', null, 30, 2, -3, null, 'Step-by-step guide for deploying the API and client, with rollback steps.'],
      ['Fix timetable time-zone bug', 'TODO', 'URGENT', 3, -1, null, -3, null, 'Events created after 18:30 IST show on the next day. Store instants in UTC and format on the client.'],
      ['Write the user guide', 'TODO', 'LOW', 6, 32, 2, -1, null, 'Illustrated guide for students and club admins.'],
    ],
  },
  {
    key: 'MBA',
    name: 'Mobile Banking App Revamp',
    description:
      'Redesign of the retail banking app: faster onboarding, biometric login, bill payments and spending insights.',
    color: '#0ea5e9',
    status: 'ACTIVE',
    start: -40,
    deadline: 12,
    owner: 2,
    members: [
      [1, 'MANAGER'],
      [3, 'MEMBER'],
      [4, 'MEMBER'],
      [5, 'MEMBER'],
    ],
    milestones: [
      ['Research and UX', 'Competitor analysis and usability interviews.', -20, true],
      ['MVP release', 'Onboarding, biometric login, payments and insights in the app stores.', 12, false],
    ],
    tasks: [
      ['Competitor research', 'DONE', 'LOW', 1, -28, 0, -39, -25, 'Compare onboarding and payments in 5 leading banking apps.'],
      ['Usability interviews (8 users)', 'DONE', 'MEDIUM', 1, -22, 0, -38, -22, 'Recruit 8 existing customers; record pain points with the current app.'],
      ['New onboarding flow UI', 'DONE', 'HIGH', 3, -12, 1, -30, -12, 'Three-step onboarding with KYC document capture.'],
      ['Biometric login', 'IN_PROGRESS', 'URGENT', 4, -4, 1, -25, null, 'Face ID / fingerprint with PIN fallback. Store keys in the secure enclave.'],
      ['Transaction history redesign', 'IN_PROGRESS', 'HIGH', 3, -1, 1, -22, null, 'Grouped by day, with merchant logos and filters.'],
      ['Bill payments module', 'TODO', 'HIGH', 4, 5, 1, -20, null, 'Electricity, water, mobile and credit-card bills.'],
      ['Spending insights charts', 'TODO', 'MEDIUM', 3, 8, 1, -18, null, 'Monthly category breakdown and budget alerts.'],
      ['Security penetration test', 'TODO', 'URGENT', 5, 10, 1, -15, null, 'OWASP Mobile Top 10 review before release.'],
      ['Regression test suite', 'IN_REVIEW', 'MEDIUM', 5, 3, 1, -14, null, 'Automated regression suite for login, transfers and payments.'],
      ['App store assets', 'TODO', 'LOW', null, 11, 1, -10, null, 'Screenshots, preview video and release notes.'],
      ['Push notification preferences', 'TODO', 'MEDIUM', null, -3, 1, -12, null, 'Let users choose which alerts they receive.'],
      ['Offline mode for balances', 'TODO', 'LOW', 4, 12, 1, -8, null, 'Cache the last known balance for offline viewing.'],
    ],
  },
  {
    key: 'LMS',
    name: 'Library Management System',
    description: 'Catalogue, issue/return and fine management for the department library. Delivered last semester.',
    color: '#10b981',
    status: 'COMPLETED',
    start: -120,
    deadline: -20,
    owner: 4,
    members: [
      [5, 'MANAGER'],
      [1, 'MEMBER'],
      [3, 'MEMBER'],
    ],
    milestones: [['Release 1.0', 'Library staff trained and system in production.', -20, true]],
    tasks: [
      ['Book catalogue CRUD', 'DONE', 'HIGH', 1, -80, 0, -115, -82, 'Add, edit and search books by title, author and ISBN.'],
      ['Issue and return workflow', 'DONE', 'HIGH', 3, -60, 0, -100, -58, 'Issue books to members, track due dates and returns.'],
      ['Fine calculation', 'DONE', 'MEDIUM', 1, -45, 0, -90, -44, 'Daily fine after the due date with a configurable rate.'],
      ['Member management', 'DONE', 'MEDIUM', 3, -40, 0, -85, -41, 'Register students and staff as library members.'],
      ['Reports for librarians', 'DONE', 'LOW', 1, -30, 0, -60, -32, 'Most borrowed books and overdue report as PDF.'],
      ['Staff training session', 'DONE', 'LOW', 4, -21, 0, -40, -22, 'Walk-through for library staff with a printed quick guide.'],
    ],
  },
  {
    key: 'ASP',
    name: 'AI Study Planner',
    description: 'Generates a personalised weekly study plan from a student’s timetable, deadlines and goals.',
    color: '#f59e0b',
    status: 'ACTIVE',
    start: -10,
    deadline: 60,
    owner: 3,
    members: [
      [6, 'MANAGER'],
      [1, 'MEMBER'],
    ],
    milestones: [
      ['Clickable prototype', 'Figma prototype tested with 5 students.', 14, false],
      ['Pilot with 20 students', 'Two-week pilot with feedback survey.', 45, false],
    ],
    tasks: [
      ['Problem statement and survey', 'DONE', 'MEDIUM', 1, -4, 0, -9, -3, 'Survey 40 students about how they plan study time.'],
      ['Planner algorithm spike', 'IN_REVIEW', 'HIGH', 1, 2, 0, -8, null, 'Prototype a greedy scheduler that fits study blocks around classes.'],
      ['Timetable import (CSV and ICS)', 'IN_PROGRESS', 'MEDIUM', 1, 7, 0, -7, null, 'Import a class timetable from CSV or an .ics calendar file.'],
      ['Prototype screens', 'IN_PROGRESS', 'HIGH', 3, 12, 0, -6, null, 'Onboarding, weekly plan and progress screens in Figma.'],
      ['Usability test plan', 'TODO', 'LOW', 6, 13, 0, -5, null, 'Tasks, script and consent form for prototype testing.'],
      ['Pilot recruitment', 'TODO', 'MEDIUM', null, 30, 1, -2, null, 'Recruit 20 students across 3 departments.'],
    ],
  },
  {
    key: 'HAC',
    name: 'Hackathon 2026 Website',
    description: 'Landing page, registration and schedule for the inter-college hackathon.',
    color: '#ec4899',
    status: 'ACTIVE',
    start: -3,
    deadline: 25,
    owner: 5,
    members: [[6, 'MEMBER']],
    milestones: [['Registrations open', 'Website live with the registration form.', 10, false]],
    tasks: [
      ['Landing page design', 'IN_PROGRESS', 'HIGH', 6, 5, 0, -3, null, 'Hero, themes, prizes, sponsors and FAQ sections.'],
      ['Team registration form', 'TODO', 'HIGH', 5, 9, 0, -2, null, 'Team name, members, college and track selection.'],
      ['Schedule page', 'TODO', 'MEDIUM', null, 15, null, -1, null, 'Day-by-day schedule with venue details.'],
    ],
  },
  {
    key: 'ONB',
    name: 'Launch the mobile onboarding update',
    description: 'A shorter, friendlier first run for the mobile app: three welcome screens, passkey sign-in and a well-timed notification prompt. The same project as the front page’s sample.',
    color: '#245b78',
    status: 'ACTIVE',
    start: -28,
    deadline: 20,
    owner: 1,
    members: [
      [2, 'MANAGER'],
      [3, 'MEMBER'],
      [4, 'MEMBER'],
      [5, 'MEMBER'],
      [6, 'MEMBER'],
      [7, 'VIEWER'],
    ],
    milestones: [
      ['Research and design', 'Goals, user research, the funnel and signed-off designs.', -8, true],
      ['Beta build', 'Welcome screens, passkey sign-in and analytics, behind a flag.', 9, false],
      ['Launch', 'Beta test, staged rollout and launch material.', 20, false],
    ],
    tasks: [
      ['Agree goals and success measures', 'DONE', 'HIGH', 1, -25, 0, -28, -25, 'What the new first run must change, and how we’ll know it worked.'],
      ['Interview eight new users about sign-up', 'DONE', 'HIGH', 6, -20, 0, -27, -20, 'Short calls with people who signed up in the last month.'],
      ['Map where people drop out of today’s onboarding', 'DONE', 'HIGH', 1, -18, 0, -27, -18, 'Funnel from install to first project, from last quarter’s analytics.'],
      ['Audit the current sign-up screens', 'DONE', 'MEDIUM', 5, -19, 0, -26, -20, 'Accessibility and error states of the screens we’re replacing.'],
      ['Design the three welcome screens', 'DONE', 'HIGH', 6, -9, 0, -22, -8, 'Welcome, what you can do, and sign in. One round of changes after review: bigger touch targets.'],
      ['Choose the passkey library', 'DONE', 'MEDIUM', 4, -15, 0, -21, -15, 'Compare two libraries for passkey sign-in on the server.'],
      ['Write the welcome copy', 'IN_REVIEW', 'MEDIUM', 1, -1, 1, -20, null, 'Headlines and one line of body text for each welcome screen.'],
      ['Build the welcome screens for iOS and Android', 'IN_PROGRESS', 'URGENT', 3, 4, 1, -18, null, 'The three screens from the signed-off designs, behind a feature flag.'],
      ['Passkey sign-in: server API', 'IN_PROGRESS', 'URGENT', 4, -2, 1, -18, null, 'Registration and sign-in endpoints for passkeys, with a password fallback.'],
      ['Connect passkey sign-in to the app', 'TODO', 'HIGH', 3, 8, 1, -14, null, 'Use the new endpoints from the sign-in welcome screen.'],
      ['Ask for notification permission at the right moment', 'TODO', 'MEDIUM', 3, 10, 1, -12, null, 'After the first project is created, not on first launch.'],
      ['Track onboarding events in analytics', 'IN_PROGRESS', 'MEDIUM', 4, 7, 1, -10, null, 'One event per welcome screen and for finishing onboarding.'],
      ['Accessibility check of the new flow', 'TODO', 'HIGH', 5, 11, 1, -9, null, 'Screen readers, text size and contrast on both platforms.'],
      ['Beta test with 50 new users', 'TODO', 'HIGH', 2, 15, 2, -8, null, 'Turn on the flag for 50 new sign-ups and watch completion.'],
      ['Staged rollout plan', 'IN_PROGRESS', 'MEDIUM', 2, 12, 2, -6, null, '10%, 50%, then everyone, with a rollback plan.'],
      ['App Store screenshots and release notes', 'TODO', 'LOW', null, 17, 2, -4, null, 'New screenshots showing the welcome screens.'],
      ['Help article for the new sign-in', 'TODO', 'LOW', null, 18, 2, -3, null, 'How to sign in with a passkey, and what to do without one.'],
    ],
  },
];

/** Who reviews an assignee's work in a project: first manager/owner who isn't the assignee. */
function reviewerFor(p: ProjectSpec, assignee: number): number {
  const managers = p.members.filter(([, r]) => r === 'MANAGER').map(([u]) => u);
  return [...managers, p.owner].find((u) => u !== assignee) ?? p.owner;
}

/** Who created a task: alternate between the owner and a manager. */
function reporterFor(p: ProjectSpec, index: number): number {
  const manager = p.members.find(([, r]) => r === 'MANAGER')?.[0];
  return manager && index % 2 === 1 ? manager : p.owner;
}

const COMMENTS: [projectKey: string, taskNumber: number, authorId: number, offset: number, body: string][] = [
  ['CCP', 9, 3, -4, 'Waitlist logic is in. I still need to handle the case where someone cancels and the first waitlisted student is auto-promoted.'],
  ['CCP', 9, 2, -3, 'Nice. Please make sure the promotion sends the confirmation e-mail too.'],
  ['CCP', 9, 1, -1, 'Can we demo registration at Friday’s review? Even a partial flow is fine.'],
  ['CCP', 10, 4, -3, 'Blocked on SMTP credentials from the IT office. Using a fake SMTP server locally for now.'],
  ['CCP', 10, 2, -2, 'I’ve chased IT; they promised the credentials by Monday.'],
  ['CCP', 8, 4, -1, 'Submitted. Pagination defaults to 20 items and search covers name and category.'],
  ['CCP', 17, 1, -2, 'This is visible to users in the timetable — please prioritise.'],
  ['MBA', 4, 4, -5, 'Android fingerprint works. iOS Face ID needs the NSFaceIDUsageDescription entry.'],
  ['MBA', 4, 2, -2, 'We are 4 days past due on this. What do you need to finish?'],
  ['MBA', 5, 3, -2, 'Merchant logos are in; filters are half done.'],
  ['ASP', 2, 6, -1, 'Looks promising. I’ll review the spike tomorrow morning.'],
  ['ASP', 3, 1, -2, 'CSV import done. Working on parsing RRULEs from .ics files.'],
  // The onboarding project's comments link tasks by key and mention people, as people write them.
  ['ONB', 9, 4, -1, 'Two endpoints left, then this goes to review. Errors use `{ code, message }`, the same as the rest of the API.'],
  ['ONB', 10, 3, -1, 'Can’t start until ONB-9 is in review. @Sneha Iyer will a missing passkey get its own error code?'],
  ['ONB', 14, 2, -1, 'Recruiting the 50 testers can start once ONB-10 is in review. @Aarav Sharma can you share last month’s sign-up list?'],
  ['ONB', 17, 6, -2, 'Screenshots for the article will come from ONB-5 once ONB-10 works end to end.'],
];

export async function createSeedDb(): Promise<MockDb> {
  const db = emptyDb();
  const passwordHash = await hashPassword(DEMO_PASSWORD, 'projectflowdemo');

  // Users -------------------------------------------------------------------
  USERS.forEach(([name, email, color, title], i) => {
    const user: UserRow = {
      id: nextId(db, 'users'),
      name,
      email,
      passwordHash,
      avatarColor: color,
      jobTitle: title,
      createdAt: at(-150 + i, 9),
      // Everyone last looked at Today three days ago, so "Since you were last here" has something to show.
      caughtUpAt: at(-3, 18),
    };
    db.users.push(user);
  });
  const userName = (id: number) => db.users.find((u) => u.id === id)!.name;

  const notify = (n: Omit<NotificationRow, 'id'>) => db.notifications.push({ id: nextId(db, 'notifications'), ...n });

  const event = (task: TaskRow, from: TaskStatus | null, to: TaskStatus, at: string) =>
    db.statusEvents.push({ id: nextId(db, 'statusEvents'), projectId: task.projectId, taskId: task.id, from, to, at });

  /** A submission with a snapshot of the task's current acceptance criteria and typed evidence links. */
  const addSubmission = (
    taskId: number,
    version: number,
    submittedById: number,
    notes: string,
    status: SubmissionRow['status'],
    createdAt: string,
    evidence: [EvidenceRow['kind'], string, string][],
  ): SubmissionRow => {
    const sub: SubmissionRow = { id: nextId(db, 'submissions'), taskId, version, submittedById, notes, status, createdAt };
    db.submissions.push(sub);
    for (const c of db.criteria.filter((x) => x.taskId === taskId)) {
      const row: SubmissionCriterionRow = { id: nextId(db, 'submissionCriteria'), submissionId: sub.id, criterionId: c.id, position: c.position, text: c.text };
      db.submissionCriteria.push(row);
    }
    evidence.forEach(([kind, label, url], position) =>
      db.evidence.push({ id: nextId(db, 'evidence'), submissionId: sub.id, position, kind, label, url, attachmentId: null }),
    );
    return sub;
  };

  /** A review with a verdict per criterion; when not all met, the last criterion is the unmet one. */
  const addReview = (submissionId: number, reviewerId: number, decision: 'APPROVED' | 'CHANGES_REQUESTED', feedback: string | null, createdAt: string, allMet: boolean) => {
    const criteria = db.submissionCriteria.filter((c) => c.submissionId === submissionId).sort((x, y) => x.position - y.position);
    db.reviews.push({
      id: nextId(db, 'reviews'),
      submissionId,
      reviewerId,
      decision,
      feedback,
      createdAt,
      results: criteria.map((c, i) => {
        const met = allMet || i < criteria.length - 1;
        return { submissionCriterionId: c.id, met, note: met ? null : 'Not covered yet — see feedback.' };
      }),
    });
  };
  const activity = (
    projectId: number,
    taskId: number | null,
    actorId: number,
    type: MockDb['activities'][number]['type'],
    message: string,
    createdAt: string,
    change?: { field: string; oldValue: string | null; newValue: string | null },
  ) =>
    db.activities.push({
      id: nextId(db, 'activities'),
      projectId,
      taskId,
      actorId,
      type,
      message,
      field: change?.field ?? null,
      oldValue: change?.oldValue ?? null,
      newValue: change?.newValue ?? null,
      createdAt,
    });

  for (const spec of PROJECTS) {
    // Project and memberships ------------------------------------------------
    const project: ProjectRow = {
      id: nextId(db, 'projects'),
      key: spec.key,
      name: spec.name,
      description: spec.description,
      color: spec.color,
      status: spec.status,
      startDate: day(spec.start),
      deadline: day(spec.deadline),
      ownerId: spec.owner,
      taskSeq: 0,
      createdAt: at(spec.start, 9, 5),
      updatedAt: at(Math.min(spec.start + 5, 0), 11),
      version: 0,
    };
    db.projects.push(project);
    activity(project.id, null, spec.owner, 'PROJECT_CREATED', `created the project`, project.createdAt);
    db.memberships.push({ id: nextId(db, 'memberships'), projectId: project.id, userId: spec.owner, role: 'OWNER', joinedAt: project.createdAt });
    spec.members.forEach(([userId, role], i) => {
      const joinedAt = at(spec.start + 1, 10 + i);
      db.memberships.push({ id: nextId(db, 'memberships'), projectId: project.id, userId, role, joinedAt });
      activity(project.id, null, userId, 'MEMBER_JOINED', `joined the project as ${role.toLowerCase()}`, joinedAt);
    });

    // Milestones -----------------------------------------------------------------
    const milestoneIds = spec.milestones.map(([name, description, due, completed]) => {
      const id = nextId(db, 'milestones');
      const createdAt = at(spec.start + 1, 15);
      db.milestones.push({
        id,
        projectId: project.id,
        name,
        description,
        dueDate: day(due),
        completed,
        completedAt: completed ? at(due - 1, 17) : null,
        createdAt,
      });
      activity(project.id, null, spec.owner, 'MILESTONE_CREATED', `added milestone “${name}”`, createdAt);
      return id;
    });

    // Tasks ------------------------------------------------------------------------
    const positions: Record<TaskStatus, number> = { TODO: 0, IN_PROGRESS: 0, IN_REVIEW: 0, DONE: 0 };
    spec.tasks.forEach(([title, status, priority, assignee, due, ms, created, completed, description], index) => {
      project.taskSeq += 1;
      const reporter = reporterFor(spec, index);
      const createdAt = at(created, 9 + (index % 7), (index * 7) % 60);
      const task: TaskRow = {
        id: nextId(db, 'tasks'),
        projectId: project.id,
        number: project.taskSeq,
        title,
        description,
        status,
        priority,
        assigneeId: assignee,
        reporterId: reporter,
        dueDate: due === null ? null : day(due),
        milestoneId: ms === null ? null : milestoneIds[ms],
        position: ++positions[status] * POSITION_GAP,
        createdAt,
        updatedAt: completed !== null ? at(completed, 16) : at(Math.min(created + 3, 0), 12),
        startedAt: status !== 'TODO' ? at(created + 1, 10) : null,
        completedAt: completed !== null ? at(completed, 16) : null,
        version: 0,
        estimateDays: estimateFor(project.taskSeq, priority, created, completed),
      };
      db.tasks.push(task);
      event(task, null, 'TODO', createdAt);
      if (task.startedAt) event(task, 'TODO', 'IN_PROGRESS', task.startedAt);
      const key = `${spec.key}-${task.number}`;

      // Acceptance criteria and checklist (same content as the backend seeder).
      const extra = SEED_CRITERIA[spec.key]?.[title] ?? { criteria: [], checklist: [] };
      extra.criteria.forEach((text, position) => db.criteria.push({ id: nextId(db, 'criteria'), taskId: task.id, position, text }));
      const allDone = status === 'IN_REVIEW' || status === 'DONE';
      extra.checklist.forEach((text, position) => {
        const done = allDone || position < Math.floor(extra.checklist.length / 2);
        db.checklistItems.push({
          id: nextId(db, 'checklistItems'),
          taskId: task.id,
          position,
          text,
          done,
          doneById: done ? assignee : null,
          doneAt: done ? at(Math.min(created + 2, 0), 14) : null,
        });
      });
      activity(project.id, task.id, reporter, 'TASK_CREATED', `created ${key} “${title}”`, createdAt);

      if (assignee !== null && assignee !== reporter) {
        activity(project.id, task.id, reporter, 'TASK_ASSIGNED', `assigned ${key}`, at(created, 17), { field: 'assignee', oldValue: null, newValue: userName(assignee) });
        if (status !== 'DONE' && created >= -10) {
          notify({
            userId: assignee,
            type: 'TASK_ASSIGNED',
            title: 'New task assigned to you',
            message: `${userName(reporter)} assigned you ${key} “${title}” in ${spec.name}.`,
            link: `/projects/${project.id}/tasks/${task.id}`,
            read: created < -5,
            actorId: reporter,
            invitationId: null,
            createdAt: at(created, 17),
          });
        }
      }
      if (status !== 'TODO' && assignee !== null) {
        activity(project.id, task.id, assignee, 'TASK_STATUS_CHANGED', `moved ${key}`, at(created + 1, 10), { field: 'status', oldValue: 'To do', newValue: 'In progress' });
      }

      // Submissions and reviews -----------------------------------------------------
      if ((status === 'DONE' || status === 'IN_REVIEW') && assignee !== null) {
        const reviewer = reviewerFor(spec, assignee);
        const finalSubmitDay = status === 'DONE' ? completed! - 1 : Math.max(created + 2, -1);
        // A few tasks show a full history: changes requested, then resubmitted.
        const withHistory = (spec.key === 'CCP' && (task.number === 5 || task.number === 13)) || (spec.key === 'MBA' && task.number === 3);
        let version = 0;
        if (withHistory) {
          version += 1;
          const firstAt = at(finalSubmitDay - 3, 14);
          const sub = addSubmission(task.id, version, assignee, 'First version ready for review. The pull request describes the approach; screenshots are in the PR.', 'CHANGES_REQUESTED', firstAt, [
            ['REPOSITORY', 'Pull request', `https://git.${spec.key.toLowerCase()}.sample.example/pull/${10 + task.number}`],
          ]);
          activity(project.id, task.id, assignee, 'SUBMISSION_CREATED', `submitted ${key} for review (v${version})`, firstAt);
          event(task, 'IN_PROGRESS', 'IN_REVIEW', firstAt);
          const reviewedAt = at(finalSubmitDay - 2, 11);
          const feedback =
            task.number === 13
              ? 'Good start. Please add the empty state for “no events yet” and the mobile layout before this can be approved.'
              : 'Works well, but login is not rate limited yet and there are no tests for the expired-token case.';
          // The last criterion is marked not met: the reason changes were requested.
          addReview(sub.id, reviewer, 'CHANGES_REQUESTED', feedback, reviewedAt, false);
          activity(project.id, task.id, reviewer, 'REVIEW_CHANGES_REQUESTED', `requested changes on ${key}`, reviewedAt);
          event(task, 'IN_REVIEW', 'IN_PROGRESS', reviewedAt);
          notify({
            userId: assignee,
            type: 'CHANGES_REQUESTED',
            title: 'Changes requested',
            message: `${userName(reviewer)} requested changes on ${key} “${title}”.`,
            link: `/projects/${project.id}/tasks/${task.id}`,
            read: true,
            actorId: reviewer,
            invitationId: null,
            createdAt: reviewedAt,
          });
        }
        version += 1;
        const submittedAt = at(finalSubmitDay, 15, 30);
        // Sample links use the reserved .example domain (RFC 2606): clearly fictional, never someone's real site.
        const repo = `https://git.${spec.key.toLowerCase()}.sample.example`;
        const evidence: [EvidenceRow['kind'], string, string][] = [['REPOSITORY', 'Pull request', `${repo}/pull/${20 + task.number}`]];
        if (task.number % 2 === 0) {
          evidence.push(['DEPLOYMENT', 'Preview deployment', `https://pr${20 + task.number}.${spec.key.toLowerCase()}.sample.example`]);
        }
        if (task.number % 3 === 0) evidence.push(['LINK', 'Demo recording', 'https://drive.google.com/file/d/demo-recording/view']);
        const submission = addSubmission(
          task.id,
          version,
          assignee,
          version > 1
            ? 'Addressed every review comment: see the updated pull request. The unmet criterion is now covered and tested.'
            : 'Work is complete and tested locally. Evidence linked below; each acceptance criterion is covered in the PR description.',
          status === 'DONE' ? 'APPROVED' : 'PENDING',
          submittedAt,
          evidence,
        );
        activity(project.id, task.id, assignee, 'SUBMISSION_CREATED', `submitted ${key} for review${version > 1 ? ` (v${version})` : ''}`, submittedAt);
        activity(project.id, task.id, assignee, 'TASK_STATUS_CHANGED', `moved ${key}`, submittedAt, { field: 'status', oldValue: 'In progress', newValue: 'In review' });
        event(task, 'IN_PROGRESS', 'IN_REVIEW', submittedAt);

        if (status === 'DONE') {
          const approvedAt = at(completed!, 16);
          addReview(submission.id, reviewer, 'APPROVED', ['Great work — approved.', 'Looks good. Merged.', 'Approved. Thanks for the thorough tests.', null][task.number % 4], approvedAt, true);
          activity(project.id, task.id, reviewer, 'REVIEW_APPROVED', `approved ${key}; task is Done`, approvedAt);
          event(task, 'IN_REVIEW', 'DONE', approvedAt);
          if (completed! >= -14) {
            notify({
              userId: assignee,
              type: 'REVIEW_APPROVED',
              title: 'Submission approved',
              message: `${userName(reviewer)} approved ${key} “${title}”.`,
              link: `/projects/${project.id}/tasks/${task.id}`,
              read: completed! < -4,
              actorId: reviewer,
              invitationId: null,
              createdAt: approvedAt,
            });
          }
        } else {
          // Pending: notify every Manager/Owner who can review (not the submitter).
          const reviewers = [spec.owner, ...spec.members.filter(([, r]) => r === 'MANAGER').map(([u]) => u)].filter((u) => u !== assignee);
          for (const r of reviewers) {
            notify({
              userId: r,
              type: 'SUBMISSION',
              title: 'Work submitted for review',
              message: `${userName(assignee)} submitted ${key} “${title}” for review.`,
              link: `/projects/${project.id}/tasks/${task.id}`,
              read: false,
              actorId: assignee,
              invitationId: null,
              createdAt: submittedAt,
            });
          }
        }
      }
    });
  }

  // Dependencies (blocker → blocked, by task number) — same pairs as the backend seeder.
  const DEPENDENCIES: Record<string, [number, number][]> = {
    CCP: [[3, 5], [4, 5], [5, 9], [7, 9], [9, 12], [10, 12], [10, 14], [13, 14], [12, 15], [15, 16], [14, 18]],
    MBA: [[3, 4], [4, 6], [4, 8], [5, 7], [9, 8]],
    ONB: [[2, 5], [3, 5], [5, 8], [6, 9], [9, 10], [8, 11], [8, 13], [10, 14], [13, 14], [10, 17]],
  };
  for (const [key, pairs] of Object.entries(DEPENDENCIES)) {
    const project = db.projects.find((p) => p.key === key)!;
    const byNumber = (n: number) => db.tasks.find((t) => t.projectId === project.id && t.number === n)!;
    for (const [a, b] of pairs) {
      const blocked = byNumber(b);
      db.dependencies.push({ id: nextId(db, 'dependencies'), projectId: project.id, blockerTaskId: byNumber(a).id, blockedTaskId: blocked.id, createdById: project.ownerId, createdAt: blocked.createdAt });
    }
  }

  // Comments ----------------------------------------------------------------------
  for (const [pKey, num, authorId, offset, body] of COMMENTS) {
    const project = db.projects.find((p) => p.key === pKey)!;
    const task = db.tasks.find((t) => t.projectId === project.id && t.number === num)!;
    const createdAt = at(offset, 11 + (num % 6), (authorId * 11) % 60);
    const commentId = nextId(db, 'comments');
    db.comments.push({ id: commentId, taskId: task.id, authorId, body, createdAt, updatedAt: null });
    activity(project.id, task.id, authorId, 'COMMENT_ADDED', `commented on ${pKey}-${num}`, createdAt);
    const link = `/projects/${project.id}/tasks/${task.id}#comment-${commentId}`;
    // People @mentioned are told they were mentioned (members only), instead of "new comment".
    const people = db.memberships.filter((m) => m.projectId === project.id).map((m) => db.users.find((u) => u.id === m.userId)!);
    const mentioned = mentionsIn(body, people.map((u) => u.name)).map((name) => people.find((u) => u.name === name)!.id);
    for (const userId of mentioned) {
      if (userId === authorId) continue;
      const first = people.find((u) => u.id === userId)!.name.split(' ')[0];
      notify({
        userId,
        type: 'MENTION',
        title: 'Mentioned you',
        message: `${userName(authorId)} mentioned you on ${pKey}-${num}: “${excerpt(body, `@${first}`, 120)}”`,
        link,
        read: offset < -2,
        actorId: authorId,
        invitationId: null,
        createdAt,
      });
    }
    for (const recipient of new Set([task.assigneeId, task.reporterId])) {
      if (recipient && recipient !== authorId && !mentioned.includes(recipient)) {
        notify({
          userId: recipient,
          type: 'COMMENT',
          title: 'New comment',
          message: `${userName(authorId)} commented on ${pKey}-${num}: “${excerpt(body, null, 80)}”`,
          link,
          read: offset < -2,
          actorId: authorId,
          invitationId: null,
          createdAt,
        });
      }
    }
  }

  // Invitations -------------------------------------------------------------------
  const hac = db.projects.find((p) => p.key === 'HAC')!;
  const ccp = db.projects.find((p) => p.key === 'CCP')!;
  const invites: [projectId: number, email: string, role: Role, invitedBy: number, offset: number][] = [
    [hac.id, 'aarav@projectflow.dev', 'MEMBER', 5, -1],
    [hac.id, 'rohan@projectflow.dev', 'VIEWER', 5, -1],
    [ccp.id, 'meera@projectflow.dev', 'MEMBER', 1, -2],
  ];
  for (const [projectId, email, role, invitedById, offset] of invites) {
    const createdAt = at(offset, 18);
    const inv = { id: nextId(db, 'invitations'), projectId, email, role, status: 'PENDING' as const, invitedById, createdAt, respondedAt: null };
    db.invitations.push(inv);
    const project = db.projects.find((p) => p.id === projectId)!;
    activity(projectId, null, invitedById, 'INVITATION_SENT', `invited ${email} as ${role.toLowerCase()}`, createdAt);
    const invitee = db.users.find((u) => u.email === email);
    if (invitee) {
      notify({
        userId: invitee.id,
        type: 'INVITATION',
        title: 'Project invitation',
        message: `${userName(invitedById)} invited you to join “${project.name}” as ${role.toLowerCase()}.`,
        link: '/inbox',
        read: false,
        actorId: invitedById,
        invitationId: inv.id,
        createdAt,
      });
    }
  }

  db.activities.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  db.notifications.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return db;
}
