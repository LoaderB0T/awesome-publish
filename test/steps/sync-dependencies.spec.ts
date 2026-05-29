import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { syncDependenciesStep } from '../../src/steps/sync-dependencies.js';
import type { ResolvedConfig } from '../../src/types/config.js';

function makeConfig(): ResolvedConfig {
  return {
    packageManager: 'pnpm',
    registry: 'https://registry.npmjs.org',
    publishFiles: ['lib'],
    stripScripts: true,
    requireCleanGit: true,
    gitTag: { enabled: true, prefix: '' },
    changelog: { enabled: false, file: 'CHANGELOG.md' },
    conventionalCommits: false,
    confirmPublish: false,
    syncDependencies: true,
    changesets: { enabled: false, enforceInPR: false },
    github: { releases: { enabled: false, mode: 'per-package', draft: false } },
    aiReleaseNotes: { enabled: false },
  };
}

describe('syncDependenciesStep', () => {
  it('updates workspace dependency versions', async () => {
    const dirA = mkdtempSync(join(tmpdir(), 'ap-sync-a-'));
    const dirB = mkdtempSync(join(tmpdir(), 'ap-sync-b-'));

    writeFileSync(join(dirA, 'package.json'), JSON.stringify({
      name: 'pkg-a', version: '1.0.0',
    }));
    writeFileSync(join(dirB, 'package.json'), JSON.stringify({
      name: 'pkg-b', version: '2.0.0',
      dependencies: { 'pkg-a': '^1.0.0' },
    }));

    const config = makeConfig();
    const ctx = {
      config,
      packages: [
        { name: 'pkg-a', version: '1.0.0', dir: dirA, packageJson: {}, config },
        { name: 'pkg-b', version: '2.0.0', dir: dirB, packageJson: {}, config },
      ],
      mode: 'interactive' as const,
      dryRun: false,
      debug: false,
      versionBumps: new Map([
        ['pkg-a', { packageName: 'pkg-a', from: '1.0.0', to: '1.1.0', type: 'minor' as const }],
      ]),
    };

    await syncDependenciesStep.execute(ctx as any);

    const updated = JSON.parse(readFileSync(join(dirB, 'package.json'), 'utf-8'));
    expect(updated.dependencies['pkg-a']).toBe('^1.1.0');
  });

  it('skips workspace:* protocol ranges', async () => {
    const dirA = mkdtempSync(join(tmpdir(), 'ap-sync-a-'));
    const dirB = mkdtempSync(join(tmpdir(), 'ap-sync-b-'));

    writeFileSync(join(dirA, 'package.json'), JSON.stringify({ name: 'pkg-a', version: '1.0.0' }));
    writeFileSync(join(dirB, 'package.json'), JSON.stringify({
      name: 'pkg-b', version: '2.0.0',
      dependencies: { 'pkg-a': 'workspace:*' },
    }));

    const config = makeConfig();
    const ctx = {
      config,
      packages: [
        { name: 'pkg-a', version: '1.0.0', dir: dirA, packageJson: {}, config },
        { name: 'pkg-b', version: '2.0.0', dir: dirB, packageJson: {}, config },
      ],
      mode: 'interactive' as const,
      dryRun: false,
      debug: false,
      versionBumps: new Map([
        ['pkg-a', { packageName: 'pkg-a', from: '1.0.0', to: '1.1.0', type: 'minor' as const }],
      ]),
    };

    await syncDependenciesStep.execute(ctx as any);

    const updated = JSON.parse(readFileSync(join(dirB, 'package.json'), 'utf-8'));
    expect(updated.dependencies['pkg-a']).toBe('workspace:*');
  });

  it('preserves tilde prefix', async () => {
    const dirA = mkdtempSync(join(tmpdir(), 'ap-sync-a-'));
    const dirB = mkdtempSync(join(tmpdir(), 'ap-sync-b-'));

    writeFileSync(join(dirA, 'package.json'), JSON.stringify({ name: 'pkg-a', version: '1.0.0' }));
    writeFileSync(join(dirB, 'package.json'), JSON.stringify({
      name: 'pkg-b', version: '2.0.0',
      dependencies: { 'pkg-a': '~1.0.0' },
    }));

    const config = makeConfig();
    const ctx = {
      config,
      packages: [
        { name: 'pkg-a', version: '1.0.0', dir: dirA, packageJson: {}, config },
        { name: 'pkg-b', version: '2.0.0', dir: dirB, packageJson: {}, config },
      ],
      mode: 'interactive' as const,
      dryRun: false,
      debug: false,
      versionBumps: new Map([
        ['pkg-a', { packageName: 'pkg-a', from: '1.0.0', to: '1.1.0', type: 'minor' as const }],
      ]),
    };

    await syncDependenciesStep.execute(ctx as any);

    const updated = JSON.parse(readFileSync(join(dirB, 'package.json'), 'utf-8'));
    expect(updated.dependencies['pkg-a']).toBe('~1.1.0');
  });
});
