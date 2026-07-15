import { Phases } from '../pipeline/phases.js';
import type { PipelineStep } from '../pipeline/step.js';
import type { VersionContext } from '../pipeline/context.js';
import { GitService } from '../services/git.js';
import { debug } from '../services/debug.js';

/**
 * Commit the version bump (and changelog / consumed changesets) so the git tag
 * points at a commit that actually contains the release, and the working tree
 * is left clean afterwards.
 *
 * Runs after publish-npm (so nothing is committed if the publish fails) and
 * before git-tag. For the `version` command there is no publish step, so the
 * PUBLISH_NPM constraint is dropped and this simply runs after write-versions.
 */
export const gitCommitStep: PipelineStep<VersionContext & { rootDir: string }> = {
  name: 'git-commit',
  phase: Phases.GIT_COMMIT,
  after: [Phases.PUBLISH_NPM, Phases.WRITE_VERSIONS, Phases.WRITE_CHANGELOG],
  before: [Phases.GIT_TAG],
  hasSideEffects: true,

  shouldRun: ctx => ctx.versionBumps?.size > 0,

  async execute(ctx): Promise<void> {
    const git = new GitService(ctx.rootDir);
    const bumps = [...ctx.versionBumps.values()];

    const message =
      bumps.length === 1
        ? `chore: release v${bumps[0].to}`
        : `chore: release\n\n${bumps.map(b => `- ${b.packageName}@${b.to}`).join('\n')}`;

    debug(
      'git-commit',
      'committing release',
      bumps.map(b => `${b.packageName}@${b.to}`)
    );
    await git.commitAll(message);
    debug('git-commit', 'pushing release commit');
    try {
      await git.pushCurrentBranch();
    } catch (error: any) {
      // The commit (incl. any consumed-changeset deletions) is already made
      // locally; a push failure here leaves a clean tree, so a naive re-run
      // would be a silent no-op while npm may already be published. Tell the
      // user exactly how to finish the release by hand.
      throw new Error(
        `Release commit created locally but the push failed: ${error?.message ?? error}\n` +
          `  npm packages may already be published. Finish the release manually:\n` +
          `    git push && git push --tags\n` +
          `  then create the GitHub release(s) if enabled.`
      );
    }
  },
};
