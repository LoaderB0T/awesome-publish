import { describe, it, expect } from 'vitest';
import { resolve, join } from 'node:path';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolvePackages } from '../../src/services/workspace.js';
import type { ResolvedConfig } from '../../src/types/config.js';

const fixturesDir = resolve(import.meta.dirname, '../fixtures');

const defaultConfig: ResolvedConfig = {
  packageManager: 'pnpm',
  registry: 'https://registry.npmjs.org',
  publishFiles: ['lib'],
  stripScripts: true,
  requireCleanGit: true,
  gitTag: { enabled: false, prefix: '' },
  changelog: { enabled: false, file: 'CHANGELOG.md' },
  conventionalCommits: false,
  confirmPublish: false,
  syncDependencies: false,
  changesets: { enabled: false, enforceInPR: false },
  github: { releases: { enabled: false, mode: 'per-package', draft: false } },
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
      '@scope/pkg-a'
    );
    expect(packages).toHaveLength(1);
    expect(packages[0].name).toBe('@scope/pkg-a');
  });

  it('skips packages without name', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ap-ws-'));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ version: '1.0.0' }));

    const result = await resolvePackages(dir, defaultConfig);
    expect(result).toHaveLength(0);
  });

  it('skips packages without version', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ap-ws-'));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'no-version' }));

    const result = await resolvePackages(dir, defaultConfig);
    expect(result).toHaveLength(0);
  });

  it('skips private packages', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ap-ws-'));
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({
        name: 'private-pkg',
        version: '1.0.0',
        private: true,
      })
    );

    const result = await resolvePackages(dir, defaultConfig);
    expect(result).toHaveLength(0);
  });
});
