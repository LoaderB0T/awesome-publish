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
  prefix: string
): string {
  // Single-package: v1.2.3 or prefix-v1.2.3
  // Multi-package: pkg-name@1.2.3 or prefix-pkg-name@1.2.3
  return packageCount === 1 ? `${prefix}v${version}` : `${prefix}${packageName}@${version}`;
}

/**
 * Build the `git describe --match` prefix that finds the latest tag for a
 * package, matching whatever scheme buildTagName produces (so single-package
 * repos and prefixed tags resolve correctly). Callers pass the result to
 * GitService.getLatestTag, which appends the `*` glob.
 */
export function tagMatchPrefix(packageName: string, packageCount: number, prefix: string): string {
  return packageCount === 1 ? `${prefix}v` : `${prefix}${packageName}@`;
}

export const gitTagStep: PipelineStep<VersionContext & { rootDir: string }> = {
  name: 'git-tag',
  phase: Phases.GIT_TAG,
  after: [Phases.PUBLISH_NPM, Phases.GIT_COMMIT],
  before: [Phases.GITHUB_RELEASE],
  hasSideEffects: true,

  shouldRun: ctx => ctx.config.gitTag.enabled && ctx.versionBumps?.size > 0,

  async execute(ctx): Promise<void> {
    const git = new GitService(ctx.rootDir);
    const prefix = ctx.config.gitTag.prefix;

    const created: string[] = [];
    for (const pkg of ctx.packages) {
      const bump = ctx.versionBumps.get(pkg.name);
      if (!bump) continue;

      const tag = buildTagName(
        pkg.name,
        bump.to,
        ctx.totalPackageCount ?? ctx.packages.length,
        prefix
      );
      // Skip tags that already exist rather than aborting an otherwise-successful
      // publish (e.g. a re-run after the npm publish succeeded but tagging failed).
      if (await git.tagExists(tag)) {
        console.warn(`⚠ git tag "${tag}" already exists — skipping`);
        debug('git-tag', `tag exists, skipping: ${tag}`);
        continue;
      }
      debug('git-tag', `creating tag: ${tag}`);
      await git.createTag(tag);
      created.push(tag);
    }

    if (created.length === 0) {
      debug('git-tag', 'no new tags created, nothing to push');
      return;
    }

    // Push only the tags we created (not every local tag).
    debug('git-tag', 'pushing tags to remote', created);
    await git.pushTags(created);
  },
};
