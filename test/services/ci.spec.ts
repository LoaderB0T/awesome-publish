import { describe, it, expect, afterEach } from 'vitest';
import { isCiEnv } from '../../src/services/ci.js';

const { CI, GITHUB_ACTIONS } = process.env;

afterEach(() => {
  // Restore whatever the runner had (vitest itself sets CI in CI).
  if (CI === undefined) delete process.env.CI;
  else process.env.CI = CI;
  if (GITHUB_ACTIONS === undefined) delete process.env.GITHUB_ACTIONS;
  else process.env.GITHUB_ACTIONS = GITHUB_ACTIONS;
});

describe('isCiEnv', () => {
  it('is true when the explicit --ci flag is passed', () => {
    delete process.env.CI;
    delete process.env.GITHUB_ACTIONS;
    expect(isCiEnv(true)).toBe(true);
  });

  it('is true when CI env var is set', () => {
    delete process.env.GITHUB_ACTIONS;
    process.env.CI = 'true';
    expect(isCiEnv(false)).toBe(true);
  });

  it('is true when GITHUB_ACTIONS is set', () => {
    delete process.env.CI;
    process.env.GITHUB_ACTIONS = 'true';
    expect(isCiEnv()).toBe(true);
  });

  it('is false with no flag and no CI env', () => {
    delete process.env.CI;
    delete process.env.GITHUB_ACTIONS;
    expect(isCiEnv()).toBe(false);
    expect(isCiEnv(false)).toBe(false);
  });
});
