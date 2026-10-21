/**
 * In-browser stand-in for the Niveloft REST API, for the automated tests and the UI test harness.
 *
 * It implements the same endpoints, validation, permission checks, status
 * codes and response envelopes as the Spring Boot backend, persisting data to
 * localStorage. Turned on only with VITE_TEST_API=browser; production builds leave it out.
 */
import type {
  ActivityType,
  ApiErrorBody,
  CatchUp,
  ApiErrorCode,
  AuthResponse,
  CalendarEvent,
  DashboardData,
  EvidenceKind,
  InvitationStatus,
  NotificationCategory,
  NotificationType,
  Page,
  Priority,
  ProjectStatus,
  ReviewDecision,
  Role,
  SearchResult,
  TaskMention,
  TaskStatus,
  UpcomingItem,
} from '@/api/types';
import { PALETTE, PRIORITY_LABEL, PRIORITY_RANK, ROLE_LABEL, STATUS_LABEL, TASK_STATUSES } from '@/lib/constants';
import { todayIso } from '@/lib/dates';
import { placeBetween } from '@/lib/ordering';
import { atLeast, can, statusChangeBlockedReason } from '@/lib/permissions';
import { excerpt, mentionsIn, taskKeysIn } from '@/lib/richText';
import { splitDocument } from '@/lib/documentText';
import { addDays, startOfWeek } from 'date-fns';
import { computeAttention, rank } from './attention';
import { hashPassword, verifyPassword } from './password';
import { commonPasswordProblem } from './commonPasswords';
import { nextId, type ActivityRow, type AuditRow, type MockDb, type NotificationRow, type ProjectRow, type SessionRow, type TaskRow, type UserRow } from './schema';
import { getDb, saveDb } from './store';
import { taskHistoryCsv } from './taskHistory';
import {
  activityDto,
  commentDto,
  completionTrend,
  dependencyDto,
  invitationDto,
  isOverdue,
  membersOf,
  milestoneDto,
  notificationDto,
  projectAnalytics,
  projectDetail,
  projectSummary,
  roleOf,
  submissionDto,
  taskDto,
  userDto,
  userSummary,
  MOCK_OPERATORS,
} from './views';

// ---------------------------------------------------------------------------
// Infrastructure
// ---------------------------------------------------------------------------

export interface MockRequest {
  method: string;
  url: string;
  body?: unknown;
  token?: string | null;
}

export interface MockResponse {
  status: number;
  body: unknown;
}

const DEFAULT_CODE: Record<number, ApiErrorCode> = {
  400: 'VALIDATION_FAILED',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  500: 'INTERNAL_ERROR',
};

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public fieldErrors?: Record<string, string>,
    public code: ApiErrorCode = DEFAULT_CODE[status] ?? 'INTERNAL_ERROR',
  ) {
    super(message);
  }
}

const REASON: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  500: 'Internal Server Error',
  503: 'Service Unavailable',
};

interface Ctx {
  db: MockDb;
  me: UserRow;
  /** The request's session ("sid" of its token). */
  sid: string;
  params: Record<string, string>;
  query: URLSearchParams;
  body: Record<string, unknown>;
  rawBody: unknown;
}

interface Result {
  data: unknown;
  status?: number;
  message?: string;
}

type Handler = (ctx: Ctx) => Result | Promise<Result>;

interface Route {
  method: string;
  segments: string[];
  handler: Handler;
  auth: boolean;
}

const routes: Route[] = [];

function route(method: string, pattern: string, handler: Handler, auth = true) {
  routes.push({ method, segments: pattern.split('/').filter(Boolean), handler, auth });
}

function match(r: Route, method: string, parts: string[]): Record<string, string> | null {
  if (r.method !== method || r.segments.length !== parts.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < parts.length; i++) {
    const seg = r.segments[i];
    if (seg.startsWith(':')) params[seg.slice(1)] = decodeURIComponent(parts[i]);
    else if (seg !== parts[i]) return null;
  }
  return params;
}

const ok = (data: unknown, message?: string): Result => ({ data, message });
const created = (data: unknown, message?: string): Result => ({ data, status: 201, message });

/** Session rules, as the server's defaults: 12 hours idle, 24 at most; 14 days when kept signed in. */
const SESSION = { idleMs: 12 * 3600_000, maxMs: 24 * 3600_000, rememberDays: 14 };

function deviceName(): string {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'A browser';
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS X/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'an unknown system';
  return `${browser} on ${os} (in-browser test API)`;
}

const randomHex = (bytes: number) => Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, '0')).join('');

/**
 * The browser's cookie jar, for the HttpOnly "keep me signed in" cookie the real API sets: kept here
 * by the test API alone (the app never reads it, as page scripts can't read the real one).
 */
export const TEST_API_COOKIE_KEY = 'projectflow.test-api.cookie';
let jarInMemory: string | null = null;

