import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { Phases } from '../pipeline/phases.js';
import type { PipelineStep } from '../pipeline/step.js';
import type { VersionContext, ChangesetContext, ChangelogContext } from '../pipeline/context.js';
import type { Changeset } from '../types/changeset.js';
import type { VersionBump } from '../types/package-info.js';
import { GitService } from '../services/git.js';
import { groupCommitsByType } from '../services/conventional-commits.js';
import { debug } from '../services/debug.js';

const TYPE_HEADERS: Record<string, string> = {
  feat: 'Features',
  fix: 'Bug Fixes',
  perf: 'Performance',
  docs: 'Documentation',
  refactor: 'Refactoring',
  chore: 'Chores',
  test: 'Tests',
  ci: 'CI',
  build: 'Build',
  style: 'Styles',
};

function formatDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function buildChangelogEntry(
  pkg: { name: string },
  bump: VersionBump,
  changesets: Changeset[] | undefined,
  commits: { hash: string; message: string }[],
  isMultiPackage: boolean
): string {
  const lines: string[] = [];
  const heading = isMultiPackage
    ? `## ${pkg.name} ${bump.to} (${formatDate()})`
    : `## ${bump.to} (${formatDate()})`;
  lines.push(heading);
  lines.push('');

  // Changeset summaries. Sort by id for a deterministic order across machines
  // (readdir order is filesystem-dependent) and de-dup identical summaries so a
  // repeated note is not listed twice.
  const pkgChangesets = changesets
    ?.filter(cs => cs.releases.some(r => r.name === pkg.name))
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id));
  if (pkgChangesets?.length) {
    const seen = new Set<string>();
    for (const cs of pkgChangesets) {
      const summary = cs.summary.trim();
      if (seen.has(summary)) continue;
      seen.add(summary);
      lines.push(`- ${summary}`);
    }
    lines.push('');
    return lines.join('\n');
  }

  // Fall back to conventional commits
  const grouped = groupCommitsByType(commits);
  if (grouped.size > 0) {
    for (const [type, typeCommits] of grouped) {
      const header = TYPE_HEADERS[type] ?? type;
      lines.push(`### ${header}`);
      lines.push('');
      for (const c of typeCommits) {
        const scope = c.scope ? `**${c.scope}:** ` : '';
        lines.push(`- ${scope}${c.description}`);
      }
      lines.push('');
    }
    return lines.join('\n');
  }

  // Fall back to raw commits
  if (commits.length > 0) {
    for (const c of commits) {
      lines.push(`- ${c.message}`);
    }
    lines.push('');
    return lines.join('\n');
  }

  lines.push('- Version bump');
  lines.push('');
  return lines.join('\n');
}

export const writeChangelogStep: PipelineStep<
  VersionContext & Partial<ChangesetContext> & { rootDir: string },
  ChangelogContext
> = {
  name: 'write-changelog',
  phase: Phases.WRITE_CHANGELOG,
  after: [Phases.WRITE_VERSIONS],
  before: [Phases.BUILD_TEMP_DIR],
  hasSideEffects: true,

  shouldRun: ctx => ctx.config.changelog.enabled && ctx.versionBumps?.size > 0 && !ctx.isPrerelease,

  async execute(ctx): Promise<ChangelogContext> {
    const git = new GitService(ctx.rootDir);
    const changesets: Changeset[] | undefined = (ctx as any).changesets;
    const isMultiPackage = ctx.packages.length > 1;
    const changelogEntries = new Map<string, string>();

    for (const pkg of ctx.packages) {
      const bump = ctx.versionBumps.get(pkg.name);
      if (!bump) continue;

      const latestTag = ctx.previousTags?.get(pkg.name) ?? null;
      // In a monorepo scope commits to the package's own directory so its
      // changelog doesn't list every repo-wide commit.
      const scope = isMultiPackage ? relative(ctx.rootDir, pkg.dir) : undefined;
      // No prior tag → first release: scan the whole history so the changelog
      // isn't empty (mirrors determine-version).
      const commits = latestTag
        ? await git.getCommitsSinceTag(latestTag, scope)
        : await git.getAllCommits(scope);
      debug(
        'write-changelog',
        `${pkg.name}: ${commits.length} commits since ${latestTag ?? 'beginning'}`
      );

      const entry = buildChangelogEntry(pkg, bump, changesets, commits, isMultiPackage);
      changelogEntries.set(pkg.name, entry);

      // Write to changelog file
      const changelogPath = isMultiPackage
        ? join(pkg.dir, ctx.config.changelog.file)
        : join(ctx.rootDir, ctx.config.changelog.file);

      let existing = '';
      if (existsSync(changelogPath)) {
        existing = readFileSync(changelogPath, 'utf-8');
      }

      // Idempotency: if this exact version already has a heading (e.g. a prior
      // run wrote the changelog but the publish failed and this is a retry),
      // don't prepend a second block for the same version.
      const versionHeading = isMultiPackage ? `## ${pkg.name} ${bump.to} (` : `## ${bump.to} (`;
      if (existing.includes(versionHeading)) {
        debug('write-changelog', `${pkg.name}: ${bump.to} already in changelog, skipping`);
        changelogEntries.set(pkg.name, entry);
        continue;
      }

      // Insert after title line (# Changelog) or at top
      const titleMatch = existing.match(/^# .+\n/);
      const newContent = titleMatch
        ? `${titleMatch[0]}\n${entry}${existing.slice(titleMatch[0].length)}`
        : `# Changelog\n\n${entry}${existing}`;

      debug('write-changelog', `writing ${changelogPath}`);
      writeFileSync(changelogPath, newContent);
    }

    return { changelogEntries };
  },
};
