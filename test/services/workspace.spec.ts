import { describe, it, expect } from 'vitest';
import { resolve, join } from 'node:path';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolvePackages } from '../../src/services/workspace.js';
import type { ResolvedConfig } from '../../src/types/config.js';

const fixturesDir = resolve(import.meta.dirname, '../fixtures');

const defaultConfig: ResolvedConfig = {
  packageManager: 'pnpm',
  registry: 'https://registry.npmjs.org',
  publishFiles: ['lib'],
  stripScripts: true,
  access: 'public',
  provenance: false,
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

  it('supports yarn object-form workspaces', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ap-ws-yarn-'));
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ name: 'root', private: true, workspaces: { packages: ['packages/*'] } })
    );
    mkdirSync(join(root, 'packages', 'a'), { recursive: true });
    writeFileSync(
      join(root, 'packages', 'a', 'package.json'),
      JSON.stringify({ name: 'a', version: '1.0.0' })
    );

    const result = await resolvePackages(root, defaultConfig);
    expect(result.map(p => p.name)).toEqual(['a']);
  });

  it('treats a settings-only pnpm-workspace.yaml (no packages:) as a single package', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ap-ws-settings-'));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'solo', version: '2.1.0' }));
    // pnpm 9+ commonly has a workspace file with only settings, no `packages:`.
    writeFileSync(
      join(dir, 'pnpm-workspace.yaml'),
      'onlyBuiltDependencies:\n  - esbuild\nallowBuilds:\n  foo: true\n'
    );

    const result = await resolvePackages(dir, defaultConfig);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('solo');
  });

  it('publishes dependencies before dependents (topological order)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ap-ws-topo-'));
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ name: 'root', private: true, workspaces: ['packages/*'] })
    );
    // "app" (sorts first) depends on "lib" (sorts last) — topo order must still
    // put lib before app.
    mkdirSync(join(root, 'packages', 'app'), { recursive: true });
    writeFileSync(
      join(root, 'packages', 'app', 'package.json'),
      JSON.stringify({ name: 'app', version: '1.0.0', dependencies: { lib: '1.0.0' } })
    );
    mkdirSync(join(root, 'packages', 'lib'), { recursive: true });
    writeFileSync(
      join(root, 'packages', 'lib', 'package.json'),
      JSON.stringify({ name: 'lib', version: '1.0.0' })
    );

    const result = await resolvePackages(root, defaultConfig);
    const names = result.map(p => p.name);
    expect(names.indexOf('lib')).toBeLessThan(names.indexOf('app'));
  });
});
