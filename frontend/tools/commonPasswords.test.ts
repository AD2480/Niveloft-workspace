import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { COMMON_PASSWORDS, commonPasswordProblem } from '../src/mock/commonPasswords';

describe('the test API’s password rules', () => {
  it('use the same list as the server', () => {
    const file = fileURLToPath(new URL('../../backend/src/main/resources/security/common-passwords.txt', import.meta.url));
    const server = fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .map((l) => l.trim().toLowerCase())
      .filter((l) => l && !l.startsWith('#'));
    expect([...COMMON_PASSWORDS].sort()).toEqual([...new Set(server)].sort());
  });

  it('refuse common passwords and look-alikes, and accept passphrases', () => {
    for (const weak of ['Password123', 'P@ssw0rd!', 'Welcome2025', 'Aaaaaaa1', 'qwerty123']) expect(commonPasswordProblem(weak, 'x@example.com', 'X Y')).not.toBeNull();
    for (const fine of ['Harbor-Quill-42', 'copper kettle 9 mountain lantern', 'vT8#pL2qZm']) expect(commonPasswordProblem(fine, 'x@example.com', 'X Y')).toBeNull();
    expect(commonPasswordProblem('ashar2024!', 'ashar@example.com', 'Asha Rao')).toMatch(/email/);
  });
});