function jar(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** Set-Cookie: the kept sign-in's cookie, or null to remove it. */
function setCookie(value: string | null): void {
  jarInMemory = value;
  const s = jar();
  if (!s) return;
  if (value) s.setItem(TEST_API_COOKIE_KEY, value);
  else s.removeItem(TEST_API_COOKIE_KEY);
}

function readCookie(): string | null {
  const s = jar();
  return s ? s.getItem(TEST_API_COOKIE_KEY) : jarInMemory;
}

/**
 * For a test server that serves this API over HTTP with a real cookie (Node, no localStorage): the
 * cookie that came with the request goes in before handling it, and what the API set comes out.
 */
export const testApiCookie = {
  set: (value: string | null) => setCookie(value),
  get: () => readCookie(),
};

/** A token for a session: until the session ends, or for 24 hours at most (JWT_EXPIRATION_SECONDS). */
function tokenFor(s: SessionRow): { token: string; expiresIn: number } {
  const at = Date.now();
  const exp = Math.min(Date.parse(s.expiresAt), at + SESSION.maxMs);
  const payload = btoa(JSON.stringify({ sub: s.userId, sid: s.sid, exp: Math.floor(exp / 1000) }));
  return { token: `mock.${payload}.signature`, expiresIn: Math.max(1, Math.floor((exp - at) / 1000)) };
}

/**
 * Opens a session (one row per sign-in) and returns its token, which names the session. A kept
 * sign-in also gets its cookie ("sid.secret"), which the caller sets.
 */
function openSession(db: MockDb, userId: number, remember: boolean): { token: string; expiresIn: number; cookie: string | null } {
  const sessions = (db.sessions ??= []);
  const at = Date.now();
  const expires = at + (remember ? SESSION.rememberDays * 86_400_000 : SESSION.maxMs);
  const row: SessionRow = {
    id: (sessions.at(-1)?.id ?? 0) + 1,
    sid: randomHex(16),
    userId,
    remember,
    createdAt: new Date(at).toISOString(),
    lastSeenAt: new Date(at).toISOString(),
    expiresAt: new Date(expires).toISOString(),
    revokedAt: null,
    device: deviceName(),
    cookie: remember ? randomHex(32) : null,
  };
  sessions.push(row);
  return { ...tokenFor(row), cookie: row.cookie ? `${row.sid}.${row.cookie}` : null };
}

function readToken(token: string | null | undefined): { sub: number; sid: string } | null {
  if (!token) return null;
  const [, payload] = token.split('.');
  try {
    const { sub, sid, exp } = JSON.parse(atob(payload)) as { sub: number; sid?: string; exp: number };
    return exp * 1000 > Date.now() && typeof sid === 'string' ? { sub, sid } : null;
  } catch {
    return null;
  }
}

type SessionState = 'ACTIVE' | 'REVOKED' | 'IDLE' | 'EXPIRED';

function sessionState(s: SessionRow, at = Date.now()): SessionState {
  if (s.revokedAt) return 'REVOKED';
  if (at >= Date.parse(s.expiresAt)) return 'EXPIRED';
  if (!s.remember && at >= Date.parse(s.lastSeenAt) + SESSION.idleMs) return 'IDLE';
  return 'ACTIVE';
}

const ENDED: Record<SessionState, string> = {
  ACTIVE: '',
  REVOKED: 'You were signed out (from this device or another one, or by a password change). Please sign in again.',
  IDLE: 'You were signed out after a period without activity. Please sign in again.',
  EXPIRED: 'Your session has expired. Please sign in again.',
};

/** Records a sensitive operation (the real backend's audit log). */
function audit(db: MockDb, actorId: number | null, projectId: number | null, action: string, target: string | null, outcome: AuditRow['outcome'], detail: string | null = null) {
  const rows = (db.audit ??= []);
  rows.push({ id: (rows.at(-1)?.id ?? 0) + 1, at: now(), actorId, projectId, action, target, outcome, detail });
}

function now(): string {
  return new Date().toISOString();
}

export async function handleMockRequest(req: MockRequest): Promise<MockResponse> {
  const url = new URL(req.url, 'http://mock.local');
  const path = url.pathname.replace(/^\/api/, '');
  const parts = path.split('/').filter(Boolean);
  const method = req.method.toUpperCase();

  const errorBody = (status: number, message: string, fieldErrors?: Record<string, string>, code?: ApiErrorCode): MockResponse => {
    const body: ApiErrorBody = {
      success: false,
      status,
      code: code ?? DEFAULT_CODE[status] ?? 'INTERNAL_ERROR',
      error: REASON[status] ?? 'Error',
      message,
      fieldErrors: fieldErrors ?? null,
      path: `/api${path}`,
      timestamp: now(),
    };
    return { status, body };
  };

  let found: { route: Route; params: Record<string, string> } | null = null;
  for (const r of routes) {
    const params = match(r, method, parts);
    if (params) {
      found = { route: r, params };
      break;
    }
  }
  if (!found) return errorBody(404, `No endpoint ${method} /api${path}`);

  const db = await getDb();
  let me: UserRow | undefined;
  const claims = readToken(req.token);
  if (found.route.auth) {
    const session = claims ? db.sessions?.find((x) => x.sid === claims.sid && x.userId === claims.sub) : undefined;
    const state = session ? sessionState(session) : 'EXPIRED';
    me = state === 'ACTIVE' ? db.users.find((u) => u.id === claims!.sub) : undefined;
    if (!me) return errorBody(401, ENDED[state] || ENDED.EXPIRED);
    session!.lastSeenAt = now();
  }

  const rawBody = req.body;
  const body = rawBody && typeof rawBody === 'object' && !(rawBody instanceof FormData) ? (rawBody as Record<string, unknown>) : {};

  try {
    const result = await found.route.handler({ db, me: me as UserRow, sid: claims?.sid ?? '', params: found.params, query: url.searchParams, body, rawBody });
    if (method !== 'GET') saveDb();
    return {
      status: result.status ?? 200,
      body: { success: true, message: result.message ?? null, data: result.data ?? null, timestamp: now() },
    };
  } catch (e) {
    if (e instanceof HttpError) return errorBody(e.status, e.message, e.fieldErrors, e.code);
    console.error('[mock api]', e);
    return errorBody(500, 'Something went wrong on the server. Please try again.');
  }
}

// ---------------------------------------------------------------------------
// Validation helpers (mirror Bean Validation annotations on the backend DTOs)
// ---------------------------------------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}
function optStr(v: unknown): string | null {
  const s = str(v);
  return s === '' ? null : s;
}
function optNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function check(errors: Record<string, string | false | null | undefined>) {
  const fieldErrors = Object.fromEntries(Object.entries(errors).filter(([, v]) => typeof v === 'string')) as Record<string, string>;
  if (Object.keys(fieldErrors).length > 0) throw new HttpError(400, 'Please correct the highlighted fields.', fieldErrors);
}

function length(value: string, field: string, min: number, max: number, required = true): string | null {
  if (!value) return required ? `${field} is required.` : null;
  if (value.length < min) return `${field} must be at least ${min} characters.`;
  if (value.length > max) return `${field} must be at most ${max} characters.`;
  return null;
}

function validDate(value: string | null, field: string, required: boolean): string | null {
  if (!value) return required ? `${field} is required.` : null;
  if (!DATE_RE.test(value) || Number.isNaN(Date.parse(value))) return `${field} must be a valid date.`;
  return null;
}

function passwordProblem(pw: string, email = '', name = ''): string | null {
  if (!pw) return 'Password is required.';
  if (pw.length < 8) return 'Password must be at least 8 characters.';
  if (pw.length > 72) return 'Password must be at most 72 characters.';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'Password must contain at least one letter and one number.';
  if (new TextEncoder().encode(pw).length > 72) return 'Password is too long: at most 72 bytes (fewer characters if it has accents or emoji).';
  return commonPasswordProblem(pw, email, name);
}

/** Optional list of non-blank strings (acceptance criteria, checklist items on create). */
function stringList(v: unknown, field: string, label: string, maxItems: number, maxLength: number): string[] {
  if (v === undefined || v === null) return [];
  const items = Array.isArray(v) ? v.map((x) => str(x)) : [];
  check({
    [field]: !Array.isArray(v)
      ? `${label}s must be a list.`
      : items.length > maxItems
        ? `Add at most ${maxItems} items.`
        : items.some((x) => !x)
          ? `${label} text is required.`
          : items.some((x) => x.length > maxLength)
            ? `Each item must be at most ${maxLength} characters.`
            : null,
  });
  return items;
}

const oneOf = <T extends string>(v: unknown, values: readonly T[]): v is T => typeof v === 'string' && (values as readonly string[]).includes(v);

// ---------------------------------------------------------------------------
// Domain helpers
// ---------------------------------------------------------------------------

function paginate<T>(items: T[], query: URLSearchParams, defaultSize = 20): Page<T> {
  const size = Math.min(Math.max(Number(query.get('size')) || defaultSize, 1), 500);
  const totalPages = Math.max(1, Math.ceil(items.length / size));
  const page = Math.min(Math.max(Number(query.get('page')) || 0, 0), totalPages - 1);
  return { content: items.slice(page * size, page * size + size), page, size, totalElements: items.length, totalPages };
}

function findProject(db: MockDb, id: number): ProjectRow {
  const p = db.projects.find((x) => x.id === id);
  if (!p) throw new HttpError(404, 'Project not found.');
  return p;
}

/** Load a project and the caller's role in it (404 if missing, 403 if not a member). */
function access(ctx: Ctx, projectId: number): { project: ProjectRow; role: Role } {
  const project = findProject(ctx.db, projectId);
  const role = roleOf(ctx.db, project.id, ctx.me.id);
  if (!role) throw new HttpError(403, 'You are not a member of this project.');
  return { project, role };
}

function ensure(allowed: boolean, message = 'You do not have permission to perform this action.') {
  if (!allowed) throw new HttpError(403, message);
}

function findTask(ctx: Ctx, id: number) {
  const task = ctx.db.tasks.find((t) => t.id === id);
  if (!task) throw new HttpError(404, 'Task not found.');
  const { project, role } = access(ctx, task.projectId);
  return { task, project, role };
}

const taskKey = (p: ProjectRow, t: TaskRow) => `${p.key}-${t.number}`;

interface FieldChange {
  field: string;
  oldValue: string | null;
  newValue: string | null;
}

/** Record an activity entry; `change` stores a structured before/after value for one field. */
function log(ctx: Ctx, projectId: number, taskId: number | null, type: ActivityRow['type'], message: string, change?: FieldChange) {
  ctx.db.activities.push({
    id: nextId(ctx.db, 'activities'),
    projectId,
    taskId,
    actorId: ctx.me.id,
    type,
    message,
    field: change?.field ?? null,
    oldValue: change?.oldValue ?? null,
    newValue: change?.newValue ?? null,
    createdAt: now(),
  });
}

function notify(ctx: Ctx, userId: number, type: NotificationType, title: string, message: string, link: string | null, invitationId: number | null = null) {
  if (userId === ctx.me.id) return;
  const n: NotificationRow = {
    id: nextId(ctx.db, 'notifications'),
    userId,
    type,
    title,
    message,
    link,
    read: false,
    actorId: ctx.me.id,
    invitationId,
    createdAt: now(),
  };
  ctx.db.notifications.push(n);
}

function columnOf(db: MockDb, projectId: number, status: TaskStatus): TaskRow[] {
  return db.tasks.filter((t) => t.projectId === projectId && t.status === status);
}

/** Mark a task as changed: new updatedAt and a bumped optimistic-locking version (like JPA @Version). */
function touch(task: TaskRow) {
  task.updatedAt = now();
  task.version += 1;
}

/** A client-supplied version that no longer matches means someone else saved first. */
function checkVersion(current: number, clientVersion: unknown, what = 'task') {
  const v = optNum(clientVersion);
  if (v !== null && v !== current) {
    throw new HttpError(
      409,
      `This ${what} was changed by someone else while you were editing. Reload to see their changes, then try again.`,
      undefined,
      'EDIT_CONFLICT',
    );
  }
}

/** Record a status transition for flow analytics (the backend's task_status_events). */
function recordTransition(db: MockDb, task: TaskRow, from: TaskStatus | null, to: TaskStatus) {
  db.statusEvents.push({ id: nextId(db, 'statusEvents'), projectId: task.projectId, taskId: task.id, from, to, at: now() });
}

/** Move a task to the end of another column (used by submit/approve/request changes). */
function moveToColumnEnd(db: MockDb, task: TaskRow, status: TaskStatus) {
  recordTransition(db, task, task.status, status);
  task.status = status;
  if (status === 'IN_PROGRESS' && !task.startedAt) task.startedAt = now();
  placeBetween(columnOf(db, task.projectId, status), task, undefined, undefined);
  touch(task);
}

/** Remove a task's child rows (criteria, checklist, submissions and their evidence and reviews). */
function deleteTaskChildren(db: MockDb, taskIds: Set<number>) {
  const subIds = new Set(db.submissions.filter((s) => taskIds.has(s.taskId)).map((s) => s.id));
  db.reviews = db.reviews.filter((r) => !subIds.has(r.submissionId));
  db.evidence = db.evidence.filter((e) => !subIds.has(e.submissionId));
  db.submissionCriteria = db.submissionCriteria.filter((c) => !subIds.has(c.submissionId));
  db.attachments = db.attachments.filter((a) => !subIds.has(a.submissionId));
  db.submissions = db.submissions.filter((s) => !subIds.has(s.id));
  db.criteria = db.criteria.filter((c) => !taskIds.has(c.taskId));
  db.checklistItems = db.checklistItems.filter((c) => !taskIds.has(c.taskId));
  db.statusEvents = db.statusEvents.filter((e) => !taskIds.has(e.taskId));
  db.dependencies = db.dependencies.filter((d) => !taskIds.has(d.blockerTaskId) && !taskIds.has(d.blockedTaskId));
  db.comments = db.comments.filter((c) => !taskIds.has(c.taskId));
}

const taskLike = (t: TaskRow) => ({ status: t.status, assigneeId: t.assigneeId, reporterId: t.reporterId });

function reviewersOf(db: MockDb, projectId: number): number[] {
  return db.memberships.filter((m) => m.projectId === projectId && atLeast(m.role, 'MANAGER')).map((m) => m.userId);
}

function taskLink(t: TaskRow) {
  return `/projects/${t.projectId}/tasks/${t.id}`;
}

/**
 * Tells members of the task's project that `text` newly mentions them (not already in `before`,
 * not in `skip`), and returns everyone it mentions. The same rules as MentionNotifier.java: only
 * project members, never the writer, and an edit only tells the people it adds.
 */
function notifyMentions(
  ctx: Ctx,
  project: ProjectRow,
  task: TaskRow,
  text: string | null,
  before: string | null,
  skip: number[],
  where: 'COMMENT' | 'DESCRIPTION',
  anchor = '',
): number[] {
  if (!text || !text.includes('@')) return [];
  const people = ctx.db.memberships.filter((m) => m.projectId === project.id).flatMap((m) => ctx.db.users.filter((u) => u.id === m.userId));
  const names = people.map((u) => u.name);
  const idOf = (name: string) => people.find((u) => u.name.trim() === name)?.id;
  const already = new Set([...skip, ...mentionsIn(before ?? '', names).map(idOf)]);
  const mentioned: number[] = [];
  for (const name of mentionsIn(text, names)) {
    const id = idOf(name);
    if (id === undefined) continue;
    mentioned.push(id);
    if (already.has(id)) continue;
    const around = excerpt(text, `@${name.split(/\s+/)[0]}`, 120);
    const phrase = where === 'COMMENT' ? 'on' : 'in the description of';
    notify(ctx, id, 'MENTION', 'Mentioned you', `${ctx.me.name} mentioned you ${phrase} ${taskKey(project, task)}: “${around}”`, taskLink(task) + anchor);
  }
  return mentioned;
}

function myProjectIds(db: MockDb, userId: number): Set<number> {
  return new Set(db.memberships.filter((m) => m.userId === userId).map((m) => m.projectId));
}

function applyTaskQuery(ctx: Ctx, rows: TaskRow[]): TaskRow[] {
  const q = ctx.query;
  const today = todayIso();
  const search = (q.get('search') ?? '').trim().toLowerCase();
  const status = q.get('status');
  const priority = q.get('priority');
  const assignee = q.get('assignee');
  const milestoneId = q.get('milestoneId');
  const due = q.get('due');
  const in7 = todayIso(addDays(new Date(), 7));

  let result = rows.filter((t) => {
    if (search) {
      const p = ctx.db.projects.find((x) => x.id === t.projectId)!;
      const hay = `${p.key}-${t.number} ${t.title} ${t.description ?? ''}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    if (status === 'OPEN' ? t.status === 'DONE' : status && t.status !== status) return false;
    if (priority && t.priority !== priority) return false;
    if (assignee) {
      if (assignee === 'me' && t.assigneeId !== ctx.me.id) return false;
      if (assignee === 'unassigned' && t.assigneeId !== null) return false;
      if (/^\d+$/.test(assignee) && t.assigneeId !== Number(assignee)) return false;
    }
    if (milestoneId && t.milestoneId !== Number(milestoneId)) return false;
    if (due === 'overdue' && !isOverdue(t, today)) return false;
    if (due === 'today' && t.dueDate !== today) return false;
    if (due === 'week' && !(t.dueDate && t.dueDate >= today && t.dueDate <= in7)) return false;
    if (due === 'none' && t.dueDate !== null) return false;
    return true;
  });

  const sort = q.get('sort') ?? 'position';
  const dir = q.get('direction') === 'desc' ? -1 : 1;
  const statusOrder = (s: TaskStatus) => TASK_STATUSES.indexOf(s);
  const cmp: Record<string, (a: TaskRow, b: TaskRow) => number> = {
    position: (a, b) => statusOrder(a.status) - statusOrder(b.status) || a.position - b.position,
    dueDate: (a, b) => {
      if (a.dueDate === b.dueDate) return 0;
      if (!a.dueDate) return 1 * dir; // nulls last regardless of direction
      if (!b.dueDate) return -1 * dir;
      return a.dueDate.localeCompare(b.dueDate);
    },
    priority: (a, b) => PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority],
    createdAt: (a, b) => b.createdAt.localeCompare(a.createdAt),
    updatedAt: (a, b) => b.updatedAt.localeCompare(a.updatedAt),
    title: (a, b) => a.title.localeCompare(b.title),
  };
  const fn = cmp[sort] ?? cmp.position;
  result = [...result].sort((a, b) => fn(a, b) * dir || a.id - b.id);
  return result;
}

// ---------------------------------------------------------------------------
// Auth & users
// ---------------------------------------------------------------------------

route(
  'POST',
  '/auth/register',
  async ({ db, body }) => {
    const name = str(body.name);
    const email = str(body.email).toLowerCase();
    const password = typeof body.password === 'string' ? body.password : '';
    if (str(body.website)) throw new HttpError(400, 'Please correct the highlighted fields.', { form: 'We couldn’t process this form. Please reload the page and try again.' });
    check({
      name: length(name, 'Name', 2, 80) ?? (/[<>\p{Cc}]/u.test(name) ? 'Name can’t contain < or > or control characters.' : null),
      email: !email ? 'Email is required.' : !EMAIL_RE.test(email) ? 'Enter a valid email address.' : null,
      password: passwordProblem(password, email, name),
      acceptTerms: body.acceptTerms === true ? null : 'Please confirm you’re 18 or older and accept the terms and the privacy policy.',
    });
    if (db.users.some((u) => u.email === email)) {
      const message = 'An account with this email already exists. Sign in, or use “Forgot password?”.';
      throw new HttpError(409, message, { email: message });
    }
    const user: UserRow = {
      id: nextId(db, 'users'),
      name,
      email,
      passwordHash: await hashPassword(password),
      avatarColor: PALETTE[db.users.length % PALETTE.length],
      jobTitle: null,
      createdAt: now(),
      signup: attributionOf(body.attribution),
    };
    db.users.push(user);
    const session = openSession(db, user.id, false);
    setCookie(null);
    audit(db, user.id, null, 'account.created', null, 'ok');
    const res: AuthResponse = { token: session.token, tokenType: 'Bearer', expiresIn: session.expiresIn, user: userDto(user) };
    return created(res, 'Account created.');
  },
  false,
);

route(
  'POST',
  '/auth/login',
  async ({ db, body }) => {
    const email = str(body.email).toLowerCase();
    const password = typeof body.password === 'string' ? body.password : '';
    check({ email: email ? null : 'Email is required.', password: password ? null : 'Password is required.' });
    const user = db.users.find((u) => u.email === email);
    if (!user || !(await verifyPassword(password, user.passwordHash))) throw new HttpError(401, 'Invalid email or password.');
    const session = openSession(db, user.id, body.remember === true);
    setCookie(session.cookie);
    audit(db, user.id, null, 'auth.signed_in', null, 'ok', body.remember === true ? 'password, kept signed in' : 'password');
    const res: AuthResponse = { token: session.token, tokenType: 'Bearer', expiresIn: session.expiresIn, user: userDto(user) };
    return ok(res, 'Signed in.');
  },
  false,
);

route('GET', '/auth/me', ({ me }) => ok(userDto(me)));

// "Keep me signed in": a new token for the kept session the cookie names, while it's active.
route(
  'POST',
  '/auth/refresh',
  ({ db }) => {
    const value = readCookie();
    const [sid, secret] = (value ?? '').split('.');
    const s = sid ? db.sessions?.find((x) => x.sid === sid) : undefined;
    const user = s ? db.users.find((u) => u.id === s.userId) : undefined;
    if (!s || !user || !s.remember || !s.cookie || s.cookie !== secret || sessionState(s) !== 'ACTIVE') {
      if (value) setCookie(null);
      throw new HttpError(401, 'This browser isn’t kept signed in any more. Please sign in again.');
    }
    s.lastSeenAt = now();
    const res: AuthResponse = { ...tokenFor(s), tokenType: 'Bearer', user: userDto(user) };
    return ok(res);
  },
  false,
);

// The test API has no email: accounts work at once, and emailed links can't be sent.
const NO_EMAIL = 'The in-browser test API can’t send email. Accounts here work straight away, and their data stays in this browser.';
route(
  'GET',
  '/auth/options',
  () => ok({ registrationOpen: true, emailDelivery: false, emailVerificationRequired: false, passwordReset: false, turnstile: false, rememberDays: SESSION.rememberDays }),
  false,
);
route('POST', '/auth/verify-email', () => {
  throw new HttpError(400, 'This link isn’t valid here: the in-browser test API doesn’t send confirmation emails.', undefined, 'LINK_EXPIRED');
}, false);
route('POST', '/auth/resend-verification', () => {
  throw new HttpError(503, NO_EMAIL, undefined, 'NOT_AVAILABLE');
}, false);
route('POST', '/auth/forgot-password', () => {
  throw new HttpError(503, NO_EMAIL, undefined, 'NOT_AVAILABLE');
}, false);
route('POST', '/auth/reset-password', () => {
  throw new HttpError(400, 'This reset link isn’t valid here: the in-browser test API doesn’t send emails.', undefined, 'LINK_EXPIRED');
}, false);

route('PUT', '/users/me', ({ me, body }) => {
  const name = str(body.name);
  const jobTitle = optStr(body.jobTitle);
  const avatarColor = str(body.avatarColor);
  check({
    name: length(name, 'Name', 2, 80),
    jobTitle: jobTitle && jobTitle.length > 80 ? 'Job title must be at most 80 characters.' : null,
    avatarColor: HEX_RE.test(avatarColor) ? null : 'Choose a valid colour.',
  });
  me.name = name;
  me.jobTitle = jobTitle;
  me.avatarColor = avatarColor;
  return ok(userDto(me), 'Profile updated.');
});

route('PUT', '/users/me/password', async (ctx) => {
  const { me, body } = ctx;
  const current = typeof body.currentPassword === 'string' ? body.currentPassword : '';
  const next = typeof body.newPassword === 'string' ? body.newPassword : '';
  check({ currentPassword: current ? null : 'Current password is required.', newPassword: passwordProblem(next, me.email, me.name) });
  if (!(await verifyPassword(current, me.passwordHash))) {
    throw new HttpError(400, 'Please correct the highlighted fields.', { currentPassword: 'Current password is incorrect.' });
  }
  if (current === next) throw new HttpError(400, 'Please correct the highlighted fields.', { newPassword: 'New password must be different from the current one.' });
  const remember = ctx.db.sessions?.find((x) => x.sid === ctx.sid)?.remember ?? false;
  me.passwordHash = await hashPassword(next);
  for (const x of ctx.db.sessions ?? []) if (x.userId === me.id && !x.revokedAt) x.revokedAt = now();
  audit(ctx.db, me.id, null, 'auth.password_changed', null, 'ok', 'every session ended');
  const session = openSession(ctx.db, me.id, remember);
  setCookie(session.cookie);
  const res: AuthResponse = { token: session.token, tokenType: 'Bearer', expiresIn: session.expiresIn, user: userDto(me) };
  return ok(res, 'Password changed. Other devices were signed out.');
});

// ---------------------------------------------------------------------------
// Sessions, my data, deleting my account
// ---------------------------------------------------------------------------

// Signs this browser out: this tab's session, and the browser's kept sign-in when it's the same
// account's. Without a usable token (it expired, say), the cookie alone ends its own session.
route(
  'POST',
  '/auth/logout',
  ({ db, sid }) => {
    const own = sid ? db.sessions?.find((x) => x.sid === sid && !x.revokedAt) : undefined;
    const me = own && sessionState(own) === 'ACTIVE' ? own.userId : null;
    const [keptSid, secret] = (readCookie() ?? '').split('.');
    const kept = keptSid
      ? db.sessions?.find((x) => x.sid === keptSid && x.remember && x.cookie === secret && sessionState(x) === 'ACTIVE' && (me === null || x.userId === me))
      : undefined;
    setCookie(null);
    if (me === null && !kept) throw new HttpError(401, ENDED.EXPIRED);
    if (own && me !== null) {
      own.revokedAt = now();
      audit(db, me, null, 'auth.signed_out', null, 'ok');
    }
    if (kept && kept !== own) {
      kept.revokedAt = now();
      audit(db, kept.userId, null, 'auth.signed_out', `session ${kept.id}`, 'ok', me === null ? 'kept sign-in, by its cookie' : 'kept sign-in on the same browser');
    }
    return ok(null, 'Signed out.');
  },
  false,
);

route('POST', '/auth/logout-everywhere', ({ db, me }) => {
  let ended = 0;
  for (const x of db.sessions ?? []) {
    if (x.userId === me.id && !x.revokedAt) {
      x.revokedAt = now();
      ended++;
    }
  }
  audit(db, me.id, null, 'auth.signed_out_everywhere', null, 'ok', `${ended} session(s) ended`);
  setCookie(null);
  return ok(null, `Signed out of ${ended} ${ended === 1 ? 'session' : 'sessions'}.`);
});

route('GET', '/auth/sessions', ({ db, me, sid }) => {
  const list = (db.sessions ?? []).filter((x) => x.userId === me.id && sessionState(x) === 'ACTIVE').sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
  return ok(
    list.map((x) => ({ id: x.id, device: x.device, network: null, createdAt: x.createdAt, lastSeenAt: x.lastSeenAt, expiresAt: x.expiresAt, remember: x.remember, current: x.sid === sid })),
  );
});

route('DELETE', '/auth/sessions/:id', ({ db, me, params }) => {
  const s = db.sessions?.find((x) => x.id === Number(params.id) && x.userId === me.id && !x.revokedAt);
  if (!s) throw new HttpError(404, 'That session has already ended.');
  s.revokedAt = now();
  audit(db, me.id, null, 'auth.session_ended', `session ${s.id}`, 'ok');
  return ok(null, 'That session was signed out.');
});

route('GET', '/users/me/export', ({ db, me }) => {
  const key = (projectId: number) => db.projects.find((p) => p.id === projectId)?.key ?? '?';
  const taskKey = (taskId: number) => {
    const t = db.tasks.find((x) => x.id === taskId);
    return t ? `${key(t.projectId)}-${t.number}` : '?';
  };
  const mySubs = db.submissions.filter((x) => x.submittedById === me.id);
  audit(db, me.id, null, 'account.exported', null, 'ok');
  return ok({
    format: 'niveloft-account-export',
    version: 1,
    exportedAt: now(),
    note: 'In-browser test API: this copy comes from the data stored in this browser.',
    profile: { name: me.name, email: me.email, jobTitle: me.jobTitle, createdAt: me.createdAt },
    projects: db.memberships.filter((m) => m.userId === me.id).map((m) => ({ project: key(m.projectId), name: db.projects.find((p) => p.id === m.projectId)?.name, role: m.role, joinedAt: m.joinedAt })),
    tasksAssignedToMe: db.tasks.filter((t) => t.assigneeId === me.id).map((t) => ({ task: `${key(t.projectId)}-${t.number}`, title: t.title, status: t.status, dueDate: t.dueDate })),
    comments: db.comments.filter((c) => c.authorId === me.id).map((c) => ({ task: taskKey(c.taskId), at: c.createdAt, text: c.body })),
    submissions: mySubs.map((x) => ({ task: taskKey(x.taskId), version: x.version, status: x.status, at: x.createdAt, notes: x.notes })),
    reviews: db.reviews.filter((r) => r.reviewerId === me.id).map((r) => ({ submission: r.submissionId, decision: r.decision, feedback: r.feedback, at: r.createdAt })),
    documentsIWrote: (db.documents ?? [])
      .filter((d) => d.createdBy === me.id)
      .map((d) => ({ project: key(d.projectId), title: d.title, status: d.status, createdAt: d.createdAt, updatedAt: d.updatedAt, text: d.body })),
    answersIRated: (db.aiFeedback ?? [])
      .filter((f) => f.userId === me.id)
      .map((f) => ({ project: key(f.projectId), at: f.createdAt, verdict: f.verdict, categories: f.categories.join(',') || null, correction: f.correction, question: f.question })),
    notifications: db.notifications.filter((n) => n.userId === me.id).map((n) => ({ at: n.createdAt, title: n.title, message: n.message, isRead: n.read })),
    sessions: (db.sessions ?? []).filter((x) => x.userId === me.id && sessionState(x) === 'ACTIVE').map((x) => ({ signedInAt: x.createdAt, lastUsedAt: x.lastSeenAt, device: x.device })),
    auditRecords: (db.audit ?? []).filter((a) => a.actorId === me.id).map((a) => ({ at: a.at, action: a.action, outcome: a.outcome, detail: a.detail })),
  });
});

function ownedProjects(db: MockDb, userId: number) {
  return db.memberships
    .filter((m) => m.userId === userId && m.role === 'OWNER')
    .map((m) => ({ project: db.projects.find((p) => p.id === m.projectId)!, others: db.memberships.filter((x) => x.projectId === m.projectId && x.userId !== userId).length }))
    .filter((o) => o.project);
}

route('GET', '/users/me/deletion-check', ({ db, me }) => {
  const owned = ownedProjects(db, me.id);
  const blockedBy = owned.filter((o) => o.others > 0).map((o) => o.project.name);
  return ok({ blockedBy, deletedWith: owned.filter((o) => o.others === 0).map((o) => o.project.name), canDelete: blockedBy.length === 0 });
});

route('POST', '/users/me/delete', async (ctx) => {
  const { db, me, body } = ctx;
  if (str(body.confirm) !== 'DELETE') throw new HttpError(400, 'Please correct the highlighted fields.', { confirm: 'Type DELETE, in capitals, to confirm.' });
  if (!(await verifyPassword(typeof body.password === 'string' ? body.password : '', me.passwordHash))) {
    audit(db, me.id, null, 'account.deleted', null, 'denied', 'wrong password');
    throw new HttpError(400, 'Please correct the highlighted fields.', { password: 'That password isn’t right.' });
  }
  const owned = ownedProjects(db, me.id);
  const blocked = owned.filter((o) => o.others > 0).map((o) => `“${o.project.name}”`);
  if (blocked.length) {
    throw new HttpError(409, `You own ${blocked.join(', ')} with other people. Make someone else the owner (Project settings → Transfer ownership) or delete ${blocked.length === 1 ? 'it' : 'them'} first.`);
  }
  for (const o of owned) removeProjectRows(db, o.project.id);
  for (const m of db.memberships.filter((x) => x.userId === me.id)) {
    unassignOpenTasks(db, m.projectId, me.id);
    log(ctx, m.projectId, null, 'MEMBER_REMOVED', 'left the project (account deleted)');
  }
  db.memberships = db.memberships.filter((x) => x.userId !== me.id);
  for (const i of db.invitations) if (i.email === me.email && i.status === 'PENDING') Object.assign(i, { status: 'REVOKED', respondedAt: now() });
  db.notifications = db.notifications.filter((n) => n.userId !== me.id);
  db.sessions = (db.sessions ?? []).filter((x) => x.userId !== me.id);
  for (const f of db.aiFeedback ?? []) if (f.userId === me.id) f.userId = null; // the rating stays with the project, unlinked
  audit(db, me.id, null, 'account.deleted', null, 'ok', `${owned.length} solo project(s) deleted with it`);
  Object.assign(me, { name: 'Deleted user', email: `deleted-${me.id}@deleted.invalid`, passwordHash: '!', jobTitle: null, avatarColor: '#94a3b8', signup: undefined });
  return ok(null, 'Your account was deleted.');
});

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

/** "Since you were last here": others' changes in my projects after I last caught up (as CatchUpService.java). */
route('GET', '/catch-up', (ctx) => {
  const { db, me } = ctx;
  const since = me.caughtUpAt ?? null;
  const none: CatchUp = { since: null, capped: false, counts: {}, dueDateChanges: 0, latest: [] };
  if (!since) return ok(none);
  const floor = new Date(Date.now() - 14 * 86_400_000).toISOString();
  const capped = since < floor;
  const from = capped ? floor : since;
  const mine = myProjectIds(db, me.id);
  const rows = db.activities
    .filter((a) => mine.has(a.projectId) && a.createdAt > from && a.actorId !== me.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id);
  const counts: Partial<Record<ActivityType, number>> = {};
  for (const a of rows) counts[a.type] = (counts[a.type] ?? 0) + 1;
  const dueDateChanges = rows.filter((a) => a.type === 'TASK_UPDATED' && a.field === 'dueDate').length;
  const result: CatchUp = { since: from, capped, counts, dueDateChanges, latest: rows.slice(0, 6).map((a) => activityDto(db, a)) };
  return ok(result);
});

route('POST', '/catch-up/seen', (ctx) => {
  ctx.me.caughtUpAt = now();
  return ok(null);
});

route('GET', '/dashboard', (ctx) => {
  const { db, me } = ctx;
  const ids = myProjectIds(db, me.id);
  const projects = db.projects.filter((p) => ids.has(p.id));
  const tasks = db.tasks.filter((t) => ids.has(t.projectId));
  const today = todayIso();
  const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 }).toISOString();
  const byDue = (a: TaskRow, b: TaskRow) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority];

  const myOpen = tasks.filter((t) => t.assigneeId === me.id && t.status !== 'DONE').sort(byDue);
  const reviewQueue = tasks
    .filter((t) => {
      if (t.status !== 'IN_REVIEW') return false;
      const pending = db.submissions.find((s) => s.taskId === t.id && s.status === 'PENDING');
      return !!pending && can.reviewSubmission(roleOf(db, t.projectId, me.id), pending.submittedById, me.id);
    })
    .sort(byDue);

  const horizon = todayIso(addDays(new Date(), 21));
  const upcoming: UpcomingItem[] = [
    ...myOpen
      .filter((t) => t.dueDate && t.dueDate <= horizon)
      .map((t) => {
        const p = projects.find((x) => x.id === t.projectId)!;
        return {
          type: 'TASK' as const,
          id: t.id,
          title: t.title,
          key: taskKey(p, t),
          date: t.dueDate!,
          projectId: p.id,
          projectName: p.name,
          projectColor: p.color,
          link: taskLink(t),
          overdue: isOverdue(t, today),
        };
      }),
    ...db.milestones
      .filter((m) => ids.has(m.projectId) && !m.completed && m.dueDate <= horizon)
      .map((m) => {
        const p = projects.find((x) => x.id === m.projectId)!;
        return {
          type: 'MILESTONE' as const,
          id: m.id,
          title: m.name,
          key: null,
          date: m.dueDate,
          projectId: p.id,
          projectName: p.name,
          projectColor: p.color,
          link: `/projects/${p.id}/milestones`,
          overdue: m.dueDate < today,
        };
      }),
  ]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 8);

  const data: DashboardData = {
    stats: {
      activeProjects: projects.filter((p) => p.status === 'ACTIVE').length,
      myOpenTasks: myOpen.length,
      myOverdueTasks: myOpen.filter((t) => isOverdue(t, today)).length,
      awaitingMyReview: reviewQueue.length,
      completedThisWeek: tasks.filter((t) => t.completedAt && t.completedAt >= weekStart).length,
    },
    myTasks: myOpen.slice(0, 8).map((t) => taskDto(db, t)),
    reviewQueue: reviewQueue.slice(0, 6).map((t) => taskDto(db, t)),
    projects: projects
      .filter((p) => p.status === 'ACTIVE' || p.status === 'ON_HOLD')
      .map((p) => projectSummary(db, p, me.id))
      .sort((a, b) => (a.deadline ?? '9999').localeCompare(b.deadline ?? '9999')),
    upcoming,
    completionTrend: completionTrend(tasks),
    recentActivity: db.activities
      .filter((a) => ids.has(a.projectId))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id)
      .slice(0, 12)
      .map((a) => activityDto(db, a)),
    ...computeAttention(db, me.id),
  };
  return ok(data);
});

// AI: the test API has no provider, so it says so — it never fakes an answer.
const AI_REASON = 'The in-browser test API runs without a server, so there’s no server AI. Turn on the AI built into Chrome below, or run the real backend with Ollama on the same computer (found automatically).';
route('GET', '/ai/status', () => ok({ available: false, provider: 'none', model: null, reason: AI_REASON, remainingThisHour: 0, tools: false, voice: null }));
// The test API has no server voice either: answers are read by the browser's own voice.
route('POST', '/ai/speech', () => {
  throw new HttpError(503, 'The in-browser test API has no server voice, so answers are read by your browser’s voice.', undefined, 'NOT_AVAILABLE');
});
for (const path of ['/tasks/:id/ai/review-assist', '/tasks/:id/ai/criteria', '/projects/:id/ai/summary', '/projects/:id/ai/ask', '/projects/:id/ai/ask/stream', '/projects/:id/ai/plan']) {
  route('POST', path, (ctx) => {
    // Access first (as on the server), so outsiders learn nothing.
    if (path.startsWith('/tasks')) findTask(ctx, Number(ctx.params.id));
    else access(ctx, Number(ctx.params.id));
    throw new HttpError(503, 'AI assistance is not configured, so nothing was generated.', undefined, 'AI_UNAVAILABLE');
  });
}

// Stopping a streamed question: members only, and only the asker's own (there are none here).
route('DELETE', '/projects/:id/ai/ask/:requestId', (ctx) => {
  access(ctx, Number(ctx.params.id));
  return { data: null, status: 204 };
});

// Quick search for the command palette: only projects the caller belongs to.
route('GET', '/search', (ctx) => {
  const { db, me, query } = ctx;
  const q = (query.get('q') ?? '').trim();
  const limit = Math.max(1, Math.min(Number(query.get('limit')) || 8, 20));
  if (!q) return ok({ query: q, projects: [], tasks: [] } satisfies SearchResult);
  const ids = myProjectIds(db, me.id);
  const projects = db.projects
    .filter((p) => ids.has(p.id))
    .map((p) => ({ p, r: rank(q, p.key, p.name) }))
    .filter((x) => x.r >= 0)
    .sort((a, b) => a.r - b.r || a.p.name.localeCompare(b.p.name))
    .slice(0, 5)
    .map(({ p }) => ({ type: 'PROJECT' as const, id: p.id, key: p.key, title: p.name, subtitle: p.status.replace('_', ' ').toLowerCase(), color: p.color, status: null, link: `/projects/${p.id}` }));
  const tasks = db.tasks
    .filter((t) => ids.has(t.projectId))
    .map((t) => {
      const p = db.projects.find((x) => x.id === t.projectId)!;
      return { t, p, r: rank(q, taskKey(p, t), t.title) };
    })
    .filter((x) => x.r >= 0)
    .sort((a, b) => a.r - b.r || Number(a.t.status === 'DONE') - Number(b.t.status === 'DONE') || b.t.updatedAt.localeCompare(a.t.updatedAt))
    .slice(0, limit)
    .map(({ t, p }) => ({
      type: 'TASK' as const,
      id: t.id,
      key: taskKey(p, t),
      title: t.title,
      subtitle: `${p.name}, ${t.assigneeId ? (db.users.find((u) => u.id === t.assigneeId)?.name ?? 'Unknown') : 'unassigned'}`,
      color: p.color,
      status: t.status,
      link: taskLink(t),
    }));
  return ok({ query: q, projects, tasks } satisfies SearchResult);
});

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

const PROJECT_STATUSES: ProjectStatus[] = ['ACTIVE', 'ON_HOLD', 'COMPLETED', 'ARCHIVED'];

function validateProject(db: MockDb, body: Record<string, unknown>, existingId?: number) {
  const name = str(body.name);
  const key = str(body.key).toUpperCase();
  const description = optStr(body.description);
  const color = str(body.color) || PALETTE[0];
  const status = (body.status ?? 'ACTIVE') as ProjectStatus;
  const startDate = str(body.startDate);
  const deadline = optStr(body.deadline);
  check({
    name: length(name, 'Name', 3, 100),
    key: !key ? 'Key is required.' : !/^[A-Z][A-Z0-9]{1,5}$/.test(key) ? 'Key must be 2–6 letters or digits, starting with a letter.' : null,
    description: description && description.length > 2000 ? 'Description must be at most 2000 characters.' : null,
    color: HEX_RE.test(color) ? null : 'Choose a valid colour.',
    status: oneOf(status, PROJECT_STATUSES) ? null : 'Choose a valid status.',
    startDate: validDate(startDate, 'Start date', true),
    deadline: validDate(deadline, 'Deadline', false) ?? (deadline && startDate && deadline < startDate ? 'Deadline must be on or after the start date.' : null),
  });
  if (db.projects.some((p) => p.key === key && p.id !== existingId)) {
    throw new HttpError(409, 'That project key is already in use.', { key: 'That project key is already in use.' });
  }
  return { name, key, description, color, status, startDate, deadline };
}

route('GET', '/projects', (ctx) => {
  const { db, me, query } = ctx;
  const ids = myProjectIds(db, me.id);
  const search = (query.get('search') ?? '').trim().toLowerCase();
  const status = query.get('status');
  const rows = db.projects
    .filter((p) => ids.has(p.id))
    .filter((p) => !search || `${p.name} ${p.key} ${p.description ?? ''}`.toLowerCase().includes(search))
    .filter((p) => (status ? p.status === status : true))
    .sort((a, b) => {
      const rank = (s: ProjectStatus) => PROJECT_STATUSES.indexOf(s);
      return rank(a.status) - rank(b.status) || b.updatedAt.localeCompare(a.updatedAt);
    });
  const page = paginate(rows, query, 12);
  return ok({ ...page, content: page.content.map((p) => projectSummary(db, p, me.id)) });
});

route('POST', '/projects', (ctx) => {
  const { db, me, body } = ctx;
  const v = validateProject(db, body);
  const ts = now();
  const project: ProjectRow = { id: nextId(db, 'projects'), ...v, ownerId: me.id, taskSeq: 0, createdAt: ts, updatedAt: ts, version: 0 };
  db.projects.push(project);
  db.memberships.push({ id: nextId(db, 'memberships'), projectId: project.id, userId: me.id, role: 'OWNER', joinedAt: ts });
  log(ctx, project.id, null, 'PROJECT_CREATED', 'created the project');
  return created(projectDetail(db, project, me.id), 'Project created.');
});

route('GET', '/projects/:id', (ctx) => {
  const { project } = access(ctx, Number(ctx.params.id));
  return ok(projectDetail(ctx.db, project, ctx.me.id));
});

route('PUT', '/projects/:id', (ctx) => {
  const { project, role } = access(ctx, Number(ctx.params.id));
  ensure(can.editProject(role), 'Only owners and managers can edit project details.');
  checkVersion(project.version, ctx.body.version, 'project');
  const v = validateProject(ctx.db, ctx.body, project.id);
  const statusChanged = v.status !== project.status;
  Object.assign(project, v, { updatedAt: now(), version: project.version + 1 });
  log(ctx, project.id, null, 'PROJECT_UPDATED', statusChanged ? `changed the project status to ${v.status.replace('_', ' ').toLowerCase()}` : 'updated the project details');
  return ok(projectDetail(ctx.db, project, ctx.me.id), 'Project updated.');
});

route('DELETE', '/projects/:id', (ctx) => {
  const { project, role } = access(ctx, Number(ctx.params.id));
  ensure(can.deleteProject(role), 'Only the project owner can delete a project.');
  removeProjectRows(ctx.db, project.id);
  audit(ctx.db, ctx.me.id, project.id, 'project.deleted', `${project.key} (${project.name})`, 'ok');
  return ok(null, 'Project deleted.');
});

/** Deletes a project and everything in it (the database's cascades in the real backend). */
function removeProjectRows(db: MockDb, projectId: number) {
  const project = { id: projectId };
  const taskIds = new Set(db.tasks.filter((t) => t.projectId === project.id).map((t) => t.id));
  const invIds = new Set(db.invitations.filter((i) => i.projectId === project.id).map((i) => i.id));
  deleteTaskChildren(db, taskIds);
  db.tasks = db.tasks.filter((t) => t.projectId !== project.id);
  db.milestones = db.milestones.filter((m) => m.projectId !== project.id);
  db.memberships = db.memberships.filter((m) => m.projectId !== project.id);
  db.invitations = db.invitations.filter((i) => i.projectId !== project.id);
  db.activities = db.activities.filter((a) => a.projectId !== project.id);
  const prefix = `/projects/${project.id}/`;
  db.notifications = db.notifications.filter((n) => !(n.link?.startsWith(prefix) || (n.invitationId && invIds.has(n.invitationId))));
  db.projects = db.projects.filter((p) => p.id !== project.id);
}

function unassignOpenTasks(db: MockDb, projectId: number, userId: number) {
  for (const t of db.tasks) {
    if (t.projectId === projectId && t.assigneeId === userId && t.status !== 'DONE') {
      t.assigneeId = null;
      touch(t);
    }
  }
}

route('POST', '/projects/:id/leave', (ctx) => {
  const { project, role } = access(ctx, Number(ctx.params.id));
  ensure(can.leaveProject(role), 'The owner cannot leave the project. Delete it or ask for ownership changes instead.');
  ctx.db.memberships = ctx.db.memberships.filter((m) => !(m.projectId === project.id && m.userId === ctx.me.id));
  unassignOpenTasks(ctx.db, project.id, ctx.me.id);
  log(ctx, project.id, null, 'MEMBER_REMOVED', 'left the project');
  return ok(null, `You left ${project.name}.`);
});

// ---------------------------------------------------------------------------
// Members & invitations
// ---------------------------------------------------------------------------

route('GET', '/projects/:id/members', (ctx) => {
  const { project } = access(ctx, Number(ctx.params.id));
  return ok(membersOf(ctx.db, project.id));
});

function findMembership(ctx: Ctx, projectId: number, memberId: number) {
  const m = ctx.db.memberships.find((x) => x.id === memberId && x.projectId === projectId);
  if (!m) throw new HttpError(404, 'Member not found.');
  return m;
}

route('PUT', '/projects/:id/members/:memberId', (ctx) => {
  const { project, role } = access(ctx, Number(ctx.params.id));
  const m = findMembership(ctx, project.id, Number(ctx.params.memberId));
  const newRole = ctx.body.role;
  check({ role: oneOf(newRole, ['MANAGER', 'MEMBER', 'VIEWER'] as const) ? null : 'Choose a valid role.' });
  ensure(can.manageMember(role, m.role, m.userId === ctx.me.id), 'You cannot change this member’s role.');
  ensure(can.assignableRoles(role).includes(newRole as Role), `You cannot grant the ${String(newRole).toLowerCase()} role.`);
  if (m.role !== newRole) {
    const previousRole = m.role;
    m.role = newRole as Role;
    if (newRole === 'VIEWER') unassignOpenTasks(ctx.db, project.id, m.userId);
    const u = ctx.db.users.find((x) => x.id === m.userId)!;
    log(ctx, project.id, null, 'MEMBER_ROLE_CHANGED', `changed ${u.name}’s role`, { field: 'role', oldValue: ROLE_LABEL[previousRole], newValue: ROLE_LABEL[m.role] });
    audit(ctx.db, ctx.me.id, project.id, 'project.role_changed', `user ${u.id}`, 'ok', `${previousRole.toLowerCase()} → ${m.role.toLowerCase()}`);
    notify(ctx, u.id, 'ROLE_CHANGED', 'Your role changed', `${ctx.me.name} changed your role in “${project.name}” to ${ROLE_LABEL[m.role]}.`, `/projects/${project.id}`);
  }
  return ok(membersOf(ctx.db, project.id).find((x) => x.id === m.id), 'Role updated.');
});

route('DELETE', '/projects/:id/members/:memberId', (ctx) => {
  const { project, role } = access(ctx, Number(ctx.params.id));
  const m = findMembership(ctx, project.id, Number(ctx.params.memberId));
  ensure(can.manageMember(role, m.role, m.userId === ctx.me.id), 'You cannot remove this member.');
  ctx.db.memberships = ctx.db.memberships.filter((x) => x.id !== m.id);
  unassignOpenTasks(ctx.db, project.id, m.userId);
  const u = ctx.db.users.find((x) => x.id === m.userId)!;
  log(ctx, project.id, null, 'MEMBER_REMOVED', `removed ${u.name} from the project`);
  audit(ctx.db, ctx.me.id, project.id, 'project.member_removed', `user ${u.id}`, 'ok');
  return ok(null, `${u.name} was removed from the project.`);
});

route('POST', '/projects/:id/transfer-ownership', (ctx) => {
  const { db } = ctx;
  const { project, role } = access(ctx, Number(ctx.params.id));
  ensure(role === 'OWNER', 'Only the project owner can hand the project to someone else.');
  const target = findMembership(ctx, project.id, Number(ctx.body.memberId));
  if (target.userId === ctx.me.id) throw new HttpError(400, 'Please correct the highlighted fields.', { memberId: 'You already own this project.' });
  const mine = db.memberships.find((m) => m.projectId === project.id && m.userId === ctx.me.id)!;
  const next = db.users.find((u) => u.id === target.userId)!;
  const before = target.role;
  mine.role = 'MANAGER';
  target.role = 'OWNER';
  project.ownerId = next.id;
  log(ctx, project.id, null, 'MEMBER_ROLE_CHANGED', `made ${next.name} the owner`, { field: 'role', oldValue: ROLE_LABEL[before], newValue: 'Owner' });
  notify(ctx, next.id, 'ROLE_CHANGED', 'You own a project now', `${ctx.me.name} made you the owner of “${project.name}”. They stay on as a manager.`, `/projects/${project.id}/settings`);
  audit(db, ctx.me.id, project.id, 'project.ownership_transferred', `user ${next.id}`, 'ok', 'previous owner is now a manager');
  return ok(membersOf(db, project.id).find((x) => x.id === target.id), 'Ownership transferred.');
});

route('GET', '/projects/:id/audit', (ctx) => {
  const { project, role } = access(ctx, Number(ctx.params.id));
  ensure(atLeast(role, 'MANAGER'), 'Only owners and managers can see the security log.');
  const rows = (ctx.db.audit ?? []).filter((a) => a.projectId === project.id).sort((a, b) => b.id - a.id).slice(0, 50);
  return ok(rows.map((a) => ({ id: a.id, at: a.at, actor: a.actorId === null ? 'Niveloft' : (ctx.db.users.find((u) => u.id === a.actorId)?.name ?? 'Unknown'), action: a.action, target: a.target, outcome: a.outcome, detail: a.detail })));
});

route('GET', '/projects/:id/invitations', (ctx) => {
  const { project, role } = access(ctx, Number(ctx.params.id));
  ensure(can.manageMembers(role), 'Only owners and managers can view invitations.');
  const rows = ctx.db.invitations.filter((i) => i.projectId === project.id && i.status === 'PENDING').sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return ok(rows.map((i) => invitationDto(ctx.db, i)));
});

route('POST', '/projects/:id/invitations', (ctx) => {
  const { db } = ctx;
  const { project, role } = access(ctx, Number(ctx.params.id));
  ensure(can.manageMembers(role), 'Only owners and managers can invite people.');
  const email = str(ctx.body.email).toLowerCase();
  const inviteRole = ctx.body.role;
  check({
    email: !email ? 'Email is required.' : !EMAIL_RE.test(email) ? 'Enter a valid email address.' : null,
    role: oneOf(inviteRole, can.assignableRoles(role)) ? null : 'Choose a role you are allowed to grant.',
  });
  const existingUser = db.users.find((u) => u.email === email);
  if (existingUser && roleOf(db, project.id, existingUser.id)) {
    throw new HttpError(409, `${existingUser.name} is already a member of this project.`, { email: 'This person is already a member.' });
  }
  if (db.invitations.some((i) => i.projectId === project.id && i.email === email && i.status === 'PENDING')) {
    throw new HttpError(409, 'An invitation is already pending for this email.', { email: 'An invitation is already pending for this email.' });
  }
  const inv = { id: nextId(db, 'invitations'), projectId: project.id, email, role: inviteRole as Role, status: 'PENDING' as InvitationStatus, invitedById: ctx.me.id, createdAt: now(), respondedAt: null };
  db.invitations.push(inv);
  log(ctx, project.id, null, 'INVITATION_SENT', `invited ${email} as ${ROLE_LABEL[inv.role].toLowerCase()}`);
  audit(db, ctx.me.id, project.id, 'project.invitation_sent', `invitation ${inv.id}`, 'ok', `as ${inv.role.toLowerCase()}${existingUser ? ', existing account' : ', no account yet'}`);
  if (existingUser) {
    notify(ctx, existingUser.id, 'INVITATION', 'Project invitation', `${ctx.me.name} invited you to join “${project.name}” as ${ROLE_LABEL[inv.role].toLowerCase()}.`, '/inbox', inv.id);
  }
  return created(invitationDto(db, inv), existingUser ? `Invitation sent to ${existingUser.name}.` : `Invitation sent to ${email}. They will see it after signing up with this email.`);
});

route('DELETE', '/projects/:id/invitations/:invitationId', (ctx) => {
  const { project, role } = access(ctx, Number(ctx.params.id));
  ensure(can.manageMembers(role), 'Only owners and managers can revoke invitations.');
  const inv = ctx.db.invitations.find((i) => i.id === Number(ctx.params.invitationId) && i.projectId === project.id);
  if (!inv) throw new HttpError(404, 'Invitation not found.');
  if (inv.status !== 'PENDING') throw new HttpError(409, 'Only pending invitations can be revoked.');
  inv.status = 'REVOKED';
  inv.respondedAt = now();
  return ok(null, 'Invitation revoked.');
});

route('GET', '/invitations/mine', ({ db, me }) => {
  const rows = db.invitations.filter((i) => i.email === me.email && i.status === 'PENDING').sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return ok(rows.map((i) => invitationDto(db, i)));
});

function respondToInvitation(ctx: Ctx, accept: boolean): Result {
  const { db, me } = ctx;
  const inv = db.invitations.find((i) => i.id === Number(ctx.params.id));
  if (!inv || inv.email !== me.email) throw new HttpError(404, 'Invitation not found.');
  if (inv.status !== 'PENDING') throw new HttpError(409, `This invitation was already ${inv.status.toLowerCase()}.`);
  const project = findProject(db, inv.projectId);
  inv.status = accept ? 'ACCEPTED' : 'DECLINED';
  inv.respondedAt = now();
  for (const n of db.notifications) if (n.invitationId === inv.id && n.userId === me.id) n.read = true;
  if (accept) {
    if (!roleOf(db, project.id, me.id)) {
      db.memberships.push({ id: nextId(db, 'memberships'), projectId: project.id, userId: me.id, role: inv.role, joinedAt: now() });
    }
    log(ctx, project.id, null, 'MEMBER_JOINED', `joined the project as ${ROLE_LABEL[inv.role].toLowerCase()}`);
    audit(db, me.id, project.id, 'project.invitation_accepted', `invitation ${inv.id}`, 'ok', `as ${inv.role.toLowerCase()}`);
    return ok({ projectId: project.id }, `You joined ${project.name}.`);
  }
  return ok({ projectId: project.id }, 'Invitation declined.');
}

route('POST', '/invitations/:id/accept', (ctx) => respondToInvitation(ctx, true));
route('POST', '/invitations/:id/decline', (ctx) => respondToInvitation(ctx, false));

// ---------------------------------------------------------------------------
// Milestones
// ---------------------------------------------------------------------------

function validateMilestone(body: Record<string, unknown>) {
  const name = str(body.name);
  const description = optStr(body.description);
  const dueDate = str(body.dueDate);
  check({
    name: length(name, 'Name', 2, 100),
    description: description && description.length > 1000 ? 'Description must be at most 1000 characters.' : null,
    dueDate: validDate(dueDate, 'Due date', true),
  });
  return { name, description, dueDate, completed: body.completed === true };
}

route('GET', '/projects/:id/milestones', (ctx) => {
  const { project } = access(ctx, Number(ctx.params.id));
  const rows = ctx.db.milestones.filter((m) => m.projectId === project.id).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  return ok(rows.map((m) => milestoneDto(ctx.db, m)));
});

route('POST', '/projects/:id/milestones', (ctx) => {
  const { project, role } = access(ctx, Number(ctx.params.id));
  ensure(can.manageMilestones(role), 'Only owners and managers can manage milestones.');
  const v = validateMilestone(ctx.body);
  const m = { id: nextId(ctx.db, 'milestones'), projectId: project.id, ...v, completedAt: v.completed ? now() : null, createdAt: now() };
  ctx.db.milestones.push(m);
  log(ctx, project.id, null, 'MILESTONE_CREATED', `added milestone “${m.name}”`);
  return created(milestoneDto(ctx.db, m), 'Milestone created.');
});

function findMilestone(ctx: Ctx) {
  const m = ctx.db.milestones.find((x) => x.id === Number(ctx.params.id));
  if (!m) throw new HttpError(404, 'Milestone not found.');
  const { role } = access(ctx, m.projectId);
  ensure(can.manageMilestones(role), 'Only owners and managers can manage milestones.');
  return m;
}

route('PUT', '/milestones/:id', (ctx) => {
  const m = findMilestone(ctx);
  const v = validateMilestone(ctx.body);
  const becameComplete = v.completed && !m.completed;
  Object.assign(m, v, { completedAt: v.completed ? (m.completedAt ?? now()) : null });
  log(ctx, m.projectId, null, 'MILESTONE_UPDATED', becameComplete ? `marked milestone “${m.name}” complete` : `updated milestone “${m.name}”`);
  return ok(milestoneDto(ctx.db, m), 'Milestone updated.');
});

route('DELETE', '/milestones/:id', (ctx) => {
  const m = findMilestone(ctx);
  for (const t of ctx.db.tasks) if (t.milestoneId === m.id) t.milestoneId = null;
  ctx.db.milestones = ctx.db.milestones.filter((x) => x.id !== m.id);
  log(ctx, m.projectId, null, 'MILESTONE_DELETED', `deleted milestone “${m.name}”`);
  return ok(null, 'Milestone deleted.');
});

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

const PRIORITY_VALUES: Priority[] = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];

function validateTask(ctx: Ctx, projectId: number, body: Record<string, unknown>) {
  const title = str(body.title);
  const description = optStr(body.description);
  const priority = body.priority ?? 'MEDIUM';
  const assigneeId = optNum(body.assigneeId);
  const dueDate = optStr(body.dueDate);
  const milestoneId = optNum(body.milestoneId);
  const estimateDays = optNum(body.estimateDays);
  const assigneeRole = assigneeId ? roleOf(ctx.db, projectId, assigneeId) : null;
  check({
    title: length(title, 'Title', 3, 200),
    description: description && description.length > 5000 ? 'Description must be at most 5000 characters.' : null,
    priority: oneOf(priority, PRIORITY_VALUES) ? null : 'Choose a valid priority.',
    assigneeId: assigneeId && (!assigneeRole || assigneeRole === 'VIEWER') ? 'The assignee must be a project member who is not a viewer.' : null,
    dueDate: validDate(dueDate, 'Due date', false),
    milestoneId: milestoneId && !ctx.db.milestones.some((m) => m.id === milestoneId && m.projectId === projectId) ? 'Choose a milestone from this project.' : null,
    estimateDays: estimateDays !== null && (!Number.isInteger(estimateDays) || estimateDays < 1 || estimateDays > 250) ? 'Estimate must be 1–250 working days.' : null,
  });
  return { title, description, priority: priority as Priority, assigneeId, dueDate, milestoneId, estimateDays };
}

route('GET', '/projects/:id/tasks', (ctx) => {
  const { project } = access(ctx, Number(ctx.params.id));
  const rows = applyTaskQuery(ctx, ctx.db.tasks.filter((t) => t.projectId === project.id));
  const page = paginate(rows, ctx.query, 20);
  return ok({ ...page, content: page.content.map((t) => taskDto(ctx.db, t)) });
});

route('GET', '/tasks/mine', (ctx) => {
  const ids = myProjectIds(ctx.db, ctx.me.id);
  const rows = applyTaskQuery(ctx, ctx.db.tasks.filter((t) => ids.has(t.projectId) && t.assigneeId === ctx.me.id));
  const page = paginate(rows, ctx.query, 20);
  return ok({ ...page, content: page.content.map((t) => taskDto(ctx.db, t)) });
});

route('POST', '/projects/:id/tasks', (ctx) => {
  const { db, me } = ctx;
  const { project, role } = access(ctx, Number(ctx.params.id));
  ensure(can.createTask(role), 'Viewers cannot create tasks.');
  const v = validateTask(ctx, project.id, ctx.body);
  const initialCriteria = stringList(ctx.body.acceptanceCriteria, 'acceptanceCriteria', 'Criterion', 20, 500);
  const initialChecklist = stringList(ctx.body.checklist, 'checklist', 'Checklist item', 30, 300);
  const status: TaskStatus = ctx.body.status === 'IN_PROGRESS' ? 'IN_PROGRESS' : 'TODO';
  if (!atLeast(role, 'MANAGER') && v.assigneeId !== null && v.assigneeId !== me.id) {
    throw new HttpError(403, 'Members can only assign new tasks to themselves.');
  }
  project.taskSeq += 1;
  const ts = now();
  const task: TaskRow = {
    id: nextId(db, 'tasks'),
    projectId: project.id,
    number: project.taskSeq,
    ...v,
    status,
    reporterId: me.id,
    position: 0, // set by placeBetween below
    createdAt: ts,
    updatedAt: ts,
    startedAt: status === 'IN_PROGRESS' ? ts : null,
    completedAt: null,
    version: 0,
  };
  placeBetween(columnOf(db, project.id, status), task, undefined, undefined);
  db.tasks.push(task);
  recordTransition(db, task, null, status);
  initialCriteria.forEach((text, position) => db.criteria.push({ id: nextId(db, 'criteria'), taskId: task.id, position, text }));
  initialChecklist.forEach((text, position) =>
    db.checklistItems.push({ id: nextId(db, 'checklistItems'), taskId: task.id, position, text, done: false, doneById: null, doneAt: null }),
  );
  project.updatedAt = ts;
  const key = taskKey(project, task);
  log(ctx, project.id, task.id, 'TASK_CREATED', `created ${key} “${task.title}”`);
  if (task.assigneeId && task.assigneeId !== me.id) {
    const u = db.users.find((x) => x.id === task.assigneeId)!;
    log(ctx, project.id, task.id, 'TASK_ASSIGNED', `assigned ${key} to ${u.name}`);
    notify(ctx, u.id, 'TASK_ASSIGNED', 'New task assigned to you', `${me.name} assigned you ${key} “${task.title}” in ${project.name}.`, taskLink(task));
  }
  // People @mentioned in the description are told (the new assignee already has been).
  notifyMentions(ctx, project, task, task.description, null, task.assigneeId ? [task.assigneeId] : [], 'DESCRIPTION');
  return created(taskDto(db, task), `${key} created.`);
});

route('GET', '/tasks/:id', (ctx) => {
  const { task } = findTask(ctx, Number(ctx.params.id));
  return ok(taskDto(ctx.db, task));
});

route('PUT', '/tasks/:id', (ctx) => {
  const { db, me } = ctx;
  const { task, project, role } = findTask(ctx, Number(ctx.params.id));
  ensure(can.editTask(role, taskLike(task), me.id), 'You can only edit tasks that are assigned to you or that you created.');
  checkVersion(task.version, ctx.body.version);
  const v = validateTask(ctx, project.id, ctx.body);
  if (v.assigneeId !== task.assigneeId) {
    ensure(can.assignTask(role, taskLike(task), me.id, v.assigneeId), 'Only owners and managers can assign tasks to other people.');
  }
  const key = taskKey(project, task);
  // One structured activity per changed field (before → after), like an audit trail.
  const milestoneName = (id: number | null) => (id ? (db.milestones.find((m) => m.id === id)?.name ?? null) : null);
  const userName = (id: number | null) => (id ? (db.users.find((u) => u.id === id)?.name ?? null) : null);
  const changes: FieldChange[] = [];
  if (v.title !== task.title) changes.push({ field: 'title', oldValue: task.title, newValue: v.title });
  if (v.description !== task.description) changes.push({ field: 'description', oldValue: null, newValue: null });
  if (v.priority !== task.priority) changes.push({ field: 'priority', oldValue: PRIORITY_LABEL[task.priority], newValue: PRIORITY_LABEL[v.priority] });
  if (v.dueDate !== task.dueDate) changes.push({ field: 'dueDate', oldValue: task.dueDate, newValue: v.dueDate });
  if (v.milestoneId !== task.milestoneId) changes.push({ field: 'milestone', oldValue: milestoneName(task.milestoneId), newValue: milestoneName(v.milestoneId) });
  if (v.estimateDays !== task.estimateDays) changes.push({ field: 'estimate', oldValue: daysLabel(task.estimateDays), newValue: daysLabel(v.estimateDays) });
  const assigneeChange: FieldChange | null =
    v.assigneeId !== task.assigneeId ? { field: 'assignee', oldValue: userName(task.assigneeId), newValue: userName(v.assigneeId) } : null;
  const oldDescription = task.description;
  Object.assign(task, v);
  touch(task);

  const FIELD_LABEL: Record<string, string> = { title: 'title', description: 'description', priority: 'priority', dueDate: 'due date', milestone: 'milestone', estimate: 'estimate' };
  for (const c of changes) log(ctx, project.id, task.id, 'TASK_UPDATED', `changed the ${FIELD_LABEL[c.field]} of ${key}`, c);
  if (assigneeChange) {
    if (task.assigneeId) {
      const u = db.users.find((x) => x.id === task.assigneeId)!;
      log(ctx, project.id, task.id, 'TASK_ASSIGNED', task.assigneeId === me.id ? `took ${key}` : `assigned ${key}`, assigneeChange);
      notify(ctx, u.id, 'TASK_ASSIGNED', 'Task assigned to you', `${me.name} assigned you ${key} “${task.title}” in ${project.name}.`, taskLink(task));
    } else {
      log(ctx, project.id, task.id, 'TASK_ASSIGNED', `unassigned ${key}`, assigneeChange);
    }
  }
  if (task.description !== oldDescription) {
    // Only people the edit newly mentions are told (and not someone just told they were assigned).
    notifyMentions(ctx, project, task, task.description, oldDescription, assigneeChange && task.assigneeId ? [task.assigneeId] : [], 'DESCRIPTION');
  }
  return ok(taskDto(db, task), 'Task updated.');
});

function changeStatus(ctx: Ctx, task: TaskRow, project: ProjectRow, role: Role, to: TaskStatus, neighbours?: { previousTaskId: number | null; nextTaskId: number | null }) {
  const from = task.status;
  if (from !== to) {
    const blocked = statusChangeBlockedReason(from, to);
    if (blocked && !(from === 'DONE' && atLeast(role, 'MANAGER'))) throw new HttpError(409, blocked, undefined, 'WORKFLOW_VIOLATION');
    ensure(can.changeStatus(role, taskLike(task), ctx.me.id, to), 'Only the assignee or a manager can change this task’s status.');
  } else {
    ensure(can.createTask(role), 'Viewers cannot reorder tasks.');
  }
  task.status = to;
  // Only this task's position changes (fractional ordering); neighbours stay untouched.
  placeBetween(columnOf(ctx.db, project.id, to), task, neighbours?.previousTaskId, neighbours?.nextTaskId);
  if (from !== to) {
    recordTransition(ctx.db, task, from, to);
    if (from === 'DONE') task.completedAt = null;
    if (to === 'IN_PROGRESS' && !task.startedAt) task.startedAt = now();
    touch(task);
    log(ctx, project.id, task.id, 'TASK_STATUS_CHANGED', from === 'DONE' ? `reopened ${taskKey(project, task)}` : `moved ${taskKey(project, task)}`, {
      field: 'status',
      oldValue: STATUS_LABEL[from],
      newValue: STATUS_LABEL[to],
    });
  }
}

route('PATCH', '/tasks/:id/status', (ctx) => {
  const { task, project, role } = findTask(ctx, Number(ctx.params.id));
  const to = ctx.body.status;
  check({ status: oneOf(to, TASK_STATUSES) ? null : 'Choose a valid status.' });
  changeStatus(ctx, task, project, role, to as TaskStatus);
  return ok(taskDto(ctx.db, task), `Moved to ${STATUS_LABEL[task.status]}.`);
});

route('PATCH', '/tasks/:id/move', (ctx) => {
  const { task, project, role } = findTask(ctx, Number(ctx.params.id));
  const to = ctx.body.status;
  const previousTaskId = optNum(ctx.body.previousTaskId);
  const nextTaskId = optNum(ctx.body.nextTaskId);
  const inColumn = (id: number | null) => id === null || ctx.db.tasks.some((t) => t.id === id && t.projectId === project.id && t.status === to && t.id !== task.id);
  check({
    status: oneOf(to, TASK_STATUSES) ? null : 'Choose a valid status.',
    previousTaskId: inColumn(previousTaskId) ? null : 'The previous task must be in the destination column.',
    nextTaskId: inColumn(nextTaskId) ? null : 'The next task must be in the destination column.',
  });
  changeStatus(ctx, task, project, role, to as TaskStatus, { previousTaskId, nextTaskId });
  return ok(taskDto(ctx.db, task));
});

route('DELETE', '/tasks/:id', (ctx) => {
  const { db } = ctx;
  const { task, project, role } = findTask(ctx, Number(ctx.params.id));
  ensure(can.deleteTask(role, taskLike(task), ctx.me.id), 'Only managers can delete tasks (members can delete their own tasks while they are to do).');
  deleteTaskChildren(db, new Set([task.id]));
  db.tasks = db.tasks.filter((t) => t.id !== task.id);
  // Keep the project's history, but detach it from the deleted task.
  for (const a of db.activities) if (a.taskId === task.id) a.taskId = null;
  db.notifications = db.notifications.filter((n) => n.link !== taskLink(task) && !n.link?.startsWith(`${taskLink(task)}#`));
  log(ctx, project.id, null, 'TASK_DELETED', `deleted ${taskKey(project, task)} “${task.title}”`);
  return ok(null, `${taskKey(project, task)} deleted.`);
});

const daysLabel = (d: number | null) => (d === null ? null : `${d} working ${d === 1 ? 'day' : 'days'}`);

// ---------------------------------------------------------------------------
// Planning: apply a previewed scenario atomically (managers only; stale → EDIT_CONFLICT)
// ---------------------------------------------------------------------------

route('POST', '/projects/:id/plan/apply', (ctx) => {
  const { db, me } = ctx;
  const { project, role } = access(ctx, Number(ctx.params.id));
  ensure(atLeast(role, 'MANAGER'), 'Only owners and managers can apply a plan.');
  if (project.status === 'ARCHIVED') throw new HttpError(409, 'Archived projects are read-only.');
  const raw = Array.isArray(ctx.body.changes) ? (ctx.body.changes as Record<string, unknown>[]) : [];
  check({ changes: raw.length === 0 || raw.length > 200 ? 'Choose between 1 and 200 changes.' : null });
  const changes = raw.map((c) => ({
    taskId: optNum(c.taskId),
    version: optNum(c.version),
    dueDate: optStr(c.dueDate),
    assigneeId: optNum(c.assigneeId),
    estimateDays: optNum(c.estimateDays),
    unassign: c.unassign === true,
  }));
  if (new Set(changes.map((c) => c.taskId)).size !== changes.length) throw new HttpError(400, 'Please correct the highlighted fields.', { changes: 'Each task may appear only once in a plan.' });
  const rows = changes.map((c) => db.tasks.find((t) => t.id === c.taskId && t.projectId === project.id));
  if (rows.some((t) => !t) || changes.some((c) => c.version === null)) throw new HttpError(400, 'Please correct the highlighted fields.', { changes: 'A change refers to a task that isn’t in this project.' });
  const tasks = rows as TaskRow[];
  // Stale check over the whole basis the schedule used (every open task + the dependency graph), as on the backend.
  const basis = (ctx.body.basis ?? null) as { tasks?: { taskId?: unknown; version?: unknown }[]; dependencyIds?: unknown[] } | null;
  if (!basis || !Array.isArray(basis.tasks) || !Array.isArray(basis.dependencyIds)) {
    throw new HttpError(400, 'Please correct the highlighted fields.', { basis: 'The plan must say which data it was calculated from.' });
  }
  const seen = new Map(basis.tasks.map((v) => [optNum(v?.taskId), optNum(v?.version)]));
  const projectTasks = db.tasks.filter((t) => t.projectId === project.id);
  const stale = new Set<string>();
  for (const t of projectTasks) {
    const saw = seen.get(t.id);
    if (t.status !== 'DONE' ? saw === undefined || saw !== t.version : saw !== undefined) stale.add(taskKey(project, t));
  }
  tasks.forEach((t, i) => {
    if (t.version !== changes[i].version) stale.add(taskKey(project, t));
  });
  const deletedTasks = [...seen.keys()].some((id) => !projectTasks.some((t) => t.id === id));
  const depsNow = new Set(db.dependencies.filter((d) => d.projectId === project.id).map((d) => d.id));
  const depsSent = new Set(basis.dependencyIds.map((x) => optNum(x)));
  const depsChanged = depsNow.size !== depsSent.size || [...depsNow].some((id) => !depsSent.has(id));
  if (stale.size || deletedTasks || depsChanged) {
    const keys = [...stale].sort();
    const what: string[] = [];
    if (keys.length) what.push(`${keys.join(', ')} ${keys.length === 1 ? 'was' : 'were'} changed`);
    if (deletedTasks) what.push('a task was deleted');
    if (depsChanged) what.push('dependencies were added or removed');
    throw new HttpError(409, `This plan is out of date: ${what.join('; ')} after the scenario was calculated. Recalculate and review it again.`, undefined, 'EDIT_CONFLICT');
  }
  const done = tasks.filter((t) => t.status === 'DONE').map((t) => taskKey(project, t));
  if (done.length) throw new HttpError(409, `Plans only change open work; ${done.join(', ')} ${done.length === 1 ? 'is' : 'are'} already done.`, undefined, 'WORKFLOW_VIOLATION');
  for (const c of changes) {
    if (c.assigneeId !== null) {
      const r = roleOf(db, project.id, c.assigneeId);
      if (!r || r === 'VIEWER') throw new HttpError(400, 'Please correct the highlighted fields.', { changes: 'Assignees must be project members who are not viewers.' });
    }
    if (c.dueDate !== null && !DATE_RE.test(c.dueDate)) throw new HttpError(400, 'Please correct the highlighted fields.', { changes: 'Due dates must be yyyy-MM-dd.' });
    if (c.estimateDays !== null && (c.estimateDays < 1 || c.estimateDays > 250)) throw new HttpError(400, 'Please correct the highlighted fields.', { changes: 'Estimates must be 1–250 working days.' });
  }
  const movedFor = new Map<number, string[]>();
  const changed: TaskRow[] = [];
  tasks.forEach((t, i) => {
    const c = changes[i];
    const key = taskKey(project, t);
    let any = false;
    if (c.dueDate !== null && c.dueDate !== t.dueDate) {
      log(ctx, project.id, t.id, 'PLAN_APPLIED', `rescheduled ${key} from a plan`, { field: 'dueDate', oldValue: t.dueDate, newValue: c.dueDate });
      t.dueDate = c.dueDate;
      any = true;
      if (t.assigneeId) movedFor.set(t.assigneeId, [...(movedFor.get(t.assigneeId) ?? []), key]);
    }
    if (c.estimateDays !== null && c.estimateDays !== t.estimateDays) {
      log(ctx, project.id, t.id, 'PLAN_APPLIED', `re-estimated ${key} from a plan`, { field: 'estimate', oldValue: daysLabel(t.estimateDays), newValue: daysLabel(c.estimateDays) });
      t.estimateDays = c.estimateDays;
      any = true;
    }
    const next = c.unassign ? null : (c.assigneeId ?? t.assigneeId);
    if (next !== t.assigneeId) {
      const name = (id: number | null) => (id ? (db.users.find((u) => u.id === id)?.name ?? null) : null);
      log(ctx, project.id, t.id, 'PLAN_APPLIED', `${next ? 'reassigned' : 'unassigned'} ${key} from a plan`, { field: 'assignee', oldValue: name(t.assigneeId), newValue: name(next) });
      t.assigneeId = next;
      any = true;
      if (next) notify(ctx, next, 'TASK_ASSIGNED', 'Task assigned to you', `${me.name} assigned you ${key} “${t.title}” while re-planning ${project.name}.`, taskLink(t));
    }
    if (any) {
      touch(t);
      changed.push(t);
    }
  });
  const note = optStr(ctx.body.note);
  for (const [uid, keys] of movedFor) {
    notify(ctx, uid, 'PLAN_CHANGED', 'Due dates changed', `${me.name} applied a new plan in ${project.name} that moves ${keys.join(', ')}.${note ? ` Reason: ${note}` : ''}`, `/projects/${project.id}/plan`);
  }
  const n = changed.length;
  return ok({ changedTasks: n, tasks: changed.map((t) => taskDto(db, t)) }, n === 0 ? 'Nothing needed to change.' : `Plan applied to ${n} ${n === 1 ? 'task' : 'tasks'}.`);
});

// ---------------------------------------------------------------------------
// Dependencies (finish-to-start, same project, no cycles)
// ---------------------------------------------------------------------------

route('GET', '/projects/:id/dependencies', (ctx) => {
  const { project } = access(ctx, Number(ctx.params.id));
  return ok(ctx.db.dependencies.filter((d) => d.projectId === project.id).map((d) => dependencyDto(ctx.db, d)));
});

/** Task ids from `from` to `to` along blocker → blocked edges, or [] if unreachable. */
export function dependencyPath(edges: Map<number, number[]>, from: number, to: number): number[] {
  const parent = new Map<number, number | null>([[from, null]]);
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift()!;
    if (cur === to) {
      const out: number[] = [];
      for (let n: number | null = to; n !== null; n = parent.get(n) ?? null) out.unshift(n);
      return out;
    }
    for (const next of edges.get(cur) ?? []) {
      if (!parent.has(next)) {
        parent.set(next, cur);
        queue.push(next);
      }
    }
  }
  return [];
}

route('POST', '/tasks/:id/dependencies', (ctx) => {
  const { db, me } = ctx;
  const { task: blocked, project, role } = findTask(ctx, Number(ctx.params.id));
  ensure(can.editTask(role, taskLike(blocked), me.id), 'You can only change dependencies of tasks that are assigned to you or that you created.');
  if (project.status === 'ARCHIVED') throw new HttpError(409, 'Archived projects are read-only.');
  if (blocked.status === 'DONE') throw new HttpError(409, 'This task is already done, so nothing can block it.', undefined, 'WORKFLOW_VIOLATION');
  const blockerId = optNum(ctx.body.blockerTaskId);
  check({ blockerTaskId: blockerId === null ? 'Choose the task that must finish first.' : blockerId === blocked.id ? 'A task can’t depend on itself.' : null });
  const blocker = db.tasks.find((t) => t.id === blockerId && t.projectId === project.id);
  if (!blocker) throw new HttpError(400, 'Please correct the highlighted fields.', { blockerTaskId: 'Choose a task from this project. Dependencies across projects aren’t supported.' });
  if (db.dependencies.some((d) => d.blockerTaskId === blocker.id && d.blockedTaskId === blocked.id)) {
    throw new HttpError(409, `${taskKey(project, blocked)} already depends on ${taskKey(project, blocker)}.`);
  }
  const edges = new Map<number, number[]>();
  for (const d of db.dependencies.filter((x) => x.projectId === project.id)) edges.set(d.blockerTaskId, [...(edges.get(d.blockerTaskId) ?? []), d.blockedTaskId]);
  const loop = dependencyPath(edges, blocked.id, blocker.id);
  if (loop.length) {
    const names = [...loop, blocked.id].map((id) => taskKey(project, db.tasks.find((t) => t.id === id)!));
    throw new HttpError(400, 'Please correct the highlighted fields.', { blockerTaskId: `That would create a loop: ${names.join(' → ')}. Remove one of these dependencies first.` });
  }
  const row = { id: nextId(db, 'dependencies'), projectId: project.id, blockerTaskId: blocker.id, blockedTaskId: blocked.id, createdById: me.id, createdAt: now() };
  db.dependencies.push(row);
  log(ctx, project.id, blocked.id, 'DEPENDENCY_ADDED', `made ${taskKey(project, blocked)} depend on ${taskKey(project, blocker)}`, { field: 'dependency', oldValue: null, newValue: taskKey(project, blocker) });
  return created(dependencyDto(db, row), 'Dependency added.');
});

route('DELETE', '/dependencies/:id', (ctx) => {
  const { db, me } = ctx;
  const d = db.dependencies.find((x) => x.id === Number(ctx.params.id));
  if (!d) throw new HttpError(404, 'Dependency not found.');
  const { task: blocked, project, role } = findTask(ctx, d.blockedTaskId);
  ensure(can.editTask(role, taskLike(blocked), me.id), 'You can only change dependencies of tasks that are assigned to you or that you created.');
  if (project.status === 'ARCHIVED') throw new HttpError(409, 'Archived projects are read-only.');
  const blocker = db.tasks.find((t) => t.id === d.blockerTaskId)!;
  db.dependencies = db.dependencies.filter((x) => x.id !== d.id);
  log(ctx, project.id, blocked.id, 'DEPENDENCY_REMOVED', `removed ${taskKey(project, blocked)}’s dependency on ${taskKey(project, blocker)}`, { field: 'dependency', oldValue: taskKey(project, blocker), newValue: null });
  return ok(null, 'Dependency removed.');
});

// ---------------------------------------------------------------------------
// Acceptance criteria and checklist
// ---------------------------------------------------------------------------

function requireEditable(ctx: Ctx, task: TaskRow, role: Role, what: string) {
  ensure(can.editTask(role, taskLike(task), ctx.me.id), 'You can only edit tasks that are assigned to you or that you created.');
  if (task.status === 'IN_REVIEW') throw new HttpError(409, `${what} are locked while the task is in review.`, undefined, 'WORKFLOW_VIOLATION');
  if (task.status === 'DONE') throw new HttpError(409, `Reopen the task to change its ${what.toLowerCase()}.`, undefined, 'WORKFLOW_VIOLATION');
}

interface ItemInput {
  id: number | null;
  text: string;
  done: boolean;
}

function itemInputs(v: unknown, maxItems: number, maxLength: number, label: string): ItemInput[] {
  const raw = Array.isArray(v) ? (v as Record<string, unknown>[]) : null;
  const items = (raw ?? []).map((x) => ({ id: optNum(x?.id), text: str(x?.text), done: x?.done === true }));
  check({
    items: !raw
      ? 'Items are required.'
      : items.length > maxItems
        ? `Add at most ${maxItems} ${label}.`
        : items.some((x) => !x.text)
          ? 'Every item needs text.'
          : items.some((x) => x.text.length > maxLength)
            ? `Each item must be at most ${maxLength} characters.`
            : null,
  });
  return items;
}

route('PUT', '/tasks/:id/criteria', (ctx) => {
  const { db } = ctx;
  const { task, project, role } = findTask(ctx, Number(ctx.params.id));
  requireEditable(ctx, task, role, 'Acceptance criteria');
  checkVersion(task.version, ctx.body.version);
  const items = itemInputs(ctx.body.items, 20, 500, 'criteria');
  const before = db.criteria.filter((c) => c.taskId === task.id);
  const kept = new Map(before.map((c) => [c.id, c]));
  const next = items.map((it, position) => {
    const existing = it.id !== null ? kept.get(it.id) : undefined;
    return existing ? { ...existing, position, text: it.text } : { id: nextId(db, 'criteria'), taskId: task.id, position, text: it.text };
  });
  db.criteria = [...db.criteria.filter((c) => c.taskId !== task.id), ...next];
  touch(task);
  log(ctx, project.id, task.id, 'CRITERIA_UPDATED', `updated the acceptance criteria of ${taskKey(project, task)}`, {
    field: 'criteria',
    oldValue: `${before.length} criteria`,
    newValue: `${next.length} criteria`,
  });
  return ok(taskDto(db, task), 'Acceptance criteria saved.');
});

function checklistSummary(items: { done: boolean }[]) {
  return `${items.filter((i) => i.done).length}/${items.length} done`;
}

route('PUT', '/tasks/:id/checklist', (ctx) => {
  const { db, me } = ctx;
  const { task, project, role } = findTask(ctx, Number(ctx.params.id));
  requireEditable(ctx, task, role, 'Checklist items');
  checkVersion(task.version, ctx.body.version);
  const items = itemInputs(ctx.body.items, 30, 300, 'checklist items');
  const kept = new Map(db.checklistItems.filter((c) => c.taskId === task.id).map((c) => [c.id, c]));
  const ts = now();
  const next = items.map((it, position) => {
    const existing = it.id !== null ? kept.get(it.id) : undefined;
    const wasDone = existing?.done ?? false;
    return {
      id: existing?.id ?? nextId(db, 'checklistItems'),
      taskId: task.id,
      position,
      text: it.text,
      done: it.done,
      doneById: it.done ? (wasDone ? (existing?.doneById ?? me.id) : me.id) : null,
      doneAt: it.done ? (wasDone ? (existing?.doneAt ?? ts) : ts) : null,
    };
  });
  db.checklistItems = [...db.checklistItems.filter((c) => c.taskId !== task.id), ...next];
  touch(task);
  log(ctx, project.id, task.id, 'CHECKLIST_UPDATED', `edited the checklist of ${taskKey(project, task)}`, {
    field: 'checklist',
    oldValue: null,
    newValue: checklistSummary(next),
  });
  return ok(taskDto(db, task), 'Checklist saved.');
});

route('PATCH', '/checklist-items/:id', (ctx) => {
  const { db, me } = ctx;
  const item = db.checklistItems.find((c) => c.id === Number(ctx.params.id));
  if (!item) throw new HttpError(404, 'Checklist item not found.');
  const { task, project, role } = findTask(ctx, item.taskId);
  ensure(can.editTask(role, taskLike(task), me.id), 'Only the assignee, the reporter or a manager can tick checklist items.');
  if (task.status === 'IN_REVIEW' || task.status === 'DONE') {
    throw new HttpError(409, 'The checklist is locked while the task is in review or done.', undefined, 'WORKFLOW_VIOLATION');
  }
  const siblings = db.checklistItems.filter((c) => c.taskId === task.id);
  const before = checklistSummary(siblings);
  const done = ctx.body.done === true;
  if (done && !item.done) {
    item.doneById = me.id;
    item.doneAt = now();
  } else if (!done) {
    item.doneById = null;
    item.doneAt = null;
  }
  item.done = done;
  touch(task);
  log(ctx, project.id, task.id, 'CHECKLIST_UPDATED', `${done ? 'ticked' : 'unticked'} “${item.text}” on ${taskKey(project, task)}`, {
    field: 'checklist',
    oldValue: before,
    newValue: checklistSummary(siblings),
  });
  return ok(taskDto(db, task));
});

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

route('GET', '/tasks/:id/comments', (ctx) => {
  const { task } = findTask(ctx, Number(ctx.params.id));
  const rows = ctx.db.comments.filter((c) => c.taskId === task.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return ok(rows.map((c) => commentDto(ctx.db, c)));
});

/** Where this task is mentioned: other tasks' descriptions and comments, in the caller's projects only. */
route('GET', '/tasks/:id/mentions', (ctx) => {
  const { db } = ctx;
  const { task, project } = findTask(ctx, Number(ctx.params.id));
  const key = taskKey(project, task);
  const mine = myProjectIds(db, ctx.me.id);
  const projectOf = new Map(db.projects.map((p) => [p.id, p]));
  const out: TaskMention[] = [];
  const row = (t: TaskRow, source: TaskMention['source'], text: string, authorId: number, at: string, commentId: number | null): TaskMention => {
    const p = projectOf.get(t.projectId)!;
    const author = db.users.find((u) => u.id === authorId);
    return {
      source,
      taskId: t.id,
      taskKey: taskKey(p, t),
      taskTitle: t.title,
      taskStatus: t.status,
      projectId: p.id,
      projectName: p.name,
      commentId,
      author: author ? userSummary(author) : null,
      excerpt: excerpt(text, key, 160),
      at,
    };
  };
  for (const t of db.tasks) {
    if (t.id === task.id || !mine.has(t.projectId) || !t.description?.includes(key)) continue;
    if (taskKeysIn(t.description).includes(key)) out.push(row(t, 'DESCRIPTION', t.description, t.reporterId, t.updatedAt, null));
  }
  for (const c of db.comments) {
    const t = db.tasks.find((x) => x.id === c.taskId);
    if (!t || t.id === task.id || !mine.has(t.projectId) || !c.body.includes(key)) continue;
    if (taskKeysIn(c.body).includes(key)) out.push(row(t, 'COMMENT', c.body, c.authorId, c.createdAt, c.id));
  }
  out.sort((a, b) => b.at.localeCompare(a.at));
  return ok(out.slice(0, 30));
});

route('POST', '/tasks/:id/comments', (ctx) => {
  const { db, me } = ctx;
  const { task, project, role } = findTask(ctx, Number(ctx.params.id));
  ensure(can.comment(role), 'Viewers cannot comment.');
  const body = str(ctx.body.body);
  check({ body: length(body, 'Comment', 1, 2000) });
  const c = { id: nextId(db, 'comments'), taskId: task.id, authorId: me.id, body, createdAt: now(), updatedAt: null };
  db.comments.push(c);
  const key = taskKey(project, task);
  log(ctx, project.id, task.id, 'COMMENT_ADDED', `commented on ${key}`);
  const preview = excerpt(body, null, 80);
  // People @mentioned are told they were mentioned instead of being told about a new comment.
  const anchor = `#comment-${c.id}`;
  const mentioned = notifyMentions(ctx, project, task, body, null, [], 'COMMENT', anchor);
  for (const recipient of new Set([task.assigneeId, task.reporterId])) {
    if (recipient && !mentioned.includes(recipient)) notify(ctx, recipient, 'COMMENT', 'New comment', `${me.name} commented on ${key}: “${preview}”`, taskLink(task) + anchor);
  }
  return created(commentDto(db, c), 'Comment added.');
});

function findComment(ctx: Ctx) {
  const c = ctx.db.comments.find((x) => x.id === Number(ctx.params.id));
  if (!c) throw new HttpError(404, 'Comment not found.');
  const { role } = findTask(ctx, c.taskId);
  return { c, role };
}

route('PUT', '/comments/:id', (ctx) => {
  const { c } = findComment(ctx);
  ensure(c.authorId === ctx.me.id, 'You can only edit your own comments.');
  const body = str(ctx.body.body);
  check({ body: length(body, 'Comment', 1, 2000) });
  const before = c.body;
  c.body = body;
  c.updatedAt = now();
  const { task, project } = findTask(ctx, c.taskId);
  notifyMentions(ctx, project, task, body, before, [], 'COMMENT', `#comment-${c.id}`);
  return ok(commentDto(ctx.db, c), 'Comment updated.');
});

route('DELETE', '/comments/:id', (ctx) => {
  const { c, role } = findComment(ctx);
  ensure(c.authorId === ctx.me.id || atLeast(role, 'MANAGER'), 'You can only delete your own comments.');
  ctx.db.comments = ctx.db.comments.filter((x) => x.id !== c.id);
  return ok(null, 'Comment deleted.');
});

// ---------------------------------------------------------------------------
// Submissions & reviews
// ---------------------------------------------------------------------------

const MAX_FILES = 5;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_STORED_BYTES = 512 * 1024;

async function fileToDataUrl(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${file.type || 'application/octet-stream'};base64,${btoa(binary)}`;
}

route('GET', '/tasks/:id/submissions', (ctx) => {
  const { task } = findTask(ctx, Number(ctx.params.id));
  const rows = ctx.db.submissions.filter((s) => s.taskId === task.id).sort((a, b) => b.version - a.version);
  return ok(rows.map((s) => submissionDto(ctx.db, s)));
});

route('POST', '/tasks/:id/submissions', async (ctx) => {
  const { db, me } = ctx;
  const { task, project, role } = findTask(ctx, Number(ctx.params.id));

  // Accept multipart (part "data" = JSON, parts "files") like the backend, or plain JSON.
  let data: Record<string, unknown> = ctx.body;
  let files: File[] = [];
  if (ctx.rawBody instanceof FormData) {
    const part = ctx.rawBody.get('data');
    const json = part instanceof Blob ? await part.text() : typeof part === 'string' ? part : '{}';
    data = JSON.parse(json) as Record<string, unknown>;
    files = ctx.rawBody.getAll('files').filter((f): f is File => f instanceof File);
  }

  if (task.status === 'IN_REVIEW') throw new HttpError(409, 'This task already has a submission awaiting review.', undefined, 'WORKFLOW_VIOLATION');
  if (task.status === 'DONE') throw new HttpError(409, 'This task is already done.', undefined, 'WORKFLOW_VIOLATION');
  ensure(can.submitWork(role, taskLike(task), me.id), 'Only the assignee can submit work for this task.');

  const openItems = db.checklistItems.filter((c) => c.taskId === task.id && !c.done).sort((a, b) => a.position - b.position);
  if (openItems.length > 0) {
    throw new HttpError(409, `Complete the checklist before submitting. Still open: ${openItems.map((c) => c.text).join('; ')}.`, undefined, 'WORKFLOW_VIOLATION');
  }

  const notes = str(data.notes);
  const LINK_KINDS: EvidenceKind[] = ['REPOSITORY', 'DEPLOYMENT', 'LINK'];
  const rawEvidence = Array.isArray(data.evidence) ? (data.evidence as Record<string, unknown>[]) : [];
  const links = rawEvidence
    .map((e) => ({ kind: e?.kind as EvidenceKind, label: str(e?.label), url: str(e?.url) }))
    .filter((e) => e.url);
  const errors: Record<string, string | null> = {
    notes: length(notes, 'Notes', 10, 5000),
    files: files.length > MAX_FILES ? `Attach at most ${MAX_FILES} files.` : files.some((f) => f.size > MAX_FILE_BYTES) ? 'Each file must be 10 MB or smaller.' : null,
    evidence: links.length === 0 && files.length === 0 ? 'Add at least one piece of evidence: a link or a file.' : links.length > 12 ? 'Add at most 12 links.' : null,
  };
  links.forEach((l, i) => {
    let valid = LINK_KINDS.includes(l.kind);
    try {
      const u = new URL(l.url);
      valid = valid && ['http:', 'https:'].includes(u.protocol) && !!u.hostname;
    } catch {
      valid = false;
    }
    if (!valid) errors[`evidence.${i}`] = `Link ${i + 1} must be a full http(s) URL.`;
  });
  check(errors);

  const version = db.submissions.filter((s) => s.taskId === task.id).length + 1;
  const submission = {
    id: nextId(db, 'submissions'),
    taskId: task.id,
    version,
    submittedById: me.id,
    notes,
    status: 'PENDING' as const,
    createdAt: now(),
  };
  db.submissions.push(submission);
  // Snapshot the acceptance criteria: later edits to the task never rewrite what was reviewed.
  for (const c of db.criteria.filter((x) => x.taskId === task.id).sort((a, b) => a.position - b.position)) {
    db.submissionCriteria.push({ id: nextId(db, 'submissionCriteria'), submissionId: submission.id, criterionId: c.id, position: c.position, text: c.text });
  }
  let position = 0;
  for (const l of links) {
    const label = l.label || (l.kind === 'REPOSITORY' ? 'Repository' : l.kind === 'DEPLOYMENT' ? 'Deployed app' : new URL(l.url).hostname);
    db.evidence.push({ id: nextId(db, 'evidence'), submissionId: submission.id, position: position++, kind: l.kind, label: label.slice(0, 120), url: l.url, attachmentId: null });
  }
  for (const f of files) {
    const attachmentId = nextId(db, 'attachments');
    db.attachments.push({
      id: attachmentId,
      submissionId: submission.id,
      fileName: f.name,
      size: f.size,
      contentType: f.type || 'application/octet-stream',
      dataUrl: f.size <= MAX_STORED_BYTES ? await fileToDataUrl(f) : null,
    });
    const kind: EvidenceKind = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(f.type) ? 'SCREENSHOT' : 'FILE';
    db.evidence.push({ id: nextId(db, 'evidence'), submissionId: submission.id, position: position++, kind, label: f.name.slice(0, 120), url: null, attachmentId });
  }
  moveToColumnEnd(db, task, 'IN_REVIEW');
  const key = taskKey(project, task);
  log(ctx, project.id, task.id, 'SUBMISSION_CREATED', `submitted ${key} for review${version > 1 ? ` (v${version})` : ''}`);
  for (const r of reviewersOf(db, project.id)) {
    notify(ctx, r, 'SUBMISSION', 'Work submitted for review', `${me.name} submitted ${key} “${task.title}” for review (version ${version}).`, taskLink(task));
  }
  return created(submissionDto(db, submission), 'Submitted for review.');
});

route('POST', '/submissions/:id/review', (ctx) => {
  const { db, me } = ctx;
  const submission = db.submissions.find((s) => s.id === Number(ctx.params.id));
  if (!submission) throw new HttpError(404, 'Submission not found.');
  const { task, project, role } = findTask(ctx, submission.taskId);
  if (submission.status !== 'PENDING') throw new HttpError(409, 'This submission has already been reviewed.', undefined, 'WORKFLOW_VIOLATION');
  ensure(atLeast(role, 'MANAGER'), 'Only owners and managers can review submissions.');
  ensure(submission.submittedById !== me.id, 'You cannot review your own submission. Ask another manager or the owner.');
  const decision = ctx.body.decision;
  const feedback = optStr(ctx.body.feedback);
  check({
    decision: oneOf(decision, ['APPROVED', 'CHANGES_REQUESTED'] as ReviewDecision[]) ? null : 'Choose a decision.',
    feedback:
      decision === 'CHANGES_REQUESTED' && (!feedback || feedback.length < 10)
        ? 'Explain what needs to change (at least 10 characters).'
        : feedback && feedback.length > 5000
          ? 'Feedback must be at most 5000 characters.'
          : null,
  });
  const criteria = db.submissionCriteria.filter((c) => c.submissionId === submission.id);
  const rawResults = Array.isArray(ctx.body.results) ? (ctx.body.results as Record<string, unknown>[]) : [];
  const results = new Map<number, { submissionCriterionId: number; met: boolean; note: string | null }>();
  for (const r of rawResults) {
    const id = optNum(r?.submissionCriterionId);
    if (id === null || !criteria.some((c) => c.id === id)) {
      throw new HttpError(400, 'Please correct the highlighted fields.', { results: 'A result refers to a criterion that isn’t part of this submission.' });
    }
    results.set(id, { submissionCriterionId: id, met: r.met === true, note: optStr(r.note) });
  }
  if (decision === 'APPROVED') {
    if (criteria.some((c) => !results.has(c.id))) {
      throw new HttpError(400, 'Please correct the highlighted fields.', { results: 'Mark every acceptance criterion before approving.' });
    }
    const unmet = criteria.filter((c) => !results.get(c.id)!.met);
    if (unmet.length > 0) {
      throw new HttpError(409, `All acceptance criteria must be met to approve. Not met: ${unmet.map((c) => c.text).join('; ')}.`, undefined, 'WORKFLOW_VIOLATION');
    }
  }
  const ts = now();
  db.reviews.push({
    id: nextId(db, 'reviews'),
    submissionId: submission.id,
    reviewerId: me.id,
    decision: decision as ReviewDecision,
    feedback,
    createdAt: ts,
    results: [...results.values()],
  });
  const key = taskKey(project, task);
  if (decision === 'APPROVED') {
    submission.status = 'APPROVED';
    moveToColumnEnd(db, task, 'DONE');
    task.completedAt = ts;
    log(ctx, project.id, task.id, 'REVIEW_APPROVED', `approved ${key} (v${submission.version}); task is Done`);
    notify(ctx, submission.submittedById, 'REVIEW_APPROVED', 'Submission approved', `${me.name} approved ${key} “${task.title}”.`, taskLink(task));
  } else {
    submission.status = 'CHANGES_REQUESTED';
    moveToColumnEnd(db, task, 'IN_PROGRESS');
    log(ctx, project.id, task.id, 'REVIEW_CHANGES_REQUESTED', `requested changes on ${key} (v${submission.version})`);
    notify(ctx, submission.submittedById, 'CHANGES_REQUESTED', 'Changes requested', `${me.name} requested changes on ${key} “${task.title}”.`, taskLink(task));
  }
  // The review request is handled: mark reviewers' notifications for it as read.
  for (const n of db.notifications) if (n.type === 'SUBMISSION' && n.link === taskLink(task)) n.read = true;
  return ok(submissionDto(db, submission), decision === 'APPROVED' ? `${key} approved and marked Done.` : 'Changes requested.');
});

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------

const newestFirst = (a: ActivityRow, b: ActivityRow) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id;

route('GET', '/projects/:id/activity', (ctx) => {
  const { project } = access(ctx, Number(ctx.params.id));
  const rows = ctx.db.activities.filter((a) => a.projectId === project.id).sort(newestFirst);
  const page = paginate(rows, ctx.query, 25);
  return ok({ ...page, content: page.content.map((a) => activityDto(ctx.db, a)) });
});

route('GET', '/tasks/:id/activity', (ctx) => {
  const { task } = findTask(ctx, Number(ctx.params.id));
  const rows = ctx.db.activities.filter((a) => a.taskId === task.id).sort(newestFirst);
  return ok(rows.map((a) => activityDto(ctx.db, a)));
});

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

const CATEGORY_TYPES: Record<Exclude<NotificationCategory, 'ALL' | 'UNREAD'>, NotificationType[]> = {
  ASSIGNMENTS: ['TASK_ASSIGNED', 'PLAN_CHANGED'],
  INVITATIONS: ['INVITATION'],
  SUBMISSIONS: ['SUBMISSION'],
  REVIEWS: ['REVIEW_APPROVED', 'CHANGES_REQUESTED'],
  MENTIONS: ['MENTION'],
};

route('GET', '/notifications', (ctx) => {
  const category = (ctx.query.get('category') ?? 'ALL') as NotificationCategory;
  const rows = ctx.db.notifications
    .filter((n) => n.userId === ctx.me.id)
    .filter((n) => {
      if (category === 'ALL') return true;
      if (category === 'UNREAD') return !n.read;
      return CATEGORY_TYPES[category]?.includes(n.type) ?? true;
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id);
  const page = paginate(rows, ctx.query, 20);
  return ok({ ...page, content: page.content.map((n) => notificationDto(ctx.db, n)) });
});

route('GET', '/notifications/unread-count', (ctx) => ok({ count: ctx.db.notifications.filter((n) => n.userId === ctx.me.id && !n.read).length }));

function findNotification(ctx: Ctx) {
  const n = ctx.db.notifications.find((x) => x.id === Number(ctx.params.id) && x.userId === ctx.me.id);
  if (!n) throw new HttpError(404, 'Notification not found.');
  return n;
}

route('PATCH', '/notifications/:id/read', (ctx) => {
  const n = findNotification(ctx);
  n.read = ctx.body.read !== false;
  return ok(notificationDto(ctx.db, n));
});

route('POST', '/notifications/read-all', (ctx) => {
  let count = 0;
  for (const n of ctx.db.notifications) {
    if (n.userId === ctx.me.id && !n.read) {
      n.read = true;
      count++;
    }
  }
  return ok({ count }, count ? `Marked ${count} notification${count === 1 ? '' : 's'} as read.` : 'You’re all caught up.');
});

route('DELETE', '/notifications/:id', (ctx) => {
  const n = findNotification(ctx);
  ctx.db.notifications = ctx.db.notifications.filter((x) => x.id !== n.id);
  return ok(null, 'Notification deleted.');
});

// ---------------------------------------------------------------------------
// Analytics & calendar
// ---------------------------------------------------------------------------

route('GET', '/projects/:id/history', (ctx) => {
  const { project } = access(ctx, Number(ctx.params.id));
  const rows = ctx.db.statusEvents
    .filter((e) => e.projectId === project.id)
    .sort((a, b) => a.at.localeCompare(b.at) || a.id - b.id)
    .map((e) => ({ taskId: e.taskId, from: e.from, to: e.to, at: e.at }));
  return ok(rows);
});

// Changes since a moment, normalised for replaying the forecast as of then ("Why the date moved"), as the server does.
route('GET', '/projects/:id/changes', (ctx) => {
  const { project } = access(ctx, Number(ctx.params.id));
  const now = Date.now();
  const asked = ctx.query.get('since') ? Date.parse(ctx.query.get('since')!) : NaN;
  const floor = now - 90 * 86_400_000;
  const from = Number.isNaN(asked) || asked < floor ? floor : Math.min(asked, now);
  const tasks = ctx.db.tasks.filter((t) => t.projectId === project.id);
  const keyById = new Map(tasks.map((t) => [t.id, taskKey(project, t)]));
  const idByKey = new Map(tasks.map((t) => [taskKey(project, t), t.id]));
  const names = new Map<string, number | null>();
  for (const m of ctx.db.memberships.filter((x) => x.projectId === project.id)) {
    const u = ctx.db.users.find((x) => x.id === m.userId);
    if (u) names.set(u.name, names.has(u.name) ? null : u.id);
  }
  const rows = ctx.db.activities
    .filter((a) => a.projectId === project.id && Date.parse(a.createdAt) > from)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id);
  const num = (v: string | null) => (v === null ? null : (/^\s*(\d{1,4})/.exec(v)?.[1] ?? null));
  const changes = [];
  const deleted = [];
  for (const a of rows) {
    if (a.type === 'TASK_DELETED') {
      const k = /deleted ([A-Z][A-Z0-9]{1,9}-\d{1,6})/.exec(a.message)?.[1];
      if (k) deleted.push({ key: k, at: a.createdAt });
      continue;
    }
    if (!a.field || !['estimate', 'dueDate', 'priority', 'assignee', 'dependency'].includes(a.field) || a.taskId === null || !keyById.has(a.taskId)) continue;
    let oldValue = a.oldValue;
    let newValue = a.newValue;
    let oldUserId: number | null = null;
    let newUserId: number | null = null;
    let blockerId: number | null = null;
    if (a.field === 'estimate') [oldValue, newValue] = [num(oldValue), num(newValue)];
    if (a.field === 'priority') [oldValue, newValue] = [oldValue?.toUpperCase() ?? null, newValue?.toUpperCase() ?? null];
    if (a.field === 'assignee') [oldUserId, newUserId] = [oldValue ? (names.get(oldValue) ?? null) : null, newValue ? (names.get(newValue) ?? null) : null];
    if (a.field === 'dependency') blockerId = idByKey.get((newValue ?? oldValue ?? '').toUpperCase()) ?? null;
    changes.push({ taskId: a.taskId, taskKey: keyById.get(a.taskId)!, field: a.field, oldValue, newValue, oldUserId, newUserId, blockerId, at: a.createdAt });
  }
  return ok({ since: new Date(from).toISOString(), changes: changes.slice(0, 5000), deleted, truncated: changes.length > 5000 });
});

// Project documents, with the server's rules: drafts for their author and managers only, approval
// by owners and managers, and a change to an approved document's text making it a draft again.
type DocRow = NonNullable<MockDb['documents']>[number];
const docSeen = (role: Role, me: number, d: DocRow) => d.status === 'APPROVED' || atLeast(role, 'MANAGER') || d.createdBy === me;
const docEditable = (role: Role, me: number, d: DocRow) => atLeast(role, 'MANAGER') || (role === 'MEMBER' && d.status === 'DRAFT' && d.createdBy === me);
function docDto(ctx: Ctx, role: Role, d: DocRow) {
  const who = (id: number | null) => {
    const u = id === null ? undefined : ctx.db.users.find((x) => x.id === id);
    return u ? userSummary(u) : null;
  };
  return {
    id: d.id, projectId: d.projectId, title: d.title, body: d.body, status: d.status, createdBy: who(d.createdBy), createdAt: d.createdAt, updatedBy: who(d.updatedBy), updatedAt: d.updatedAt,
    approvedBy: who(d.approvedBy), approvedAt: d.approvedAt, version: d.version, passages: d.passages,
    canEdit: docEditable(role, ctx.me.id, d), canApprove: atLeast(role, 'MANAGER'), canDelete: docEditable(role, ctx.me.id, d),
  };
}
function docPassages(db: MockDb, body: string) {
  let next = Math.max(0, ...(db.documents ?? []).flatMap((d) => d.passages.map((p) => p.id)));
  return splitDocument(body).map((p) => ({ id: ++next, ordinal: p.ordinal, heading: p.heading, content: p.content }));
}
function findDoc(ctx: Ctx) {
  const { project, role } = access(ctx, Number(ctx.params.id));
  const d = (ctx.db.documents ?? []).find((x) => x.id === Number(ctx.params.docId) && x.projectId === project.id);
  if (!d || !docSeen(role, ctx.me.id, d)) throw new HttpError(404, 'Document not found.');
  return { project, role, d };
}
function docBody(ctx: Ctx) {
  const title = String(ctx.body.title ?? '').trim();
  const body = String(ctx.body.body ?? '').trim();
  const errors: Record<string, string> = {};
  if (!title) errors.title = 'Give the document a title.';
  else if (title.length > 160) errors.title = 'Keep the title under 160 characters.';
  if (!body) errors.body = 'The document has no text.';
  else if (body.length > 200_000) errors.body = 'A document can be at most 200,000 characters; split it into parts.';
  if (Object.keys(errors).length) throw new HttpError(400, 'Please correct the highlighted fields.', errors);
  return { title, body };
}

route('GET', '/projects/:id/documents', (ctx) => {
  const { project, role } = access(ctx, Number(ctx.params.id));
  const rows = (ctx.db.documents ?? []).filter((d) => d.projectId === project.id && docSeen(role, ctx.me.id, d)).sort((a, b) => a.title.localeCompare(b.title) || a.id - b.id);
  return ok(
    rows.map((d) => {
      const x = docDto(ctx, role, d);
      return { id: d.id, title: d.title, status: d.status, chars: d.body.length, passages: d.passages.length, updatedBy: x.updatedBy, updatedAt: d.updatedAt, approvedBy: x.approvedBy, approvedAt: d.approvedAt, mine: d.createdBy === ctx.me.id, version: d.version };
    }),
  );
});

route('POST', '/projects/:id/documents', (ctx) => {
  const { project, role } = access(ctx, Number(ctx.params.id));
  ensure(atLeast(role, 'MEMBER'), 'Viewers can read documents but not add them.');
  const { title, body } = docBody(ctx);
  const at = now();
  const id = Math.max(0, ...(ctx.db.documents ?? []).map((d) => d.id)) + 1;
  const d: DocRow = { id, projectId: project.id, title, body, status: 'DRAFT', createdBy: ctx.me.id, createdAt: at, updatedBy: ctx.me.id, updatedAt: at, approvedBy: null, approvedAt: null, version: 0, passages: docPassages(ctx.db, body) };
  (ctx.db.documents ??= []).push(d);
  log(ctx, project.id, null, 'DOCUMENT_SAVED', `added the document “${title}” as a draft`);
  return ok(docDto(ctx, role, d), 'Saved as a draft. Flurry reads it once an owner or manager approves it.');
});

route('GET', '/projects/:id/documents/:docId', (ctx) => {
  const { role, d } = findDoc(ctx);
  return ok(docDto(ctx, role, d));
});

route('PUT', '/projects/:id/documents/:docId', (ctx) => {
  const { project, role, d } = findDoc(ctx);
  ensure(docEditable(role, ctx.me.id, d), d.status === 'APPROVED' ? 'Only owners and managers can change an approved document.' : 'Only the author, owners and managers can change this draft.');
  const version = ctx.body.version;
  if (version !== null && version !== undefined && Number(version) !== d.version) throw new HttpError(409, 'Someone changed this document since you opened it. Reload to see their version.', undefined, 'EDIT_CONFLICT');
  const { title, body } = docBody(ctx);
  const textChanged = body !== d.body;
  const backToDraft = textChanged && d.status === 'APPROVED';
  Object.assign(d, { title, body, updatedBy: ctx.me.id, updatedAt: now(), version: d.version + 1 });
  if (backToDraft) Object.assign(d, { status: 'DRAFT', approvedBy: null, approvedAt: null });
  if (textChanged) d.passages = docPassages(ctx.db, body);
  log(ctx, project.id, null, 'DOCUMENT_SAVED', `edited the document “${title}”${backToDraft ? ', which needs approving again' : ''}`);
  return ok(docDto(ctx, role, d), 'Saved.');
});

route('PUT', '/projects/:id/documents/:docId/approval', (ctx) => {
  const { project, role } = access(ctx, Number(ctx.params.id));
  ensure(atLeast(role, 'MANAGER'), 'Only owners and managers approve documents for Flurry.');
  const d = (ctx.db.documents ?? []).find((x) => x.id === Number(ctx.params.docId) && x.projectId === project.id);
  if (!d) throw new HttpError(404, 'Document not found.');
  const approved = ctx.body.approved === true;
  if ((d.status === 'APPROVED') !== approved) {
    Object.assign(d, approved ? { status: 'APPROVED', approvedBy: ctx.me.id, approvedAt: now() } : { status: 'DRAFT', approvedBy: null, approvedAt: null });
    d.version += 1;
    log(ctx, project.id, null, 'DOCUMENT_APPROVED', `${approved ? 'approved the document “' : 'withdrew approval of the document “'}${d.title}”`);
  }
  return ok(docDto(ctx, role, d), approved ? 'Approved: Flurry can search it now.' : 'Approval withdrawn: Flurry no longer reads it.');
});

route('DELETE', '/projects/:id/documents/:docId', (ctx) => {
  const { project, role, d } = findDoc(ctx);
  ensure(docEditable(role, ctx.me.id, d), 'Only owners and managers can delete an approved document, or the author their draft.');
  ctx.db.documents = (ctx.db.documents ?? []).filter((x) => x.id !== d.id);
  log(ctx, project.id, null, 'DOCUMENT_DELETED', `deleted the document “${d.title}”`);
  return { data: null, status: 204 };
});

// The blocker journey's counts, as the server keeps them: the step and the kinds, nothing else.
const JOURNEY_STEPS = new Set(['shown', 'evidence', 'impact', 'previewed', 'confirmed', 'dismissed']);
const JOURNEY_BLOCKERS = new Set(['review', 'late', 'in-progress', 'not-started', 'last']);
const JOURNEY_RESPONSES = new Set(['review-now', 'ask-review', 'cut-scope', 'reassign', 'take-it', 'ask-owner']);
route('POST', '/projects/:id/journey', (ctx) => {
  const { project } = access(ctx, Number(ctx.params.id));
  const step = String(ctx.body.step ?? '');
  const blockerKind = ctx.body.blockerKind == null ? null : String(ctx.body.blockerKind);
  const option = ctx.body.option == null ? null : String(ctx.body.option);
  if (!JOURNEY_STEPS.has(step)) throw new HttpError(400, 'Unknown step.', { step: 'Unknown step.' });
  if (blockerKind !== null && !JOURNEY_BLOCKERS.has(blockerKind)) throw new HttpError(400, 'Unknown kind of blocker.', { blockerKind: 'Unknown kind of blocker.' });
  if (option !== null && !JOURNEY_RESPONSES.has(option)) throw new HttpError(400, 'Unknown response.', { option: 'Unknown response.' });
  (ctx.db.journey ??= []).push({ projectId: project.id, step, blockerKind, option, createdAt: new Date().toISOString() });
  return { data: null, status: 204 };
});

route('GET', '/projects/:id/journey', (ctx) => {
  const { project, role } = access(ctx, Number(ctx.params.id));
  ensure(atLeast(role, 'MANAGER'), 'Only the project’s owners and managers can see how the blocker journey is used.');
  const days = Math.max(1, Math.min(180, Number(ctx.query.get('days')) || 30));
  const since = Date.now() - days * 86_400_000;
  const steps: Record<string, number> = {};
  const responses: Record<string, Record<string, number>> = {};
  for (const e of (ctx.db.journey ?? []).filter((x) => x.projectId === project.id && Date.parse(x.createdAt) > since)) {
    steps[e.step] = (steps[e.step] ?? 0) + 1;
    if (e.option) (responses[e.option] ??= {})[e.step] = (responses[e.option][e.step] ?? 0) + 1;
  }
  return ok({ since: new Date(since).toISOString(), days, steps, responses });
});

// Corrections to Flurry's answers, as the real API keeps them (AiFeedbackService).
const AI_MISTAKES: Record<string, string> = {
  'wrong-facts': 'Said something the records contradict',
  'missed-record': 'Missed something that is in the records',
  'unknown-as-no': 'Treated missing information as a no',
  'wrong-task': 'Talked about the wrong task, person or project',
  overstepped: 'Claimed or suggested something it may not do',
  unclear: 'Hard to follow, or too long',
  slow: 'Too slow',
  other: 'Something else',
};
const cutText = (v: unknown, max: number): string | null => {
  if (v == null) return null;
  const t = String(v).split('\0').join('').trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
};
function feedbackRows(ctx: Ctx, projectId: number, days: number, verdict: 'right' | 'wrong' | null) {
  const since = Date.now() - days * 86_400_000;
  return {
    since,
    rows: (ctx.db.aiFeedback ?? [])
      .filter((r) => r.projectId === projectId && Date.parse(r.createdAt) > since && (verdict === null || r.verdict === verdict))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id),
  };
}
const feedbackDays = (ctx: Ctx, fallback: number) => Math.max(1, Math.min(180, Number(ctx.query.get('days')) || fallback));

route('POST', '/projects/:id/ai/feedback', (ctx) => {
  const { project } = access(ctx, Number(ctx.params.id));
  const verdict = String(ctx.body.verdict ?? '').trim().toLowerCase();
  if (verdict !== 'right' && verdict !== 'wrong') throw new HttpError(400, 'Say whether the answer was right or wrong.', { verdict: 'Say whether the answer was right or wrong.' });
  const categories: string[] = [];
  for (const c of Array.isArray(ctx.body.categories) ? (ctx.body.categories as unknown[]) : []) {
    const k = String(c ?? '').trim().toLowerCase();
    if (!(k in AI_MISTAKES)) throw new HttpError(400, 'Unknown kind of mistake.', { categories: 'Unknown kind of mistake.' });
    if (!categories.includes(k)) categories.push(k);
  }
  const correction = cutText(ctx.body.correction, 2000);
  if (verdict === 'right' && (categories.length || correction)) throw new HttpError(400, 'A right answer has no mistakes to name.', { verdict: 'A right answer has no mistakes to name.' });
  const question = cutText(ctx.body.question, 500);
  const answer = cutText(ctx.body.answer, 4000);
  if (!question || !answer) throw new HttpError(400, 'The question and the answer are needed.', { question: 'The question and the answer are needed.' });
  const lookups = Array.isArray(ctx.body.lookups) ? cutText((ctx.body.lookups as unknown[]).map((l) => cutText(l, 60)).join(', '), 500) : null;
  const rows = (ctx.db.aiFeedback ??= []);
  rows.push({
    id: rows.reduce((m, r) => Math.max(m, r.id), 0) + 1,
    projectId: project.id,
    userId: ctx.me.id,
    verdict,
    categories,
    correction: correction || null,
    question,
    answer,
    model: cutText(ctx.body.model, 100),
    lookups: lookups || null,
    createdAt: new Date().toISOString(),
  });
  return { data: null, status: 204 };
});

route('GET', '/projects/:id/ai/feedback', (ctx) => {
  const { project, role } = access(ctx, Number(ctx.params.id));
  ensure(atLeast(role, 'MANAGER'), 'Only the project’s owners and managers can see corrections to Flurry’s answers.');
  const days = feedbackDays(ctx, 90);
  const { since, rows } = feedbackRows(ctx, project.id, days, null);
  const wrong = rows.filter((r) => r.verdict === 'wrong');
  const byKind: Record<string, number> = {};
  for (const r of wrong) for (const c of r.categories) byKind[c] = (byKind[c] ?? 0) + 1;
  const models = new Map<string, { right: number; wrong: number }>();
  for (const r of rows) {
    const m = models.get(r.model ?? 'unknown') ?? { right: 0, wrong: 0 };
    m[r.verdict] += 1;
    models.set(r.model ?? 'unknown', m);
  }
  const none = (l: string | null) => !l || !l.trim();
  return ok({
    since: new Date(since).toISOString(),
    days,
    rated: rows.length,
    right: rows.length - wrong.length,
    wrong: wrong.length,
    byKind,
    byModel: [...models.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([model, n]) => ({ model, ...n })),
    withoutLookups: rows.filter((r) => none(r.lookups)).length,
    wrongWithoutLookups: wrong.filter((r) => none(r.lookups)).length,
    latest: wrong.slice(0, 30).map((r) => ({ id: r.id, question: r.question, answer: cutText(r.answer, 600), categories: r.categories, correction: r.correction, model: r.model, lookups: r.lookups, at: r.createdAt })),
    kinds: AI_MISTAKES,
  });
});

route('GET', '/projects/:id/ai/feedback/cases.jsonl', (ctx) => {
  const { project, role } = access(ctx, Number(ctx.params.id));
  ensure(atLeast(role, 'MANAGER'), 'Only the project’s owners and managers can see corrections to Flurry’s answers.');
  const { rows } = feedbackRows(ctx, project.id, feedbackDays(ctx, 180), 'wrong');
  const text = rows
    .map((r) =>
      JSON.stringify({
        id: `feedback-${r.id}`,
        category: 'from-feedback',
        question: r.question,
        kinds: r.categories,
        wrong_answer: r.answer,
        ...(r.correction ? { correction: r.correction } : {}),
        ...(r.model ? { model: r.model } : {}),
        lookups: r.lookups ?? '',
        answer_must: [],
        answer_must_not: [],
        note: `Draft from a person's correction on ${r.createdAt.slice(0, 10)}. Write what a right answer must and mustn't say, and what it should look up, before adding it to the eval.`,
      }) + '\n',
    )
    .join('');
  audit(ctx.db, ctx.me.id, project.id, 'ai.feedback.exported', 'corrections as eval cases', 'ok', `${new TextEncoder().encode(text).length} bytes`);
  return ok(text);
});

// The forecast model trial: the test API has no trained model, so it says so (as a server without one does).
route('GET', '/projects/:id/forecast/trial', (ctx) => {
  access(ctx, Number(ctx.params.id));
  return ok({
    available: false,
    reason: 'No trained forecast model is set up on this server, so there’s nothing to compare. Niveloft’s forecast is used, as always.',
    model: null,
    open: [],
    beforeFinish: null,
    afterTheFact: null,
    recent: [],
    verdict: null,
    asOf: new Date().toISOString(),
  });
});

// Task history for training a deadline forecast (the ml/ kit): owners and managers; no names or text.
route('GET', '/projects/:id/export/task-history.csv', (ctx) => {
  const { project, role } = access(ctx, Number(ctx.params.id));
  ensure(atLeast(role, 'MANAGER'), 'Only the project’s owners and managers can download its task history.');
  audit(ctx.db, ctx.me.id, project.id, 'project.exported', 'task history', 'ok', `${project.key}-task-history-v1.csv`);
  return ok(taskHistoryCsv(ctx.db, project));
});

route('GET', '/projects/:id/analytics', (ctx) => {
  const { project } = access(ctx, Number(ctx.params.id));
  return ok(projectAnalytics(ctx.db, project));
});

route('GET', '/calendar', (ctx) => {
  const { db, me, query } = ctx;
  const from = query.get('from') ?? '0000-01-01';
  const to = query.get('to') ?? '9999-12-31';
  const projectId = optNum(query.get('projectId'));
  const mine = query.get('mine') === 'true';
  const today = todayIso();
  const ids = myProjectIds(db, me.id);
  const projects = db.projects.filter((p) => ids.has(p.id) && (projectId === null || p.id === projectId));
  const pids = new Set(projects.map((p) => p.id));
  const pById = new Map(projects.map((p) => [p.id, p]));
  const inRange = (d: string | null): d is string => !!d && d >= from && d <= to;

  const events: CalendarEvent[] = [
    ...db.tasks
      .filter((t) => pids.has(t.projectId) && inRange(t.dueDate) && (!mine || t.assigneeId === me.id))
      .map((t) => {
        const p = pById.get(t.projectId)!;
        return {
          id: `task-${t.id}`,
          type: 'TASK' as const,
          title: `${taskKey(p, t)} ${t.title}`,
          date: t.dueDate!,
          projectId: p.id,
          projectName: p.name,
          projectColor: p.color,
          status: t.status,
          priority: t.priority,
          completed: t.status === 'DONE',
          overdue: isOverdue(t, today),
          link: taskLink(t),
        };
      }),
    ...db.milestones
      .filter((m) => pids.has(m.projectId) && inRange(m.dueDate))
      .map((m) => {
        const p = pById.get(m.projectId)!;
        return {
          id: `milestone-${m.id}`,
          type: 'MILESTONE' as const,
          title: m.name,
          date: m.dueDate,
          projectId: p.id,
          projectName: p.name,
          projectColor: p.color,
          status: null,
          priority: null,
          completed: m.completed,
          overdue: !m.completed && m.dueDate < today,
          link: `/projects/${p.id}/milestones`,
        };
      }),
    ...projects
      .filter((p) => inRange(p.deadline))
      .map((p) => ({
        id: `project-${p.id}`,
        type: 'PROJECT_DEADLINE' as const,
        title: `${p.name} deadline`,
        date: p.deadline!,
        projectId: p.id,
        projectName: p.name,
        projectColor: p.color,
        status: null,
        priority: null,
        completed: p.status === 'COMPLETED',
        overdue: p.status !== 'COMPLETED' && p.status !== 'ARCHIVED' && p.deadline! < today,
        link: `/projects/${p.id}`,
      })),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.type.localeCompare(b.type));
  return ok(events);
});

// ---------------------------------------------------------------------------
// Contact, form counts, Site health, AI models and the Arena
// ---------------------------------------------------------------------------

const PRINTABLE_RE = /^[^\p{Cc}<>]*$/u;
const TOPICS = ['QUESTION', 'PROBLEM', 'DATA', 'FEEDBACK', 'OTHER'];
const FORMS = new Set(['sign-in', 'sign-up', 'forgot-password', 'reset-password', 'contact', 'project', 'task', 'milestone', 'invite', 'submit-work', 'review', 'profile', 'password', 'comment']);
const EVENTS = new Set(['view', 'submit', 'success', 'invalid', 'rejected', 'failed']);
const CONTENDER_RE = /^(builtin|chrome|server:[A-Za-z0-9._:/-]{1,100})$/;

function siteOf(db: MockDb): NonNullable<MockDb['site']> {
  db.site ??= { contact: [], formCounts: {}, arenaVotes: [], seq: { contact: 0, arena: 0 } };
  return db.site;
}

function tag(v: unknown, max = 100): string | null {
  const s = str(v);
  return s && s.length <= max && PRINTABLE_RE.test(s) ? s : null;
}

function attributionOf(v: unknown): UserRow['signup'] {
  if (!v || typeof v !== 'object') return null;
  const a = v as Record<string, unknown>;
  const source = tag(a.source);
  return source ? { source, medium: tag(a.medium), campaign: tag(a.campaign) } : null;
}

const dayOf = (iso: string) => iso.slice(0, 10);

function requireOperator(me: UserRow) {
  if (!MOCK_OPERATORS.has(me.email)) throw new HttpError(403, 'Only the people who run this site can open Site health.');
}

route(
  'POST',
  '/contact',
  ({ db, body }) => {
    if (str(body.website)) throw new HttpError(400, 'Please correct the highlighted fields.', { form: 'We couldn’t process this form. Please reload the page and try again.' });
    const name = str(body.name);
    const email = str(body.email).toLowerCase();
    const message = str(body.message);
    const topic = str(body.topic);
    const reference = optStr(body.reference);
    check({
      name: !name ? 'Your name is required.' : name.length < 2 || name.length > 80 ? 'Name must be 2–80 characters.' : /[<>\p{Cc}]/u.test(name) ? 'Name can’t contain < or > or control characters.' : null,
      email: !email ? 'Your email is required.' : !EMAIL_RE.test(email) || email.length > 254 ? 'Enter a valid email address.' : null,
      topic: TOPICS.includes(topic) ? null : 'Choose what it’s about.',
      message: !message ? 'Write a message.' : message.length < 10 || message.length > 4000 ? 'Write 10 to 4000 characters.' : null,
      reference: reference && !/^[A-Za-z0-9._-]{1,64}$/.test(reference) ? 'That reference isn’t valid.' : null,
    });
    const site = siteOf(db);
    const tenMinutesAgo = new Date(Date.now() - 10 * 60_000).toISOString();
    const same = site.contact.find((c) => c.email === email && c.message === message && c.createdAt >= tenMinutesAgo);
    if (same) return created({ id: same.id, delivered: false }, 'Message sent.');
    site.seq.contact += 1;
    const row = {
      id: site.seq.contact,
      name,
      email,
      topic,
      message,
      reference,
      page: tag(body.page, 200),
      source: attributionOf(body.attribution)?.source ?? null,
      createdAt: now(),
      handledAt: null,
    };
    site.contact.push(row);
    return created({ id: row.id, delivered: false }, 'Message sent.');
  },
  false,
);

route(
  'POST',
  '/metrics/forms',
  ({ db, body }) => {
    const events = Array.isArray(body.events) ? body.events.slice(0, 50) : [];
    const site = siteOf(db);
    const day = todayIso();
    for (const e of events as Record<string, unknown>[]) {
      const form = str(e?.form);
      const event = str(e?.event);
      const count = Math.min(50, Math.max(1, Math.floor(Number(e?.count) || 1)));
      if (!FORMS.has(form) || !EVENTS.has(event)) continue;
      const key = `${day}|form.${form}.${event}`;
      site.formCounts[key] = (site.formCounts[key] ?? 0) + count;
    }
    return { data: null, status: 204 };
  },
  false,
);

function contactDto(c: NonNullable<MockDb['site']>['contact'][number]) {
  return { id: c.id, name: c.name, email: c.email, topic: c.topic, message: c.message, reference: c.reference, page: c.page, source: c.source, createdAt: c.createdAt, handled: c.handledAt !== null };
}

// The operator's emergency switches (OpsSwitches.java): a missing entry means on.
const SWITCHES: Record<string, string> = {
  ai: 'Flurry and every AI feature',
  exports: 'downloading project and account exports',
  invitations: 'inviting people to projects',
  signups: 'creating new accounts',
  uploads: 'uploading files',
  voice: 'the natural voice for reading answers aloud',
  'forecast-model': 'the forecast model trial (Niveloft’s own forecast is unaffected)',
};

function switchesOf(db: MockDb): Record<string, { enabled: boolean; reason: string | null; changedAt: string }> {
  const site = siteOf(db) as ReturnType<typeof siteOf> & { switches?: Record<string, { enabled: boolean; reason: string | null; changedAt: string }> };
  return (site.switches ??= {});
}

route('GET', '/ops/switches', ({ db, me }) => {
  requireOperator(me);
  const stored = switchesOf(db);
  return ok(Object.keys(SWITCHES).sort().map((name) => ({ name, stops: SWITCHES[name], enabled: stored[name]?.enabled ?? true, reason: stored[name]?.reason ?? null, changedAt: stored[name]?.changedAt ?? null })));
});

route('PUT', '/ops/switches/:name', ({ db, me, params, body }) => {
  requireOperator(me);
  const name = params.name;
  if (!SWITCHES[name]) throw new HttpError(404, `There's no switch called ${name}.`);
  const enabled = body.enabled === true;
  const reason = optStr(body.reason);
  switchesOf(db)[name] = { enabled, reason, changedAt: now() };
  audit(db, me.id, null, 'ops.switch', name, 'ok', `${enabled ? 'on' : 'off'}${reason ? `: ${reason}` : ''}`);
  return ok({ name, stops: SWITCHES[name], enabled, reason, changedAt: now() }, `“${SWITCHES[name]}” is ${enabled ? 'on' : 'off'}.`);
});

route('GET', '/site-health', ({ db, me, query }) => {
  requireOperator(me);
  const days = Math.min(365, Math.max(1, Math.floor(Number(query.get('days') ?? 30)) || 30));
  const to = todayIso();
  const from = todayIso(addDays(new Date(), -(days - 1)));
  const site = siteOf(db);
  const byForm = new Map<string, Record<string, number>>();
  for (const [key, n] of Object.entries(site.formCounts)) {
    const [day, name] = key.split('|');
    if (day < from) continue;
    const [, form, event] = name.split('.');
    const f = byForm.get(form) ?? {};
    f[event] = (f[event] ?? 0) + n;
    byForm.set(form, f);
  }
  const forms = [...byForm].sort(([a], [b]) => a.localeCompare(b)).map(([form, e]) => ({
    form,
    views: e.view ?? 0,
    submits: e.submit ?? 0,
    successes: e.success ?? 0,
    invalid: e.invalid ?? 0,
    rejected: e.rejected ?? 0,
    failed: e.failed ?? 0,
  }));
  const newUsers = db.users.filter((u) => dayOf(u.createdAt) >= from);
  const counts = new Map<string, { source: string; medium: string | null; campaign: string | null; count: number }>();
  for (const u of newUsers) {
    if (!u.signup) continue;
    const k = `${u.signup.source}|${u.signup.medium}|${u.signup.campaign}`;
    const c = counts.get(k) ?? { ...u.signup, count: 0 };
    c.count += 1;
    counts.set(k, c);
  }
  const sources = [...counts.values()].sort((a, b) => b.count - a.count);
  const recent = [...site.contact].sort((a, b) => Number(a.handledAt !== null) - Number(b.handledAt !== null) || b.createdAt.localeCompare(a.createdAt)).slice(0, 50);
  return ok({
    days,
    from,
    to,
    forms,
    signups: { total: newUsers.length, attributed: sources.reduce((n, s) => n + s.count, 0), sources },
    contact: { open: site.contact.filter((c) => c.handledAt === null).length, total: site.contact.length, recent: recent.map(contactDto) },
    // No paid services run in the test API.
    spending: { aiRequestsToday: 0, aiRequestsPerDay: 1000, aiTokensThisMonth: 0, aiTokensPerMonth: 5_000_000, emailsToday: 0, emailsPerDay: 100, emailsThisMonth: 0, emailsPerMonth: 3000 },
    arenaVotes: site.arenaVotes.filter((v) => dayOf(v.createdAt) >= from).length,
  });
});

route('PATCH', '/site-health/contact/:id', ({ db, me, params, body }) => {
  requireOperator(me);
  const c = siteOf(db).contact.find((x) => x.id === Number(params.id));
  if (!c) throw new HttpError(404, 'That message doesn’t exist.');
  c.handledAt = body.handled === true ? now() : null;
  return ok(contactDto(c));
});

// The test API has no server AI, so there are no server models to compare.
route('GET', '/ai/models', () => ok([]));

function scoreboard(db: MockDb, meId: number) {
  const t = new Map<string, { contender: string; votes: number; wins: number; losses: number; ties: number; bothBad: number }>();
  const row = (c: string) => t.get(c) ?? t.set(c, { contender: c, votes: 0, wins: 0, losses: 0, ties: 0, bothBad: 0 }).get(c)!;
  const votes = siteOf(db).arenaVotes;
  for (const v of votes) {
    const a = row(v.a);
    const b = row(v.b);
    a.votes++;
    b.votes++;
    if (v.winner === 'A') {
      a.wins++;
      b.losses++;
    } else if (v.winner === 'B') {
      b.wins++;
      a.losses++;
    } else if (v.winner === 'TIE') {
      a.ties++;
      b.ties++;
    } else {
      a.bothBad++;
      b.bothBad++;
    }
  }
  const score = (s: { wins: number; ties: number; votes: number }) => (s.wins + 0.5 * s.ties + 1) / (s.votes + 2);
  return { totalVotes: votes.length, myVotes: votes.filter((v) => v.userId === meId).length, standings: [...t.values()].sort((x, y) => score(y) - score(x)) };
}

route('GET', '/arena/scoreboard', ({ db, me }) => ok(scoreboard(db, me.id)));

route('POST', '/arena/votes', (ctx) => {
  const projectId = Number(ctx.body.projectId);
  access(ctx, projectId);
  const a = str(ctx.body.a);
  const b = str(ctx.body.b);
  const winner = str(ctx.body.winner);
  check({
    a: CONTENDER_RE.test(a) ? null : 'Unknown answer source.',
    b: !CONTENDER_RE.test(b) ? 'Unknown answer source.' : a === b ? 'The two answers must come from different sources.' : null,
    winner: ['A', 'B', 'TIE', 'NEITHER'].includes(winner) ? null : 'Choose A, B, a tie or neither.',
  });
  const site = siteOf(ctx.db);
  site.seq.arena += 1;
  site.arenaVotes.push({ id: site.seq.arena, userId: ctx.me.id, projectId, a, b, winner: winner as 'A' | 'B' | 'TIE' | 'NEITHER', createdAt: now() });
  return created(scoreboard(ctx.db, ctx.me.id), 'Vote counted.');
});

