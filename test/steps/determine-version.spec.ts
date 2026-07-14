import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { determineVersionStep } from '../../src/steps/determine-version.js';
import type { CoreContext, ChangesetContext } from '../../src/pipeline/context.js';
import type { ResolvedConfig } from '../../src/types/config.js';

/** A temp git repo whose single commit has the given message, no tags. */
function repoWithCommit(message: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'ap-dv-'));
  execFileSync('git', ['init'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  writeFileSync(join(dir, 'f.txt'), 'x');
  execFileSync('git', ['add', '.'], { cwd: dir });
  execFileSync('git', ['commit', '-m', message], { cwd: dir });
  return dir;
}

/**
 * A temp git repo with two packages under packages/a and packages/b. One extra
 * commit (with `commitMsg`) touches ONLY packages/a.
 */
function monorepoRepo(commitMsg: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'ap-dv-mono-'));
  execFileSync('git', ['init'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  for (const name of ['a', 'b']) {
    mkdirSync(join(dir, 'packages', name), { recursive: true });
    writeFileSync(
      join(dir, 'packages', name, 'package.json'),
      JSON.stringify({ name: `pkg-${name}`, version: '1.0.0' })
    );
  }
  execFileSync('git', ['add', '.'], { cwd: dir });
  execFileSync('git', ['commit', '-m', 'chore: scaffold'], { cwd: dir });
  // A change confined to packages/a.
  writeFileSync(join(dir, 'packages', 'a', 'index.js'), 'export default 1;');
  execFileSync('git', ['add', '.'], { cwd: dir });
  execFileSync('git', ['commit', '-m', commitMsg], { cwd: dir });
  return dir;
}

function makeCtx(overrides: Record<string, unknown> = {}): CoreContext & Partial<ChangesetContext> {
  return {
    config: {
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
    },
    packages: [
      {
        name: 'pkg-a',
        version: '1.0.0',
        dir: '/tmp/a',
        packageJson: {},
        config: {} as ResolvedConfig,
      },
    ],
    mode: 'ci' as const,
    dryRun: false,
    ...overrides,
  } as any;
}

describe('determineVersionStep', () => {
  it('determines version from changesets', async () => {
    const ctx = makeCtx({
      changesets: [{ id: 'abc', summary: 'feat', releases: [{ name: 'pkg-a', type: 'minor' }] }],
    });
    ctx.config.changesets = { enabled: true, enforceInPR: false };

    const result = await determineVersionStep.execute(ctx as any);
    expect(result.versionBumps.get('pkg-a')).toEqual({
      packageName: 'pkg-a',
      from: '1.0.0',
      to: '1.1.0',
      type: 'minor',
    });
  });

  it('is a no-op (empty bumps) in CI when changesets enabled but none present', async () => {
    const ctx = makeCtx();
    ctx.config.changesets = { enabled: true, enforceInPR: false };
    const result = await determineVersionStep.execute(ctx as any);
    expect(result.versionBumps.size).toBe(0);
    expect(result.isPrerelease).toBe(false);
  });

  it('lets --bump override in CI even when changesets enabled but none present', async () => {
    const ctx = makeCtx({ cliArgs: { bump: 'patch' } });
    ctx.config.changesets = { enabled: true, enforceInPR: false };
    const result = await determineVersionStep.execute(ctx as any);
    expect(result.versionBumps.get('pkg-a')?.to).toBe('1.0.1');
  });

  it('uses --bump arg in CI mode without changesets', async () => {
    const ctx = makeCtx({ cliArgs: { bump: 'patch' } });
    const result = await determineVersionStep.execute(ctx as any);
    expect(result.versionBumps.get('pkg-a')?.to).toBe('1.0.1');
  });

  it('takes highest bump when multiple changesets affect same package', async () => {
    const ctx = makeCtx({
      changesets: [
        { id: 'a', summary: 'fix', releases: [{ name: 'pkg-a', type: 'patch' }] },
        { id: 'b', summary: 'feat', releases: [{ name: 'pkg-a', type: 'minor' }] },
      ],
    });
    ctx.config.changesets = { enabled: true, enforceInPR: false };

    const result = await determineVersionStep.execute(ctx as any);
    expect(result.versionBumps.get('pkg-a')?.type).toBe('minor');
  });

  it('returns isPrerelease: false when no --pre flag', async () => {
    const ctx = makeCtx({ cliArgs: { bump: 'patch' } });
    const result = await determineVersionStep.execute(ctx as any);
    expect(result.isPrerelease).toBe(false);
  });

  it('applies prerelease suffix with --pre and --bump', async () => {
    // Mock fetch for registry lookup (404 = new package)
    const mockFetch = vi.fn().mockResolvedValue({
      status: 404,
      ok: false,
    });
    const origFetch = globalThis.fetch;
    globalThis.fetch = mockFetch as any;

    try {
      const ctx = makeCtx({ cliArgs: { bump: 'minor', pre: 'beta' } });
      const result = await determineVersionStep.execute(ctx as any);
      expect(result.isPrerelease).toBe(true);
      expect(result.versionBumps.get('pkg-a')?.to).toBe('1.1.0-beta.0');
      expect(result.versionBumps.get('pkg-a')?.prerelease).toBe('beta');
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('auto-increments prerelease number from registry', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({
        versions: {
          '1.1.0-beta.0': {},
          '1.1.0-beta.1': {},
          '1.0.0': {},
        },
      }),
    });
    const origFetch = globalThis.fetch;
    globalThis.fetch = mockFetch as any;

    try {
      const ctx = makeCtx({ cliArgs: { bump: 'minor', pre: 'beta' } });
      const result = await determineVersionStep.execute(ctx as any);
      expect(result.versionBumps.get('pkg-a')?.to).toBe('1.1.0-beta.2');
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('throws when a changeset names an unknown package (B3)', async () => {
    const ctx = makeCtx({
      changesets: [{ id: 'x', summary: 'feat', releases: [{ name: 'typo-pkg', type: 'minor' }] }],
    });
    ctx.config.changesets = { enabled: true, enforceInPR: false };
    await expect(determineVersionStep.execute(ctx as any)).rejects.toThrow(/unknown package/i);
  });

  it('escalates the prerelease base when a breaking change lands mid-beta (M10)', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ status: 404, ok: false });
    const origFetch = globalThis.fetch;
    globalThis.fetch = mockFetch as any;
    try {
      const ctx = makeCtx({
        cliArgs: { pre: 'beta' },
        changesets: [{ id: 'a', summary: 'boom', releases: [{ name: 'pkg-a', type: 'major' }] }],
        packages: [
          { name: 'pkg-a', version: '1.1.0-beta.1', dir: '/tmp/a', packageJson: {}, config: {} },
        ],
      });
      ctx.config.changesets = { enabled: true, enforceInPR: false };
      const result = await determineVersionStep.execute(ctx as any);
      // Breaking change → base escalates to 2.0.0, not stuck on 1.1.0.
      expect(result.versionBumps.get('pkg-a')?.to).toBe('2.0.0-beta.0');
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('applies changesets-style 0.x rule (no auto-graduate to 1.0.0)', async () => {
    const ctx = makeCtx({
      changesets: [{ id: 'a', summary: 'boom', releases: [{ name: 'pkg-a', type: 'major' }] }],
      packages: [{ name: 'pkg-a', version: '0.3.2', dir: '/tmp/a', packageJson: {}, config: {} }],
    });
    ctx.config.changesets = { enabled: true, enforceInPR: false };
    const result = await determineVersionStep.execute(ctx as any);
    expect(result.versionBumps.get('pkg-a')?.to).toBe('0.4.0');
  });

  it('conventional-commits in CI with no releasable commit is a clean no-op, not an error (H2)', async () => {
    const rootDir = repoWithCommit('chore: tidy up');
    const ctx = makeCtx({ rootDir });
    ctx.config.conventionalCommits = true;
    // Must NOT throw the "CI mode requires ..." error — a chore-only cycle is a
    // valid green no-op.
    const result = await determineVersionStep.execute(ctx as any);
    expect(result.versionBumps.size).toBe(0);
  });

  it('falls through to conventional commits in CI when changesets enabled but none present (H2)', async () => {
    const rootDir = repoWithCommit('feat: add a thing');
    const ctx = makeCtx({ rootDir });
    // Both strategies configured; no changeset files this run. The empty-changeset
    // early-return must NOT swallow the real feat: commit.
    ctx.config.changesets = { enabled: true, enforceInPR: false };
    ctx.config.conventionalCommits = true;
    const result = await determineVersionStep.execute(ctx as any);
    expect(result.versionBumps.get('pkg-a')?.to).toBe('1.1.0');
  });

  it('scopes conventional-commit bumps per package dir in a monorepo (B1)', async () => {
    const rootDir = monorepoRepo('fix: correct a bug in pkg-a');
    const ctx = makeCtx({
      rootDir,
      totalPackageCount: 2,
      packages: [
        {
          name: 'pkg-a',
          version: '1.0.0',
          dir: join(rootDir, 'packages', 'a'),
          packageJson: {},
          config: {},
        },
        {
          name: 'pkg-b',
          version: '1.0.0',
          dir: join(rootDir, 'packages', 'b'),
          packageJson: {},
          config: {},
        },
      ],
    });
    ctx.config.conventionalCommits = true;
    const result = await determineVersionStep.execute(ctx as any);
    // The fix touched only packages/a — pkg-b must NOT be bumped/published.
    expect(result.versionBumps.get('pkg-a')?.to).toBe('1.0.1');
    expect(result.versionBumps.has('pkg-b')).toBe(false);
  });

  it('still errors in CI when NO versioning strategy is configured at all', async () => {
    const rootDir = repoWithCommit('feat: whatever');
    const ctx = makeCtx({ rootDir });
    // changesets disabled, conventionalCommits false, no --bump → misconfiguration.
    await expect(determineVersionStep.execute(ctx as any)).rejects.toThrow(/CI mode requires/i);
  });

  it('handles already-prerelease version without double-bumping', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({
        versions: {
          '1.1.0-beta.0': {},
          '1.1.0-beta.1': {},
        },
      }),
    });
    const origFetch = globalThis.fetch;
    globalThis.fetch = mockFetch as any;

    try {
      // Current version is already 1.1.0-beta.1
      const ctx = makeCtx({
        cliArgs: { bump: 'minor', pre: 'beta' },
        packages: [
          { name: 'pkg-a', version: '1.1.0-beta.1', dir: '/tmp/a', packageJson: {}, config: {} },
        ],
      });
      const result = await determineVersionStep.execute(ctx as any);
      // Should NOT produce 1.2.0-beta.0 (double bump) — should stay on 1.1.0 base
      expect(result.versionBumps.get('pkg-a')?.to).toBe('1.1.0-beta.2');
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
