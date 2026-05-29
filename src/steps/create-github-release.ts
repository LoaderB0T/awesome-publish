import { Phases } from '../pipeline/phases.js';
import type { PipelineStep } from '../pipeline/step.js';
import type { PublishContext, VersionContext, GithubReleaseContext } from '../pipeline/context.js';
import { GitHubService } from '../services/github.js';
import { GitService } from '../services/git.js';
import { debug } from '../services/debug.js';

export const createGithubReleaseStep: PipelineStep<PublishContext & VersionContext & { rootDir: string }, GithubReleaseContext> = {
  name: 'github-release',
  phase: Phases.GITHUB_RELEASE,
  after: [Phases.PUBLISH_NPM],
  before: [Phases.CLEANUP],
  hasSideEffects: true,

  shouldRun: (ctx) => ctx.config.github.releases.enabled,

  async execute(ctx): Promise<GithubReleaseContext> {
    const token = process.env.GITHUB_TOKEN;
    if (!token) throw new Error('GITHUB_TOKEN environment variable is required for GitHub releases');

    const { owner, repo } = await getRepoInfo(ctx.rootDir);
    debug('github-release', `repo: ${owner}/${repo}`);
    debug('github-release', 'mode', ctx.config.github.releases.mode);

    const git = new GitService(ctx.rootDir);
    const github = new GitHubService(owner, repo, token);

    const releaseIds = new Map<string, number>();
    const draft = ctx.config.github.releases.draft;
    debug('github-release', 'draft', draft);

    if (ctx.config.github.releases.mode === 'combined') {
      const body = buildCombinedReleaseBody(ctx);
      const tag = `release-${new Date().toISOString().slice(0, 10)}`;
      debug('github-release', `creating combined release: ${tag}`);
      const { id } = await github.createRelease(tag, body, draft);
      debug('github-release', `created combined release id=${id}`);
      releaseIds.set('combined', id);
    } else {
      for (const pkg of ctx.packages) {
        const bump = ctx.versionBumps.get(pkg.name);
        if (!bump) continue;
        const tag = `${pkg.name}@${bump.to}`;
        debug('github-release', `creating release for ${pkg.name}: ${tag}`);
        const latestTag = await git.getLatestTag(pkg.name);
        const body = latestTag
          ? (await git.getCommitsSinceTag(latestTag)).map(c => `- ${c.message}`).join('\n')
          : '';
        const { id } = await github.createRelease(tag, body, draft);
        debug('github-release', `created release ${pkg.name} id=${id}`);
        releaseIds.set(pkg.name, id);
      }
    }

    return { releaseIds };
  },
};

function buildCombinedReleaseBody(ctx: PublishContext & VersionContext): string {
  const lines: string[] = ['## Published packages\n'];
  for (const [name] of ctx.publishResults) {
    const bump = ctx.versionBumps.get(name);
    if (bump) lines.push(`- **${name}**: ${bump.from} → ${bump.to}`);
  }
  return lines.join('\n');
}

async function getRepoInfo(cwd: string): Promise<{ owner: string; repo: string }> {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const exec = promisify(execFile);
  const { stdout } = await exec('git', ['remote', 'get-url', 'origin'], { cwd });
  const match = stdout.trim().match(/[:/]([^/]+)\/([^/.]+?)(?:\.git)?$/);
  if (!match) throw new Error('Could not parse GitHub owner/repo from git remote');
  return { owner: match[1], repo: match[2] };
}
