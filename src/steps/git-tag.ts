import { Phases } from '../pipeline/phases.js';
import type { PipelineStep } from '../pipeline/step.js';
import type { VersionContext } from '../pipeline/context.js';
import { GitService } from '../services/git.js';
import { debug } from '../services/debug.js';

/**
 * Build tag name for a package. Used by both git-tag and github-release
 * to keep formats aligned.
 */
export function buildTagName(
  packageName: string,
  version: string,
  packageCount: number,
  prefix: string,
): string {
  // Single-package: v1.2.3 or prefix-v1.2.3
  // Multi-package: pkg-name@1.2.3 or prefix-pkg-name@1.2.3
  return packageCount === 1
    ? `${prefix}v${version}`
    : `${prefix}${packageName}@${version}`;
}

export const gitTagStep: PipelineStep<VersionContext & { rootDir: string }> = {
  name: 'git-tag',
  phase: Phases.GIT_TAG,
  after: [Phases.PUBLISH_NPM],
  before: [Phases.GITHUB_RELEASE],
  hasSideEffects: true,

  shouldRun: (ctx) => ctx.config.gitTag.enabled,

  async execute(ctx): Promise<void> {
    const git = new GitService(ctx.rootDir);
    const prefix = ctx.config.gitTag.prefix;

    for (const pkg of ctx.packages) {
      const bump = ctx.versionBumps.get(pkg.name);
      if (!bump) continue;

      const tag = buildTagName(pkg.name, bump.to, ctx.packages.length, prefix);
      debug('git-tag', `creating tag: ${tag}`);
      await git.createTag(tag);
    }

    // Push tags to remote
    debug('git-tag', 'pushing tags to remote');
    await git.pushTags();
  },
};
