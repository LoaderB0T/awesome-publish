import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import {
  buildTagName,
  parseTagVersion,
  buildCombinedTagName,
  buildCombinedReleaseName,
  previousReleaseTag,
} from '../../src/steps/git-tag.js';
import { GitService } from '../../src/services/git.js';

describe('buildTagName', () => {
  it('single package: v{version}', () => {
    expect(buildTagName('my-pkg', '1.2.3', 1, '')).toBe('v1.2.3');
  });

  it('single package with prefix', () => {
    expect(buildTagName('my-pkg', '1.2.3', 1, 'release-')).toBe('release-v1.2.3');
  });

  it('multi-package: {name}@{version}', () => {
    expect(buildTagName('my-pkg', '1.2.3', 3, '')).toBe('my-pkg@1.2.3');
  });

  it('multi-package with prefix', () => {
    expect(buildTagName('@scope/pkg', '2.0.0', 2, 'v-')).toBe('v-@scope/pkg@2.0.0');
  });
});

describe('parseTagVersion', () => {
  it('round-trips every buildTagName shape', () => {
    const cases: [string, string, number, string][] = [
      ['my-pkg', '1.2.3', 1, ''],
      ['my-pkg', '1.2.3', 1, 'release-'],
      ['my-pkg', '1.2.3', 3, ''],
      ['@scope/pkg', '2.0.0-beta.1', 2, 'v-'],
    ];
    for (const [name, version, count, prefix] of cases) {
      const tag = buildTagName(name, version, count, prefix);
      expect(parseTagVersion(tag, name, count, prefix)).toBe(version);
    }
  });

  it('rejects tags belonging to another package or without a valid version', () => {
    expect(parseTagVersion('other-pkg@1.0.0', 'my-pkg', 2, '')).toBeNull();
    expect(parseTagVersion('my-pkg@nightly', 'my-pkg', 2, '')).toBeNull();
  });
});

describe('buildCombinedTagName', () => {
  it('is derived from the commit, so a retry produces the same tag', () => {
    const sha = 'abc1234def5678901234567890abcdef12345678';
    expect(buildCombinedTagName(sha)).toBe('release-abc1234');
    expect(buildCombinedTagName(sha)).toBe(buildCombinedTagName(sha));
  });
});

describe('buildCombinedReleaseName', () => {
  it('titles the release with the commit date, not the sha tag', () => {
    expect(buildCombinedReleaseName('release-abc1234', '2026-08-17T20:07:53+00:00')).toBe(
      'Release 2026-08-17 20:07'
    );
  });

  it('falls back to the tag when the commit date is unavailable or malformed', () => {
    expect(buildCombinedReleaseName('release-abc1234', null)).toBe('release-abc1234');
    expect(buildCombinedReleaseName('release-abc1234', 'not-a-date')).toBe('release-abc1234');
  });
});

describe('previousReleaseTag', () => {
  /** Temp repo with one commit carrying every given tag. */
  function repoWithTags(tags: string[]): GitService {
    const dir = mkdtempSync(join(tmpdir(), 'ap-prt-'));
    execFileSync('git', ['init'], { cwd: dir });
    execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
    writeFileSync(join(dir, 'f.txt'), 'x');
    execFileSync('git', ['add', '.'], { cwd: dir });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: dir });
    for (const tag of tags) execFileSync('git', ['tag', tag], { cwd: dir });
    return new GitService(dir);
  }

  const opts = { packageName: 'pkg-a', packageCount: 1, prefix: '' };

  it('a stable release skips prerelease tags', async () => {
    // Diffing 0.0.3 against its own 0.0.3-next.0 finds no commits and ships an
    // empty release body — the bug this exists to prevent.
    const git = repoWithTags(['v0.0.1', 'v0.0.2', 'v0.0.3-next.0']);
    expect(await previousReleaseTag(git, { ...opts, below: '0.0.3', stableOnly: true })).toBe(
      'v0.0.2'
    );
  });

  it('a prerelease diffs against the previous prerelease', async () => {
    const git = repoWithTags(['v0.0.2', 'v0.0.3-next.0']);
    expect(
      await previousReleaseTag(git, { ...opts, below: '0.0.3-next.1', stableOnly: false })
    ).toBe('v0.0.3-next.0');
  });

  it('excludes the version its own tag already exists for (resume)', async () => {
    const git = repoWithTags(['v0.0.2', 'v0.0.3']);
    expect(await previousReleaseTag(git, { ...opts, below: '0.0.3', stableOnly: true })).toBe(
      'v0.0.2'
    );
  });

  it('ranks by semver, not by tag creation order', async () => {
    const git = repoWithTags(['v0.0.10', 'v0.0.9']);
    expect(await previousReleaseTag(git, { ...opts, below: '0.1.0', stableOnly: true })).toBe(
      'v0.0.10'
    );
  });

  it('is null when no earlier release qualifies', async () => {
    const git = repoWithTags(['v0.0.3-next.0']);
    expect(await previousReleaseTag(git, { ...opts, below: '0.0.3', stableOnly: true })).toBeNull();
  });
});
