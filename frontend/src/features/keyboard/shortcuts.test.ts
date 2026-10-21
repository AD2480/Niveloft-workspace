import { describe, expect, it } from 'vitest';
import { GO_TO, GO_TO_PROJECT, goToTarget, projectIn } from './shortcuts';

describe('keyboard layer', () => {
  it('goes to the main pages with G and a letter', () => {
    expect(goToTarget('i', '/dashboard')).toBe('/inbox');
    expect(goToTarget('T', '/inbox')).toBe('/dashboard');
    expect(goToTarget('m', '/calendar')).toBe('/my-tasks');
    expect(goToTarget('x', '/dashboard')).toBeNull();
  });

  it('goes to the chapters of the project you are in, and still to the main pages', () => {
    expect(projectIn('/projects/6/tasks/55')).toBe(6);
    expect(projectIn('/projects')).toBeNull();
    expect(projectIn('/projects/12')).toBe(12);
    expect(goToTarget('b', '/projects/6/tasks/55')).toBe('/projects/6/board');
    expect(goToTarget('o', '/projects/6/board')).toBe('/projects/6');
    expect(goToTarget('l', '/projects/6')).toBe('/projects/6/tasks');
    expect(goToTarget('i', '/projects/6')).toBe('/inbox');
    // Outside a project the chapter letters mean nothing.
    expect(goToTarget('b', '/inbox')).toBeNull();
  });

  it('never gives two destinations the same letter', () => {
    const letters = [...GO_TO, ...GO_TO_PROJECT].map((g) => g.key);
    expect(new Set(letters).size).toBe(letters.length);
  });
});
