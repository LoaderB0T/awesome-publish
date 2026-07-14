import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { GitService } from '../../src/services/git.js';

function createTempGitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'awesome-publish-test-'));
  execFileSync('git', ['init'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  writeFileSync(join(dir, 'file.txt'), 'initial');
  execFileSync('git', ['add', '.'], { cwd: dir });
  execFileSync('git', ['commit', '-m', 'initial'], { cwd: dir });
  return dir;
}

describe('GitService', () => {
  let dir: string;
  let git: GitService;

  beforeEach(() => {
    dir = createTempGitRepo();
    git = new GitService(dir);
  });

  it('detects clean working tree', async () => {
    expect(await git.isWorkingTreeClean()).toBe(true);
  });

  it('detects dirty working tree', async () => {
    writeFileSync(join(dir, 'dirty.txt'), 'changes');
    expect(await git.isWorkingTreeClean()).toBe(false);
  });

  it('creates and retrieves tags', async () => {
    await git.createTag('v1.0.0');
    const tag = await git.getLatestTag();
    expect(tag).toBe('v1.0.0');
  });

  it('gets commits since tag', async () => {
    await git.createTag('v1.0.0');
    writeFileSync(join(dir, 'new.txt'), 'new');
    execFileSync('git', ['add', '.'], { cwd: dir });
    execFileSync('git', ['commit', '-m', 'second commit'], { cwd: dir });
    const commits = await git.getCommitsSinceTag('v1.0.0');
    expect(commits).toHaveLength(1);
    expect(commits[0].message).toBe('second commit');
  });

  it('returns null for getLatestTag when no tags exist', async () => {
    const tag = await git.getLatestTag();
    expect(tag).toBeNull();
  });

  it('tagExists reports whether a tag is present', async () => {
    expect(await git.tagExists('v1.0.0')).toBe(false);
    await git.createTag('v1.0.0');
    expect(await git.tagExists('v1.0.0')).toBe(true);
  });

  it('commitAll stages and commits, leaving a clean tree', async () => {
    writeFileSync(join(dir, 'pkg.txt'), 'bumped');
    await git.commitAll('chore: release v1.2.3');
    expect(await git.isWorkingTreeClean()).toBe(true);
    const { stdout } = await import('node:child_process').then(
      cp =>
        new Promise<{ stdout: string }>((res, rej) =>
          cp.execFile('git', ['log', '-1', '--format=%s'], { cwd: dir }, (e, out) =>
            e ? rej(e) : res({ stdout: out })
          )
        )
    );
    expect(stdout.trim()).toBe('chore: release v1.2.3');
  });
});
