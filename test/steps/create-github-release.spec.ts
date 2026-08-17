import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createGithubReleaseStep } from '../../src/steps/create-github-release.js';
import type { ResolvedConfig } from '../../src/types/config.js';

/** Temp git repo with an origin remote, one commit "feat: a thing", tagged v0.0.3. */
function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ap-ghr-'));
  execFileSync('git', ['init'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:owner/repo.git'], { cwd: dir });
  writeFileSync(join(dir, 'f.txt'), 'x');
  execFileSync('git', ['add', '.'], { cwd: dir });
  execFileSync('git', ['commit', '-m', 'feat: a thing'], { cwd: dir });
  execFileSync('git', ['tag', 'v0.0.3'], { cwd: dir });
  return dir;
}

function makeCtx(dir: string, overrides: Record<string, unknown> = {}) {
  return {
    config: {
      registry: 'https://registry.npmjs.org',
      gitTag: { enabled: true, prefix: '' },
      github: { releases: { enabled: true, mode: 'per-package', draft: false } },
    } as unknown as ResolvedConfig,
    packages: [{ name: 'pkg-a', version: '0.0.3', dir, packageJson: {}, config: {} }],
    totalPackageCount: 1,
    versionBumps: new Map([
      ['pkg-a', { packageName: 'pkg-a', from: '0.0.2', to: '0.0.3', type: 'patch' }],
    ]),
    previousTags: new Map([['pkg-a', null]]),
    publishResults: new Map(),
    isPrerelease: false,
    rootDir: dir,
    mode: 'ci',
    dryRun: false,
    ...overrides,
  } as any;
}

/** Stub fetch; `conflict` makes the POST 422 so the existing-release path runs. */
function stubGitHub(conflict = false) {
  const calls: { method: string; url: string; body: any }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: any = {}) => {
      const method = init.method ?? 'GET';
      calls.push({ method, url, body: init.body ? JSON.parse(init.body) : undefined });

      if (method === 'POST') {
        return conflict
          ? { ok: false, status: 422, text: async () => 'already_exists' }
          : { ok: true, status: 201, json: async () => ({ id: 999 }) };
      }
      if (method === 'PATCH') return { ok: true, status: 200 };
      // GET /releases/tags/<tag>
      return { ok: true, status: 200, json: async () => ({ id: 123 }) };
    })
  );
  return calls;
}

describe('createGithubReleaseStep', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('writes AI release notes as the release body in the create request', async () => {
    // Merged from the old ai-notes-publish step: one write, so the release is
    // never briefly visible with the raw commit list before being rewritten.
    const dir = repo();
    const calls = stubGitHub();
    vi.stubEnv('GITHUB_TOKEN', 'token');

    await createGithubReleaseStep.execute(
      makeCtx(dir, { releaseNotes: new Map([['pkg-a', '## Highlights\n\nShiny.']]) })
    );

    const post = calls.find(c => c.method === 'POST');
    expect(post?.body.tag_name).toBe('v0.0.3');
    expect(post?.body.body).toBe('## Highlights\n\nShiny.');
    expect(calls.some(c => c.method === 'PATCH')).toBe(false);
  });

  it('falls back to the commit list when no AI notes were generated', async () => {
    const dir = repo();
    const calls = stubGitHub();
    vi.stubEnv('GITHUB_TOKEN', 'token');

    await createGithubReleaseStep.execute(makeCtx(dir));

    expect(calls.find(c => c.method === 'POST')?.body.body).toBe('- feat: a thing');
  });

  it('falls back to changeset summaries before the commit list', async () => {
    // Promoting a prerelease: the previous tag IS the prerelease, so the commit
    // range is empty and only the changesets still describe the release.
    const dir = repo();
    const calls = stubGitHub();
    vi.stubEnv('GITHUB_TOKEN', 'token');

    await createGithubReleaseStep.execute(
      makeCtx(dir, {
        previousTags: new Map([['pkg-a', 'v0.0.3']]), // empty range: tag is HEAD
        changesets: [
          { id: 'b', summary: 'Added a widget', releases: [{ name: 'pkg-a', type: 'minor' }] },
          { id: 'a', summary: 'Fixed a crash', releases: [{ name: 'pkg-a', type: 'patch' }] },
        ],
      })
    );

    expect(calls.find(c => c.method === 'POST')?.body.body).toBe(
      '- Fixed a crash\n- Added a widget'
    );
  });

  it('updates the body of a release that already exists (re-run / --resume)', async () => {
    // A half-finished run can leave a release with a stale or empty body;
    // reusing it untouched would make that permanent.
    const dir = repo();
    const calls = stubGitHub(true);
    vi.stubEnv('GITHUB_TOKEN', 'token');

    const result = await createGithubReleaseStep.execute(
      makeCtx(dir, { releaseNotes: new Map([['pkg-a', 'notes']]) })
    );

    const patch = calls.find(c => c.method === 'PATCH');
    expect(patch?.url).toContain('/releases/123');
    expect(patch?.body.body).toBe('notes');
    expect(result.releaseIds.get('pkg-a')).toBe(123);
  });

  it('does not fail the run when refreshing an existing release body fails', async () => {
    const dir = repo();
    stubGitHub(true);
    vi.stubEnv('GITHUB_TOKEN', 'token');
    const fetchMock = globalThis.fetch as any;
    const original = fetchMock.getMockImplementation();
    fetchMock.mockImplementation(async (url: string, init: any = {}) => {
      if ((init.method ?? 'GET') === 'PATCH')
        return { ok: false, status: 403, text: async () => 'no' };
      return original(url, init);
    });

    await expect(createGithubReleaseStep.execute(makeCtx(dir))).resolves.toBeTruthy();
  });
});
