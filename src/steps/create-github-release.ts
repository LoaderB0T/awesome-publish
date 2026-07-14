import { relative } from 'node:path';
import { Phases } from '../pipeline/phases.js';
import type { PipelineStep } from '../pipeline/step.js';
import type { PublishContext, VersionContext, GithubReleaseContext } from '../pipeline/context.js';
import { GitHubService, parseGitHubRepo } from '../services/github.js';
import { GitService } from '../services/git.js';
import { buildTagName } from './git-tag.js';
import { debug } from '../services/debug.js';

export const createGithubReleaseStep: PipelineStep<
  PublishContext & VersionContext & { rootDir: string },
  GithubReleaseContext
> = {
  name: 'github-release',
  phase: Phases.GITHUB_RELEASE,
  after: [Phases.PUBLISH_NPM],
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

    if (ctx.config.github.releases.mode === 'combined') {
      const body = buildCombinedReleaseBody(ctx);
      const now = new Date();
      const tag = `release-${now.toISOString().slice(0, 10)}-${now.toISOString().slice(11, 19).replace(/:/g, '')}`;
      // Pin the auto-created tag to the release commit; without target_commitish
      // GitHub tags the default branch's HEAD, which may not be the release commit.
      const target = await git.getHeadSha();
      debug('github-release', `creating combined release: ${tag} @ ${target ?? 'default branch'}`);
      const { id } = await github.createRelease({
        tag,
        body,
        draft,
        prerelease: isPrerelease,
        target: target ?? undefined,
      });
      debug('github-release', `created combined release id=${id}`);
      releaseIds.set('combined', id);
    } else {
      const isMultiPackage = (ctx.totalPackageCount ?? ctx.packages.length) > 1;
      // Pin releases to the release commit; with gitTag disabled the tag doesn't
      // exist yet, so without this GitHub would tag the default branch's HEAD.
      const target = await git.getHeadSha();
      for (const pkg of ctx.packages) {
        const bump = ctx.versionBumps.get(pkg.name);
        if (!bump) continue;
        const tag = buildTagName(
          pkg.name,
          bump.to,
          ctx.totalPackageCount ?? ctx.packages.length,
          ctx.config.gitTag.prefix
        );
        debug('github-release', `creating release for ${pkg.name}: ${tag}`);
        // Use the tag captured before git-tag created this release's tag —
        // querying git here would return the just-created tag and produce an
        // empty commit range (and empty release notes).
        const previousTag = ctx.previousTags?.get(pkg.name) ?? null;
        // In a monorepo scope commits to the package dir so the body isn't
        // repo-wide. First release (no prior tag) → whole history.
        const scope = isMultiPackage ? relative(ctx.rootDir, pkg.dir) : undefined;
        const commits = previousTag
          ? await git.getCommitsSinceTag(previousTag, scope)
          : await git.getAllCommits(scope);
        const body = commits.map(c => `- ${c.message}`).join('\n');
        const { id } = await github.createRelease({
          tag,
          body,
          draft,
          prerelease: isPrerelease,
          target: target ?? undefined,
        });
        debug('github-release', `created release ${pkg.name} id=${id}`);
        releaseIds.set(pkg.name, id);
      }
    }

    return { releaseIds };
  },
};

export function buildCombinedReleaseBody(ctx: PublishContext & VersionContext): string {
  const lines: string[] = ['## Published packages\n'];
  for (const [name] of ctx.publishResults) {
    const bump = ctx.versionBumps.get(name);
    if (bump) lines.push(`- **${name}**: ${bump.from} → ${bump.to}`);
  }
  return lines.join('\n');
}
