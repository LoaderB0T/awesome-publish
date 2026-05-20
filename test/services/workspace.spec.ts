import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { resolvePackages } from '../../src/services/workspace.js';
import type { ResolvedConfig } from '../../src/types/config.js';

const fixturesDir = resolve(import.meta.dirname, '../fixtures');

const defaultConfig: ResolvedConfig = {
  packageManager: 'pnpm',
  publishFiles: ['lib'],
  stripScripts: true,
  requireCleanGit: true,
  changesets: { enabled: false, enforceInPR: false },
  github: { releases: { enabled: false, mode: 'per-package' } },
  aiReleaseNotes: { enabled: false },
};

describe('resolvePackages', () => {
  it('resolves single-package repo', async () => {
    const packages = await resolvePackages(resolve(fixturesDir, 'single-package'), defaultConfig);
    expect(packages).toHaveLength(1);
    expect(packages[0].name).toBe('my-pkg');
    expect(packages[0].version).toBe('1.0.0');
  });

  it('resolves monorepo packages from workspaces field', async () => {
    const packages = await resolvePackages(resolve(fixturesDir, 'monorepo'), defaultConfig);
    expect(packages).toHaveLength(2);
    const names = packages.map(p => p.name).sort();
    expect(names).toEqual(['@scope/pkg-a', '@scope/pkg-b']);
  });

  it('filters packages by name pattern', async () => {
    const packages = await resolvePackages(
      resolve(fixturesDir, 'monorepo'),
      defaultConfig,
      '@scope/pkg-a',
    );
    expect(packages).toHaveLength(1);
    expect(packages[0].name).toBe('@scope/pkg-a');
  });
});
