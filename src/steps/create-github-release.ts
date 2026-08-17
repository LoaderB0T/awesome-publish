import { relative } from 'node:path';
import { Phases } from '../pipeline/phases.js';
import type { PipelineStep } from '../pipeline/step.js';
import type {
  AiNotesContext,
  PublishContext,
  VersionContext,
  GithubReleaseContext,
} from '../pipeline/context.js';
import { GitHubService, parseGitHubRepo } from '../services/github.js';
import { GitService } from '../services/git.js';
import { resolveReleaseCommit } from '../services/release-state.js';
import { buildTagName, buildCombinedTagName } from './git-tag.js';
import { debug } from '../services/debug.js';

export const createGithubReleaseStep: PipelineStep<
  PublishContext & VersionContext & Partial<AiNotesContext> & { rootDir: string },
  GithubReleaseContext
> = {
  name: 'github-release',
  phase: Phases.GITHUB_RELEASE,
  // AI notes (when enabled) are written in this same request rather than PATCHed
  // in afterwards, so the release is correct the first time it is visible.
  after: [Phases.PUBLISH_NPM, Phases.AI_NOTES_GENERATE],
  before: [Phases.CLEANUP],
  hasSideEffects: true,

  shouldRun: ctx => ctx.config.github.releases.enabled && ctx.versionBumps?.size > 0,

  async execute(ctx): Promise<GithubReleaseContext> {
    const token = process.env.GITHUB_TOKEN;
    if (!token)
      throw new Error('GITHUB_TOKEN environment variable is required for GitHub releases');

    const { owner, repo } = await parseGitHubRepo(ctx.rootDir);
    debug('github-release', `repo: ${owner}/${repo}`);
    debug('github-release', 'mode', ctx.config.github.releases.mode);

    const git = new GitService(ctx.rootDir);
    const github = new GitHubService(owner, repo, token);

    const releaseIds = new Map<string, number>();
    const draft = ctx.config.github.releases.draft;
    const isPrerelease = ctx.isPrerelease;
    debug('github-release', 'draft', draft);
    debug('github-release', 'prerelease', isPrerelease);

    const packageCount = ctx.totalPackageCount ?? ctx.packages.length;

    /**
     * Write the release in a single request — including AI notes, so the body is
     * right the first time it is visible rather than being PATCHed a moment later.
     *
     * When the tag already has a release (a re-run or `--resume`) bring its body
     * up to date: a release left with a stale or empty body is exactly what a
     * half-finished run produces, and reusing it untouched would make that
     * permanent. That refresh is best-effort — the release itself already exists,
     * so an API blip here must not fail a run that has nothing left to do.
     */
    const writeRelease = async (
      key: string,
      options: { tag: string; body: string; target?: string }
    ): Promise<void> => {
      const { id, existed } = await github.createRelease({
        ...options,
        draft,
        prerelease: isPrerelease,
      });
      releaseIds.set(key, id);
      if (!existed) {
        debug('github-release', `created release ${options.tag} id=${id}`);
        return;
      }
      debug('github-release', `release ${options.tag} already existed (id=${id}), updating body`);
      try {
        await github.updateRelease(id, options.body);
      } catch (error: any) {
        console.warn(
          `⚠ GitHub release ${options.tag} already exists but its body could not be updated: ${error?.message ?? error}`
        );
      }
    };

    if (ctx.config.github.releases.mode === 'combined') {
      const body = buildCombinedReleaseBody(ctx);
      // Pin the auto-created tag to the release commit; without target_commitish
      // GitHub tags the default branch's HEAD, which may not be the release commit.
      const first = [...ctx.versionBumps.values()][0];
      const target = await resolveReleaseCommit(git, {
        packageName: first.packageName,
        version: first.to,
        packageCount,
        config: ctx.config,
      });
      if (!target) {
        throw new Error(
          'Cannot create a combined GitHub release: no release commit could be resolved (is this a git repo with at least one commit?).'
        );
      }
      // Derived from the commit, NOT a timestamp: a retry must produce the same
      // tag, or it creates a second release for a release that already exists.
      const tag = buildCombinedTagName(target);
      debug('github-release', `creating combined release: ${tag} @ ${target}`);
      // Keep the "Published packages" version table above the AI notes —
      // the table is the factual part, the notes are the prose.
      const notes = [...(ctx.releaseNotes ?? new Map<string, string>()).entries()]
        .map(([name, n]) => `## ${name}\n\n${n}`)
        .join('\n\n---\n\n');
      await writeRelease('combined', {
        tag,
        body: notes ? `${body}\n\n${notes}` : body,
        target,
      });
    } else {
      const isMultiPackage = packageCount > 1;
      for (const pkg of ctx.packages) {
        const bump = ctx.versionBumps.get(pkg.name);
        if (!bump) continue;
        const tag = buildTagName(pkg.name, bump.to, packageCount, ctx.config.gitTag.prefix);
        // Pin the release to the commit its tag points at, falling back to HEAD.
        // Resolving via the tag is what lets a `--resume` days later attribute
        // the release to the original commit instead of whatever main is now.
        const target = await resolveReleaseCommit(git, {
          packageName: pkg.name,
          version: bump.to,
          packageCount,
          config: ctx.config,
        });
        debug('github-release', `creating release for ${pkg.name}: ${tag}`);
        // AI notes replace the raw commit list — don't walk the log to build a
        // body that is about to be thrown away (a first release walks the whole
        // history).
        let body = ctx.releaseNotes?.get(pkg.name);
        if (!body) {
          // Use the tag captured before git-tag created this release's tag —
          // querying git here would return the just-created tag and produce an
          // empty commit range (and empty release notes).
          const previousTag = ctx.previousTags?.get(pkg.name) ?? null;
          // In a monorepo scope commits to the package dir so the body isn't
          // repo-wide. First release (no prior tag) → whole history.
          const scope = isMultiPackage ? relative(ctx.rootDir, pkg.dir) : undefined;
          // End the range at the release commit, not HEAD: on a resume days later
          // HEAD carries commits that are not part of this release.
          const head = target ?? 'HEAD';
          const commits = previousTag
            ? await git.getCommitsSinceTag(previousTag, scope, head)
            : await git.getAllCommits(scope, head);
          body = commits.map(c => `- ${c.message}`).join('\n');
        }
        await writeRelease(pkg.name, { tag, body, target: target ?? undefined });
      }
    }

    return { releaseIds };
  },
};

export function buildCombinedReleaseBody(ctx: PublishContext & VersionContext): string {
  const lines: string[] = ['## Published packages\n'];
  // Driven by versionBumps, not publishResults: a `--resume` run skips packages
  // npm already has, which would otherwise leave them out of the release body.
  for (const [name, bump] of ctx.versionBumps) {
    lines.push(
      bump.from === bump.to
        ? `- **${name}**: ${bump.to}`
        : `- **${name}**: ${bump.from} → ${bump.to}`
    );
  }
  return lines.join('\n');
}
