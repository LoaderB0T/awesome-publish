import { Phases } from '../pipeline/phases.js';
import type { PipelineStep } from '../pipeline/step.js';
import type { VersionContext } from '../pipeline/context.js';
import { parseGitHubRepo } from '../services/github.js';
import { debug } from '../services/debug.js';

/**
 * Validate everything the later (post-publish) steps need BEFORE the
 * irreversible npm publish, so a missing token or unparseable remote fails the
 * run early instead of after packages are already live on npm.
 *
 * hasSideEffects is false so this also runs under --dry-run (a dry run should
 * still catch a misconfigured GitHub release setup).
 */
export const preflightStep: PipelineStep<VersionContext & { rootDir: string }> = {
  name: 'preflight',
  phase: Phases.PREFLIGHT,
  after: [Phases.DETERMINE_VERSION],
  before: [Phases.PUBLISH_NPM],
  hasSideEffects: false,

  shouldRun: ctx => ctx.config.github.releases.enabled && ctx.versionBumps?.size > 0,

  async execute(ctx): Promise<void> {
    if (!process.env.GITHUB_TOKEN) {
      throw new Error(
        'GITHUB_TOKEN environment variable is required for GitHub releases (github.releases.enabled). ' +
          'Set it before publishing, or disable github.releases.'
      );
    }
    // Fail here (before publish) if the origin remote can't be parsed, rather
    // than crashing in create-github-release after npm publish already ran.
    const { owner, repo } = await parseGitHubRepo((ctx as any).rootDir);
    debug('preflight', `github repo resolved: ${owner}/${repo}`);
  },
};
