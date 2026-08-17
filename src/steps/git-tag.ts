import semver from 'semver';
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

/**
 * Inverse of {@link buildTagName}: pull the version back out of a tag, or null
 * if the tag doesn't belong to this package / isn't valid semver. Used to rank
 * existing tags when resolving "the release before this one".
 */
export function parseTagVersion(
  tag: string,
  packageName: string,
  packageCount: number,
  prefix: string
): string | null {
  const head = tagMatchPrefix(packageName, packageCount, prefix);
  if (!tag.startsWith(head)) return null;
  const version = tag.slice(head.length);
  return semver.valid(version) ? version : null;
}

/**
 * Deterministic tag for a `combined` GitHub release, derived from the commit the
 * release is cut from. A timestamp would make every retry produce a new tag —
 * and therefore a duplicate release — so the commit is the identity.
 */
export function buildCombinedTagName(releaseCommit: string): string {
  return `release-${releaseCommit.slice(0, 7)}`;
}

/**
 * Human-readable title for a combined release: when it was cut.
 *
 * The tag has to be the commit (it is the key that makes a retry find the
 * existing release instead of making a second one), but a sha is a poor title,
 * and GitHub shows the tag and target commit on the release page anyway. Taken
 * from the commit's own date, not the clock, so a resumed release is still
 * titled with the moment it was originally cut.
 *
 * `commitDate` is ISO-8601 (`git show --format=%cI`); null falls back to the tag.
 */
export function buildCombinedReleaseName(tag: string, commitDate: string | null): string {
  if (!commitDate) return tag;
  const match = commitDate.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  return match ? `Release ${match[1]} ${match[2]}` : tag;
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
