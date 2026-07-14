import { describe, it, expect } from 'vitest';
import {
  parseConventionalCommit,
  determineBumpFromCommits,
} from '../../src/services/conventional-commits.js';
import type { Commit } from '../../src/services/git.js';

function commit(message: string, body?: string): Commit {
  return { hash: 'abc123', message, body };
}

describe('parseConventionalCommit', () => {
  it('parses feat commit', () => {
    const result = parseConventionalCommit(commit('feat: add new thing'));
    expect(result).toBeDefined();
    expect(result!.type).toBe('feat');
    expect(result!.description).toBe('add new thing');
    expect(result!.breaking).toBe(false);
  });

  it('parses fix with scope', () => {
    const result = parseConventionalCommit(commit('fix(auth): handle expired tokens'));
    expect(result!.type).toBe('fix');
    expect(result!.scope).toBe('auth');
    expect(result!.description).toBe('handle expired tokens');
  });

  it('detects breaking change with !', () => {
    const result = parseConventionalCommit(commit('feat!: remove deprecated API'));
    expect(result!.breaking).toBe(true);
  });

  it('detects breaking change with scope and !', () => {
    const result = parseConventionalCommit(commit('refactor(core)!: rewrite internals'));
    expect(result!.breaking).toBe(true);
    expect(result!.scope).toBe('core');
  });

  it('detects BREAKING CHANGE footer in the commit body', () => {
    const result = parseConventionalCommit(
      commit('feat: new api', 'Adds the new api.\n\nBREAKING CHANGE: old api removed')
    );
    expect(result!.breaking).toBe(true);
  });

  it('detects the BREAKING-CHANGE hyphenated footer', () => {
    const result = parseConventionalCommit(
      commit('fix: tweak', 'BREAKING-CHANGE: signature changed')
    );
    expect(result!.breaking).toBe(true);
  });

  it('returns null for non-conventional commit', () => {
    expect(parseConventionalCommit(commit('update stuff'))).toBeNull();
    expect(parseConventionalCommit(commit('WIP'))).toBeNull();
  });
});

describe('determineBumpFromCommits', () => {
  it('returns major for breaking change', () => {
    const commits = [commit('fix: small fix'), commit('feat!: breaking change')];
    expect(determineBumpFromCommits(commits)).toBe('major');
  });

  it('returns major when a body carries a BREAKING CHANGE footer', () => {
    const commits = [commit('feat: thing', 'BREAKING CHANGE: dropped support for X')];
    expect(determineBumpFromCommits(commits)).toBe('major');
  });

  it('returns minor for feat', () => {
    const commits = [commit('fix: bug'), commit('feat: new feature')];
    expect(determineBumpFromCommits(commits)).toBe('minor');
  });

  it('returns patch for fix only', () => {
    const commits = [commit('fix: bug'), commit('fix: another bug')];
    expect(determineBumpFromCommits(commits)).toBe('patch');
  });

  it('returns null for no conventional commits', () => {
    const commits = [commit('update readme'), commit('misc changes')];
    expect(determineBumpFromCommits(commits)).toBeNull();
  });

  it('does not release on maintenance-only types (chore/docs/etc)', () => {
    // Standard Conventional Commits: only fix/feat (and breaking) release.
    const commits = [
      commit('chore: bump deps'),
      commit('docs: update readme'),
      commit('style: reformat'),
      commit('test: add cases'),
      commit('ci: tweak workflow'),
      commit('build: config'),
      commit('refactor: internals'),
      commit('perf: speed up'),
    ];
    expect(determineBumpFromCommits(commits)).toBeNull();
  });

  it('still detects a breaking change even on a non-release type', () => {
    const commits = [commit('refactor(core)!: drop old path')];
    expect(determineBumpFromCommits(commits)).toBe('major');
  });

  it('returns null for empty commits', () => {
    expect(determineBumpFromCommits([])).toBeNull();
  });
});
