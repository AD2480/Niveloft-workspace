import { describe, expect, it } from 'vitest';
import { can, statusChangeBlockedReason } from './permissions';

const ME = 1;
const OTHER = 2;
const mine = { status: 'IN_PROGRESS' as const, assigneeId: ME, reporterId: OTHER };
const theirs = { status: 'IN_PROGRESS' as const, assigneeId: OTHER, reporterId: OTHER };

describe('project permissions', () => {
  it('only owners delete projects; managers edit them', () => {
    expect(can.deleteProject('OWNER')).toBe(true);
    expect(can.deleteProject('MANAGER')).toBe(false);
    expect(can.editProject('MANAGER')).toBe(true);
    expect(can.editProject('MEMBER')).toBe(false);
  });

  it('limits which roles can be granted', () => {
    expect(can.assignableRoles('OWNER')).toEqual(['MANAGER', 'MEMBER', 'VIEWER']);
    expect(can.assignableRoles('MANAGER')).toEqual(['MEMBER', 'VIEWER']);
    expect(can.assignableRoles('MEMBER')).toEqual([]);
  });

  it('protects the owner, managers and yourself from member management', () => {
    expect(can.manageMember('OWNER', 'OWNER', false)).toBe(false);
    expect(can.manageMember('OWNER', 'MANAGER', false)).toBe(true);
    expect(can.manageMember('MANAGER', 'MANAGER', false)).toBe(false);
    expect(can.manageMember('MANAGER', 'VIEWER', false)).toBe(true);
    expect(can.manageMember('OWNER', 'MANAGER', true)).toBe(false);
  });
});

describe('task permissions', () => {
  it('viewers are read-only', () => {
    expect(can.createTask('VIEWER')).toBe(false);
    expect(can.comment('VIEWER')).toBe(false);
    expect(can.editTask('VIEWER', mine, ME)).toBe(false);
  });

  it('members edit their own tasks only', () => {
    expect(can.editTask('MEMBER', mine, ME)).toBe(true);
    expect(can.editTask('MEMBER', theirs, ME)).toBe(false);
    expect(can.editTask('MANAGER', theirs, ME)).toBe(true);
  });

  it('members may only take unassigned tasks or unassign themselves', () => {
    const unassigned = { status: 'TODO' as const, assigneeId: null, reporterId: OTHER };
    expect(can.assignTask('MEMBER', unassigned, ME, ME)).toBe(true);
    expect(can.assignTask('MEMBER', unassigned, ME, OTHER)).toBe(false);
    expect(can.assignTask('MEMBER', mine, ME, null)).toBe(true);
    expect(can.assignTask('MEMBER', theirs, ME, ME)).toBe(false);
    expect(can.assignTask('MANAGER', theirs, ME, ME)).toBe(true);
  });

  it('never allows moving directly to In Review or Done', () => {
    expect(can.changeStatus('OWNER', mine, ME, 'IN_REVIEW')).toBe(false);
    expect(can.changeStatus('OWNER', mine, ME, 'DONE')).toBe(false);
    expect(statusChangeBlockedReason('IN_PROGRESS', 'DONE')).toMatch(/reviewer approves/);
  });

  it('only managers reopen done tasks, and nobody moves tasks out of review manually', () => {
    const done = { ...mine, status: 'DONE' as const };
    expect(can.changeStatus('MEMBER', done, ME, 'IN_PROGRESS')).toBe(false);
    expect(can.changeStatus('MANAGER', done, ME, 'IN_PROGRESS')).toBe(true);
    const review = { ...mine, status: 'IN_REVIEW' as const };
    expect(can.changeStatus('OWNER', review, ME, 'IN_PROGRESS')).toBe(false);
  });

  it('only the assignee submits, and reviewers cannot approve their own work', () => {
    expect(can.submitWork('MEMBER', mine, ME)).toBe(true);
    expect(can.submitWork('MANAGER', theirs, ME)).toBe(false);
    expect(can.reviewSubmission('MANAGER', OTHER, ME)).toBe(true);
    expect(can.reviewSubmission('MANAGER', ME, ME)).toBe(false);
    expect(can.reviewSubmission('MEMBER', OTHER, ME)).toBe(false);
  });
});
