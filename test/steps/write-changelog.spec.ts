import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { writeChangelogStep } from '../../src/steps/write-changelog.js';
import type { ResolvedConfig } from '../../src/types/config.js';

function makeConfig(overrides: Partial<ResolvedConfig> = {}): ResolvedConfig {
  return {
    packageManager: 'pnpm',
    registry: 'https://registry.npmjs.org',
    publishFiles: ['lib'],
    stripScripts: true,
    requireCleanGit: true,
    gitTag: { enabled: true, prefix: '' },
    changelog: { enabled: true, file: 'CHANGELOG.md' },
    conventionalCommits: false,
    confirmPublish: false,
    syncDependencies: false,
    changesets: { enabled: false, enforceInPR: false },
    github: { releases: { enabled: false, mode: 'per-package', draft: false } },
    aiReleaseNotes: { enabled: false },
    ...overrides,
  };
}

function createGitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ap-changelog-'));
  execFileSync('git', ['init'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'test', version: '1.0.0' }));
  execFileSync('git', ['add', '.'], { cwd: dir });
  execFileSync('git', ['commit', '-m', 'feat: initial commit'], { cwd: dir });
  return dir;
}

describe('writeChangelogStep', () => {
  it('creates CHANGELOG.md with version entry', async () => {
    const dir = createGitRepo();
    const config = makeConfig();

    const ctx = {
      config,
      packages: [{ name: 'test', version: '1.0.0', dir, packageJson: {}, config }],
      mode: 'interactive' as const,
      dryRun: false,
      debug: false,
      rootDir: dir,
      versionBumps: new Map([
        ['test', { packageName: 'test', from: '1.0.0', to: '1.1.0', type: 'minor' as const }],
      ]),
    };

    const result = await writeChangelogStep.execute(ctx as any);

    expect(result.changelogEntries.has('test')).toBe(true);
    const changelog = readFileSync(join(dir, 'CHANGELOG.md'), 'utf-8');
    expect(changelog).toContain('1.1.0');
    expect(changelog).toContain('# Changelog');
  });

  it('prepends to existing CHANGELOG.md', async () => {
    const dir = createGitRepo();
    writeFileSync(join(dir, 'CHANGELOG.md'), '# Changelog\n\n## 1.0.0\n\n- Initial release\n');

    const config = makeConfig();
    const ctx = {
      config,
      packages: [{ name: 'test', version: '1.0.0', dir, packageJson: {}, config }],
      mode: 'interactive' as const,
      dryRun: false,
      debug: false,
      rootDir: dir,
      versionBumps: new Map([
        ['test', { packageName: 'test', from: '1.0.0', to: '1.1.0', type: 'minor' as const }],
      ]),
    };

    await writeChangelogStep.execute(ctx as any);

    const changelog = readFileSync(join(dir, 'CHANGELOG.md'), 'utf-8');
    expect(changelog).toContain('1.1.0');
    expect(changelog).toContain('1.0.0');
    // New entry should be before old
    expect(changelog.indexOf('1.1.0')).toBeLessThan(changelog.indexOf('## 1.0.0'));
  });
});
