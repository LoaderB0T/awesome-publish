import { describe, it, expect } from 'vitest';
import { normalizeConfig, validateConfig, defineConfig } from '../../src/config/schema.js';

describe('defineConfig', () => {
  it('returns the config as-is (identity function)', () => {
    const input = { publishFiles: ['lib'], stripScripts: true };
    expect(defineConfig(input)).toBe(input);
  });
});

describe('normalizeConfig', () => {
  it('normalizes aiReleaseNotes: true to object form', () => {
    const result = normalizeConfig(
      {
        publishFiles: ['lib'],
        stripScripts: true,
        aiReleaseNotes: true,
      },
      'pnpm'
    );
    expect(result.aiReleaseNotes).toEqual({ enabled: true });
  });

  it('normalizes undefined aiReleaseNotes to disabled', () => {
    const result = normalizeConfig(
      {
        publishFiles: ['lib'],
        stripScripts: true,
      },
      'pnpm'
    );
    expect(result.aiReleaseNotes).toEqual({ enabled: false });
  });

  it('fills missing changesets with defaults', () => {
    const result = normalizeConfig(
      {
        publishFiles: ['lib'],
        stripScripts: true,
      },
      'pnpm'
    );
    expect(result.changesets).toEqual({ enabled: false, enforceInPR: false });
  });

  it('fills missing github with defaults', () => {
    const result = normalizeConfig(
      {
        publishFiles: ['lib'],
        stripScripts: true,
      },
      'pnpm'
    );
    expect(result.github).toEqual({
      releases: { enabled: false, mode: 'per-package', draft: false },
    });
  });

  it('defaults requireCleanGit to true', () => {
    const result = normalizeConfig(
      {
        publishFiles: ['lib'],
        stripScripts: true,
      },
      'pnpm'
    );
    expect(result.requireCleanGit).toBe(true);
  });

  it('uses detected package manager when not specified', () => {
    const result = normalizeConfig(
      {
        publishFiles: ['lib'],
        stripScripts: true,
      },
      'yarn'
    );
    expect(result.packageManager).toBe('yarn');
  });

  it('config packageManager overrides detected', () => {
    const result = normalizeConfig(
      {
        publishFiles: ['lib'],
        stripScripts: true,
        packageManager: 'npm',
      },
      'pnpm'
    );
    expect(result.packageManager).toBe('npm');
  });
});

describe('validateConfig', () => {
  it('throws if publishFiles is empty', () => {
    expect(() =>
      validateConfig(
        {
          publishFiles: [],
          stripScripts: true,
        },
        'pnpm'
      )
    ).toThrow(/publishFiles/);
  });

  it('throws if AI feature enabled without aiProvider', () => {
    expect(() =>
      validateConfig(
        {
          publishFiles: ['lib'],
          stripScripts: true,
          aiReleaseNotes: true,
        },
        'pnpm'
      )
    ).toThrow(/aiProvider/);
  });

  it('passes when AI feature enabled with aiProvider', () => {
    expect(() =>
      validateConfig(
        {
          publishFiles: ['lib'],
          stripScripts: true,
          aiReleaseNotes: true,
          aiProvider: { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
        },
        'pnpm'
      )
    ).not.toThrow();
  });

  it('throws if github.releases.mode is invalid', () => {
    expect(() =>
      validateConfig(
        {
          publishFiles: ['lib'],
          stripScripts: true,
          github: { releases: { enabled: true, mode: 'invalid' as any } },
        },
        'pnpm'
      )
    ).toThrow(/mode/);
  });
});
