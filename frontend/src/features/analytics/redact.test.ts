import { describe, expect, it } from 'vitest';
import { redactPath, redactTitle } from './redact';

describe('analytics redaction', () => {
  it('replaces record ids and drops query strings and hashes', () => {
    expect(redactPath('/projects/12/tasks/34/review?tab=1#x')).toBe('/projects/[id]/tasks/[id]/review');
    expect(redactPath('https://pf.example/verify-email?token=abc123')).toBe('/verify-email');
    expect(redactPath('/reset-password?token=secret')).toBe('/reset-password');
    expect(redactPath('/')).toBe('/');
    expect(redactPath('/projects/7')).toBe('/projects/[id]');
  });

  it('names the kind of page, never a project or task', () => {
    expect(redactTitle('/projects/3/tasks/9')).toBe('Task');
    expect(redactTitle('/projects/3/board/tasks/9')).toBe('Task');
    expect(redactTitle('/projects/3/tasks/9/review')).toBe('Review workspace');
    expect(redactTitle('/projects/3/model')).toBe('Project model');
    expect(redactTitle('/')).toBe('Front page');
    expect(redactTitle('/dashboard')).toBe('dashboard');
  });
});
