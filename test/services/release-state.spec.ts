import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { detectReleaseState, describeMissingSinks } from '../../src/services/release-state.js';
import type { ResolvedConfig } from '../../src/types/config.js';
import type { PackageInfo } from '../../src/types/package-info.js';

const REGISTRY = 'https://registry.npmjs.org';

/** Temp git repo with one commit, plus any tags requested. */
function repoWithTags(tags: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'ap-rs-'));
  execFileSync('git', ['init'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  writeFileSync(join(dir, 'f.txt'), 'x');
  execFileSync('git', ['add', '.'], { cwd: dir });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: dir });
  for (const tag of tags) execFileSync('git', ['tag', tag], { cwd: dir });
  return dir;
}

function makeConfig(overrides: Partial<ResolvedConfig> = {}): ResolvedConfig {
  return {
    packageManager: 'pnpm',
    registry: REGISTRY,
    publishFiles: ['lib'],
    stripScripts: true,
    requireCleanGit: true,
    gitTag: { enabled: true, prefix: '' },
    changelog: { enabled: false, file: 'CHANGELOG.md' },
    conventionalCommits: false,
    confirmPublish: false,
    syncDependencies: false,
    changesets: { enabled: false, enforceInPR: false },
    github: { releases: { enabled: false, mode: 'per-package', draft: false } },
    aiReleaseNotes: { enabled: false },
    ...overrides,
  } as ResolvedConfig;
}

function makePackage(version: string): PackageInfo {
  return {
    name: 'pkg-a',
    version,
    dir: '/tmp/a',
    packageJson: {},
    config: {} as ResolvedConfig,
  };
}

/** Stub global fetch: registry returns `versions`, GitHub returns `release`. */
function stubFetch(opts: {
  versions?: string[] | null;
  registryError?: boolean;
  release?: { id: number } | null;
}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.startsWith('https://api.github.com')) {
        return opts.release
          ? { ok: true, status: 200, json: async () => opts.release }
          : { ok: false, status: 404 };
      }
      if (opts.registryError) throw new Error('ECONNREFUSED');
      if (opts.versions === null || opts.versions === undefined) {
        return { ok: false, status: 404 };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ versions: Object.fromEntries(opts.versions!.map(v => [v, {}])) }),
      };
    })
  );
}

function detect(dir: string, version: string, config: ResolvedConfig, strict = false) {
  return detectReleaseState({
    rootDir: dir,
    packages: [makePackage(version)],
    config,
    totalPackageCount: 1,
    registry: REGISTRY,
    strict,
  });
}

describe('detectReleaseState', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('a fully released version is not in flight', async () => {
    const dir = repoWithTags(['v0.0.3']);
    stubFetch({ versions: ['0.0.2', '0.0.3'] });

    const [state] = await detect(dir, '0.0.3', makeConfig());
    expect(state).toMatchObject({ onRegistry: true, tagged: true, inFlight: false });
  });

  it('published to npm but never tagged is in flight', async () => {
    const dir = repoWithTags(['v0.0.2']);
    stubFetch({ versions: ['0.0.2', '0.0.3'] });

    const [state] = await detect(dir, '0.0.3', makeConfig());
    expect(state).toMatchObject({ onRegistry: true, tagged: false, inFlight: true });
    expect(describeMissingSinks(state)).toBe('not tagged');
  });

  it('tagged but not on the registry is in flight', async () => {
    const dir = repoWithTags(['v0.0.2', 'v0.0.3']);
    stubFetch({ versions: ['0.0.2'] });

    const [state] = await detect(dir, '0.0.3', makeConfig());
    expect(state).toMatchObject({ onRegistry: false, tagged: true, inFlight: true });
  });

  it('tagged and published but missing its GitHub release is in flight', async () => {
    const dir = repoWithTags(['v0.0.3']);
    execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:owner/repo.git'], { cwd: dir });
    stubFetch({ versions: ['0.0.3'], release: null });
    vi.stubEnv('GITHUB_TOKEN', 'token');

    const config = makeConfig({
      github: { releases: { enabled: true, mode: 'per-package', draft: false } },
    } as Partial<ResolvedConfig>);
    const [state] = await detect(dir, '0.0.3', config);
    expect(state).toMatchObject({
      onRegistry: true,
      tagged: true,
      released: false,
      inFlight: true,
    });
    expect(describeMissingSinks(state)).toBe('no GitHub release');
  });

  it('a never-published package with no tags is unreleased, not in flight', async () => {
    // Otherwise every brand-new package would report a phantom half-finished
    // release of whatever version its package.json starts at.
    const dir = repoWithTags([]);
    stubFetch({ versions: null });

    const [state] = await detect(dir, '0.0.1', makeConfig());
    expect(state).toMatchObject({ everPublished: false, inFlight: false });
  });

  it('strict mode refuses to guess when the registry is unreachable', async () => {
    const dir = repoWithTags(['v0.0.3']);
    stubFetch({ registryError: true });

    await expect(detect(dir, '0.0.3', makeConfig(), true)).rejects.toThrow(
      /Cannot determine whether pkg-a@0\.0\.3 is published/
    );
  });

  it('non-strict mode reports not-in-flight when the registry is unreachable', async () => {
    const dir = repoWithTags(['v0.0.3']);
    stubFetch({ registryError: true });

    const [state] = await detect(dir, '0.0.3', makeConfig(), false);
    expect(state.inFlight).toBe(false);
  });
});
