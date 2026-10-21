/**
 * Row types for the in-browser mock database. They mirror the MySQL tables of
 * the Spring Boot backend (see backend/src/main/resources/db/migration), using
 * foreign-key ids rather than nested objects.
 */
import type {
  ActivityType,
  EvidenceKind,
  InvitationStatus,
  NotificationType,
  Priority,
  ProjectStatus,
  ReviewDecision,
  Role,
  SubmissionStatus,
  TaskStatus,
} from '@/api/types';

export interface UserRow {
  id: number;
  name: string;
  email: string;
  passwordHash: string;
  avatarColor: string;
  jobTitle: string | null;
  createdAt: string;
  /** Which campaign or site brought them (UTM tags), when known. */
  signup?: { source: string; medium: string | null; campaign: string | null } | null;
  /** When they last caught up on Today ("Since you were last here"); absent until their first visit. */
  caughtUpAt?: string | null;
}

export interface ProjectRow {
  id: number;
  key: string;
  name: string;
  description: string | null;
  color: string;
  status: ProjectStatus;
  startDate: string;
  deadline: string | null;
  ownerId: number;
  /** Last task number issued for this project (task keys are KEY-number). */
  taskSeq: number;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface MembershipRow {
  id: number;
  projectId: number;
  userId: number;
  role: Role;
  joinedAt: string;
}

export interface MilestoneRow {
  id: number;
  projectId: number;
  name: string;
  description: string | null;
  dueDate: string;
  completed: boolean;
  completedAt: string | null;
  createdAt: string;
}

export interface TaskRow {
  id: number;
  projectId: number;
  number: number;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: Priority;
  assigneeId: number | null;
  reporterId: number;
  dueDate: string | null;
  milestoneId: number | null;
  position: number;
  createdAt: string;
  updatedAt: string;
  /** First entry into In Progress. */
  startedAt: string | null;
  completedAt: string | null;
  /** Optimistic-locking counter, bumped on every change (like JPA @Version). */
  version: number;
  /** Estimated working days, or null when not estimated. */
  estimateDays: number | null;
}

export interface CriterionRow {
  id: number;
  taskId: number;
  position: number;
  text: string;
}

export interface ChecklistItemRow {
  id: number;
  taskId: number;
  position: number;
  text: string;
  done: boolean;
  doneById: number | null;
  doneAt: string | null;
}

/** One status transition (the backend's task_status_events table), used for flow analytics. */
export interface StatusEventRow {
  id: number;
  projectId: number;
  taskId: number;
  from: TaskStatus | null;
  to: TaskStatus;
  at: string;
}

/** blocker must be done before blocked can finish. */
export interface DependencyRow {
  id: number;
  projectId: number;
  blockerTaskId: number;
  blockedTaskId: number;
  createdById: number;
  createdAt: string;
}

export interface CommentRow {
  id: number;
  taskId: number;
  authorId: number;
  body: string;
  createdAt: string;
  updatedAt: string | null;
}

/** An uploaded evidence file (the backend's stored_files table). */
export interface AttachmentRow {
  id: number;
  submissionId: number;
  fileName: string;
  size: number;
  contentType: string;
  /** Small files are kept as data URLs so they can be downloaded from the test API. */
  dataUrl: string | null;
}

export interface SubmissionRow {
  id: number;
  taskId: number;
  version: number;
  submittedById: number;
  notes: string;
  status: SubmissionStatus;
  createdAt: string;
}

/** Snapshot of an acceptance criterion at submission time. */
export interface SubmissionCriterionRow {
  id: number;
  submissionId: number;
  criterionId: number | null;
  position: number;
  text: string;
}

export interface EvidenceRow {
  id: number;
  submissionId: number;
  position: number;
  kind: EvidenceKind;
  label: string;
  url: string | null;
  attachmentId: number | null;
}

export interface ReviewRow {
  id: number;
  submissionId: number;
  reviewerId: number;
  decision: ReviewDecision;
  feedback: string | null;
  createdAt: string;
  results: { submissionCriterionId: number; met: boolean; note: string | null }[];
}

export interface InvitationRow {
  id: number;
  projectId: number;
  email: string;
  role: Role;
  status: InvitationStatus;
  invitedById: number;
  createdAt: string;
  respondedAt: string | null;
}

export interface NotificationRow {
  id: number;
  userId: number;
  type: NotificationType;
  title: string;
  message: string;
  link: string | null;
  read: boolean;
  actorId: number | null;
  invitationId: number | null;
  createdAt: string;
}

export interface ActivityRow {
  id: number;
  projectId: number;
  taskId: number | null;
  actorId: number;
  type: ActivityType;
  message: string;
  /** Structured change for field updates (e.g. status, priority), else null. */
  field: string | null;
  oldValue: string | null;
  newValue: string | null;
  createdAt: string;
}

export interface MockDb {
  schemaVersion: number;
  seq: Record<TableName, number>;
  users: UserRow[];
  projects: ProjectRow[];
  memberships: MembershipRow[];
  milestones: MilestoneRow[];
  tasks: TaskRow[];
  criteria: CriterionRow[];
  checklistItems: ChecklistItemRow[];
  dependencies: DependencyRow[];
  statusEvents: StatusEventRow[];
  comments: CommentRow[];
  submissions: SubmissionRow[];
  submissionCriteria: SubmissionCriterionRow[];
  evidence: EvidenceRow[];
  attachments: AttachmentRow[];
  reviews: ReviewRow[];
  invitations: InvitationRow[];
  notifications: NotificationRow[];
  activities: ActivityRow[];
  /** The site's own records (contact messages, form counts, Arena votes); created on first use. */
  site?: SiteTables;
  /** Sign-ins (server-side sessions in the real backend); created on first use. */
  sessions?: SessionRow[];
  /** The audit log of sensitive operations; created on first use. */
  audit?: AuditRow[];
  /** Project documents, with their passages (as the server splits them). */
  documents?: {
    id: number;
    projectId: number;
    title: string;
    body: string;
    status: 'DRAFT' | 'APPROVED';
    createdBy: number;
    createdAt: string;
    updatedBy: number;
    updatedAt: string;
    approvedBy: number | null;
    approvedAt: string | null;
    version: number;
    passages: { id: number; ordinal: number; heading: string | null; content: string }[];
  }[];
  /** The blocker journey's counts: the step and kinds only, as the server keeps them. */
  journey?: { projectId: number; step: string; blockerKind: string | null; option: string | null; createdAt: string }[];
  /** Corrections to Flurry's answers (kept 180 days by the real API). */
  aiFeedback?: {
    id: number;
    projectId: number;
    /** Null once the person who rated it deleted their account. */
    userId: number | null;
    verdict: 'right' | 'wrong';
    categories: string[];
    correction: string | null;
    question: string;
    answer: string;
    model: string | null;
    lookups: string | null;
    createdAt: string;
  }[];
}

export interface SessionRow {
  id: number;
  sid: string;
  userId: number;
  remember: boolean;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  revokedAt: string | null;
  device: string | null;
  /** "Keep me signed in": the secret in this session's cookie (the real API stores only its hash). */
  cookie?: string | null;
}

export interface AuditRow {
  id: number;
  at: string;
  actorId: number | null;
  projectId: number | null;
  action: string;
  target: string | null;
  outcome: 'ok' | 'denied' | 'failed';
  detail: string | null;
}

export interface ContactRow {
  id: number;
  name: string;
  email: string;
  topic: string;
  message: string;
  reference: string | null;
  page: string | null;
  source: string | null;
  createdAt: string;
  handledAt: string | null;
}

export interface ArenaVoteRow {
  id: number;
  userId: number;
  projectId: number;
  a: string;
  b: string;
  winner: 'A' | 'B' | 'TIE' | 'NEITHER';
  createdAt: string;
}

export interface SiteTables {
  contact: ContactRow[];
  /** "yyyy-mm-dd|form.<form>.<event>" → count. */
  formCounts: Record<string, number>;
  arenaVotes: ArenaVoteRow[];
  seq: { contact: number; arena: number };
}

export type TableName = Exclude<keyof MockDb, 'schemaVersion' | 'seq'>;

export const TABLES: TableName[] = [
  'users',
  'projects',
  'memberships',
  'milestones',
  'tasks',
  'criteria',
  'checklistItems',
  'dependencies',
  'statusEvents',
  'comments',
  'submissions',
  'submissionCriteria',
  'evidence',
  'attachments',
  'reviews',
  'invitations',
  'notifications',
  'activities',
];

/** Bump when the stored shape changes; older browser data is re-seeded. */
export const SCHEMA_VERSION = 7;

export function emptyDb(): MockDb {
  const seq = Object.fromEntries(TABLES.map((t) => [t, 0])) as Record<TableName, number>;
  return {
    schemaVersion: SCHEMA_VERSION,
    seq,
    users: [],
    projects: [],
    memberships: [],
    milestones: [],
    tasks: [],
    criteria: [],
    checklistItems: [],
    dependencies: [],
    statusEvents: [],
    comments: [],
    submissions: [],
    submissionCriteria: [],
    evidence: [],
    attachments: [],
    reviews: [],
    invitations: [],
    notifications: [],
    activities: [],
  };
}

export function nextId(db: MockDb, table: TableName): number {
  db.seq[table] += 1;
  return db.seq[table];
}
