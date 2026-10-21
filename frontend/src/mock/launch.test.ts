import { beforeEach, describe, expect, it } from 'vitest';
import type { ApiErrorBody, AuditEvent, AuthResponse, DeletionCheck, Member, SessionInfo } from '@/api/types';
import { DEMO_PASSWORD } from './demoAccounts';
import { createSeedDb } from './seed';
import { handleMockRequest } from './server';
import { getDb, setDbForTesting } from './store';

async function call<T>(method: string, url: string, body?: unknown, token?: string) {
  const res = await handleMockRequest({ method, url: `/api${url}`, body, token });
  return { status: res.status, body: res.body as { data: T; message?: string } & ApiErrorBody };
}

async function login(email: string, remember = false) {
  const res = await call<AuthResponse>('POST', '/auth/login', { email, password: DEMO_PASSWORD, remember });
  expect(res.status).toBe(200);
  return res.body.data.token;
}

// The demo API keeps the production rules for sessions, ownership, deletion and the audit log, so
// the demo behaves like the real product.
describe('demo API: launch controls', () => {
  beforeEach(async () => {
    setDbForTesting(await createSeedDb());
  });

  it('ends sessions on the server: this device, another one, or all', async () => {
    const laptop = await login('rohan@projectflow.dev');
    const phone = await login('rohan@projectflow.dev', true);
    const list = (await call<SessionInfo[]>('GET', '/auth/sessions', undefined, laptop)).body.data;
    expect(list).toHaveLength(2);
    expect(list.filter((s) => s.current)).toHaveLength(1);
    expect(list.filter((s) => s.remember)).toHaveLength(1);
    const phoneId = list.find((s) => !s.current)!.id;
    expect((await call('DELETE', `/auth/sessions/${phoneId}`, undefined, laptop)).status).toBe(200);
    const ended = await call('GET', '/auth/me', undefined, phone);
    expect(ended.status).toBe(401);
    expect(ended.body.message).toMatch(/signed out/);
    expect((await call('POST', '/auth/logout', undefined, laptop)).status).toBe(200);
    expect((await call('GET', '/auth/me', undefined, laptop)).status).toBe(401);
    const a = await login('rohan@projectflow.dev');
    const b = await login('rohan@projectflow.dev');
    expect((await call('POST', '/auth/logout-everywhere', undefined, a)).status).toBe(200);
    expect((await call('GET', '/auth/me', undefined, b)).status).toBe(401);
  });

  it('keeps a sign-in with its cookie: a new token for its own session, until it ends', async () => {
    const email = 'rohan@projectflow.dev';
    const current = async (token: string) =>
      (await call<SessionInfo[]>('GET', '/auth/sessions', undefined, token)).body.data.find((s) => s.current)?.id;

    await login(email); // not kept: no cookie
    expect((await call('POST', '/auth/refresh')).status).toBe(401);

    const kept = await call<AuthResponse>('POST', '/auth/login', { email, password: DEMO_PASSWORD, remember: true });
    expect(kept.body.data.expiresIn).toBeLessThanOrEqual(86_400); // a token lasts a day at most; the kept sign-in, 14
    const renewed = await call<AuthResponse>('POST', '/auth/refresh');
    expect(renewed.status).toBe(200);
    expect(await current(renewed.body.data.token)).toBe(await current(kept.body.data.token));

    // A password change: a new session, kept as before, and a new cookie for it.
    const changed = await call<AuthResponse>('PUT', '/users/me/password', { currentPassword: DEMO_PASSWORD, newPassword: 'Lantern-Copper-77' }, renewed.body.data.token);
    expect(changed.status).toBe(200);
    const afterChange = await call<AuthResponse>('POST', '/auth/refresh');
    expect(afterChange.status).toBe(200);
    expect(await current(afterChange.body.data.token)).toBe(await current(changed.body.data.token));

    // Signing out in a tab with its own sign-in signs the browser out: the kept sign-in ends too.
    const tab = (await call<AuthResponse>('POST', '/auth/login', { email, password: 'Lantern-Copper-77' })).body.data.token;
    expect((await call('POST', '/auth/refresh')).status).toBe(401); // that sign-in wasn't kept, so the cookie went
    const keptAgain = (await call<AuthResponse>('POST', '/auth/login', { email, password: 'Lantern-Copper-77', remember: true })).body.data.token;
    expect((await call('POST', '/auth/logout', undefined, tab)).status).toBe(200);
    expect((await call('POST', '/auth/refresh')).status).toBe(401);
    expect((await call('GET', '/auth/me', undefined, keptAgain)).status).toBe(401);

    // A tab whose token no longer works signs out with the cookie alone.
    await call('POST', '/auth/login', { email, password: 'Lantern-Copper-77', remember: true });
    expect((await call('POST', '/auth/refresh')).status).toBe(200);
    expect((await call('POST', '/auth/logout')).status).toBe(200);
    expect((await call('POST', '/auth/refresh')).status).toBe(401);
    expect((await call('POST', '/auth/logout')).status).toBe(401); // nothing left to sign out

    // Signing out everywhere ends a kept sign-in from another device.
    await call('POST', '/auth/login', { email, password: 'Lantern-Copper-77', remember: true });
    const elsewhere = await login(email).catch(() => null);
    expect(elsewhere).toBeNull(); // the sample password changed above
    const another = (await call<AuthResponse>('POST', '/auth/login', { email: 'aarav@projectflow.dev', password: DEMO_PASSWORD, remember: true })).body.data.token;
    expect((await call('POST', '/auth/logout-everywhere', undefined, another)).status).toBe(200);
    expect((await call('POST', '/auth/refresh')).status).toBe(401);
  });

  it('refuses a token without a session', async () => {
    const legacy = `mock.${btoa(JSON.stringify({ sub: 1, exp: Math.floor(Date.now() / 1000) + 600 }))}.signature`;
    expect((await call('GET', '/auth/me', undefined, legacy)).status).toBe(401);
  });

  it('says how long “keep me signed in” lasts', async () => {
    expect((await call<{ rememberDays: number }>('GET', '/auth/options')).body.data.rememberDays).toBe(14);
  });

  it('hands a project over, keeps the previous owner as manager, and logs it for managers only', async () => {
    const owner = await login('aarav@projectflow.dev');
    const members = (await call<Member[]>('GET', '/projects/6/members', undefined, owner)).body.data;
    const priya = members.find((m) => m.user.name.startsWith('Priya'))!;
    const rohan = members.find((m) => m.user.name.startsWith('Rohan'))!;
    expect((await call('POST', '/projects/6/transfer-ownership', { memberId: priya.id }, await login('rohan@projectflow.dev'))).status).toBe(403);
    const res = await call<Member>('POST', '/projects/6/transfer-ownership', { memberId: priya.id }, owner);
    expect(res.status).toBe(200);
    expect(res.body.data.role).toBe('OWNER');
    const after = (await call<Member[]>('GET', '/projects/6/members', undefined, owner)).body.data;
    expect(after.find((m) => m.user.name.startsWith('Aarav'))!.role).toBe('MANAGER');
    const log = (await call<AuditEvent[]>('GET', '/projects/6/audit', undefined, owner)).body.data;
    expect(log[0].action).toBe('project.ownership_transferred');
    expect((await call('GET', '/projects/6/audit', undefined, await login(rohan.user.email))).status).toBe(403);
  });

  it('deletes an account only once its shared projects have another owner, and keeps what it wrote', async () => {
    const owner = await login('aarav@projectflow.dev');
    const check = (await call<DeletionCheck>('GET', '/users/me/deletion-check', undefined, owner)).body.data;
    expect(check.canDelete).toBe(false);
    expect(check.blockedBy.length).toBeGreaterThan(0);
    expect((await call('POST', '/users/me/delete', { password: DEMO_PASSWORD, confirm: 'DELETE' }, owner)).status).toBe(409);

    const vikram = await login('vikram@projectflow.dev'); // a viewer: owns nothing
    expect((await call('POST', '/users/me/delete', { password: 'wrong-pass-1', confirm: 'DELETE' }, vikram)).status).toBe(400);
    expect((await call('POST', '/users/me/delete', { password: DEMO_PASSWORD, confirm: 'delete' }, vikram)).status).toBe(400);
    const copy = await call<{ profile: { email: string } }>('GET', '/users/me/export', undefined, vikram);
    expect(copy.body.data.profile.email).toBe('vikram@projectflow.dev');
    expect((await call('POST', '/users/me/delete', { password: DEMO_PASSWORD, confirm: 'DELETE' }, vikram)).status).toBe(200);
    expect((await call('GET', '/auth/me', undefined, vikram)).status).toBe(401);
    expect((await call('POST', '/auth/login', { email: 'vikram@projectflow.dev', password: DEMO_PASSWORD })).status).toBe(401);
    const members = (await call<Member[]>('GET', '/projects/6/members', undefined, owner)).body.data;
    expect(members.some((m) => m.user.name === 'Deleted user' || m.user.email === 'vikram@projectflow.dev')).toBe(false);
  });

  it('puts your documents and your ratings of Flurry’s answers in your copy, and unlinks the ratings when you go', async () => {
    const ananya = await login('ananya@projectflow.dev'); // a member who owns nothing
    const doc = await call('POST', '/projects/6/documents', { title: 'Sign-up copy decisions', body: '# Decisions\n\nWe keep the passkey prompt on the second screen.' }, ananya);
    expect(doc.status).toBe(200);
    const rated = await call('POST', '/projects/6/ai/feedback', { verdict: 'wrong', categories: ['missed-record'], correction: 'Maya asked for a review on Monday.', question: 'Why is ONB-9 late?', answer: 'Nothing is recorded.' }, ananya);
    expect(rated.status).toBe(204);
    type Copy = { documentsIWrote: { project: string; title: string; text: string }[]; answersIRated: { project: string; verdict: string; categories: string | null; correction: string | null; question: string }[] };
    const copy = (await call<Copy>('GET', '/users/me/export', undefined, ananya)).body.data;
    expect(copy.documentsIWrote.map((d) => `${d.project}: ${d.title}`)).toEqual(['ONB: Sign-up copy decisions']);
    expect(copy.documentsIWrote[0].text).toContain('passkey prompt');
    expect(copy.answersIRated.map((r) => [r.project, r.verdict, r.categories, r.correction, r.question])).toEqual([['ONB', 'wrong', 'missed-record', 'Maya asked for a review on Monday.', 'Why is ONB-9 late?']]);
    // Someone else's copy holds neither.
    const other = (await call<Copy>('GET', '/users/me/export', undefined, await login('kabir@projectflow.dev'))).body.data;
    expect(other.documentsIWrote.length + other.answersIRated.length).toBe(0);

    expect((await call('POST', '/users/me/delete', { password: DEMO_PASSWORD, confirm: 'DELETE' }, ananya)).status).toBe(200);
    const left = (await getDb()).aiFeedback ?? [];
    expect(left.length).toBe(1); // the rating stays with the project, for its owners and managers
    expect(left[0].userId).toBe(null);
  });

  it('refuses common passwords at sign-up, like the server', async () => {
    const res = await call('POST', '/auth/register', { name: 'New Person', email: 'n@college.edu', password: 'Password123', acceptTerms: true });
    expect(res.status).toBe(400);
    expect(res.body.fieldErrors?.password).toMatch(/too common/);
  });
});
