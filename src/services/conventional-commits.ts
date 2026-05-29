import type { Commit } from './git.js';

const BUMP_TYPE_MAP: Record<string, 'patch' | 'minor' | 'major'> = {
  fix: 'patch',
  perf: 'patch',
  docs: 'patch',
  chore: 'patch',
  refactor: 'patch',
  style: 'patch',
  test: 'patch',
  ci: 'patch',
  build: 'patch',
  feat: 'minor',
};

export interface ConventionalCommit {
  type: string;
  scope?: string;
  breaking: boolean;
  description: string;
  original: Commit;
}

export function parseConventionalCommit(commit: Commit): ConventionalCommit | null {
  const match = commit.message.match(/^(\w+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/);
  if (!match) return null;

  const [, type, scope, bang, description] = match;
  return {
    type: type.toLowerCase(),
    scope: scope || undefined,
    breaking: !!bang,
    description,
    original: commit,
  };
}

export function determineBumpFromCommits(commits: Commit[]): 'patch' | 'minor' | 'major' | null {
  if (commits.length === 0) return null;

  let highest: 'patch' | 'minor' | 'major' | null = null;

  for (const commit of commits) {
    const parsed = parseConventionalCommit(commit);
    if (!parsed) continue;

    if (parsed.breaking) return 'major';

    const bump = BUMP_TYPE_MAP[parsed.type];
    if (!bump) continue;

    if (!highest || (bump === 'minor' && highest === 'patch')) {
      highest = bump;
    }
  }

  return highest;
}

export function groupCommitsByType(commits: Commit[]): Map<string, ConventionalCommit[]> {
  const groups = new Map<string, ConventionalCommit[]>();

  for (const commit of commits) {
    const parsed = parseConventionalCommit(commit);
    if (!parsed) continue;

    const existing = groups.get(parsed.type) ?? [];
    existing.push(parsed);
    groups.set(parsed.type, existing);
  }

  return groups;
}
