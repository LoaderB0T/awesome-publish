import { unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { Phases } from '../pipeline/phases.js';
import type { PipelineStep } from '../pipeline/step.js';
import type { ChangesetContext } from '../pipeline/context.js';
import { debug } from '../services/debug.js';

export const consumeChangesetsStep: PipelineStep<ChangesetContext & { rootDir: string }> = {
  name: 'consume-changesets',
  phase: Phases.CONSUME_CHANGESETS,
  // Delete changeset files only AFTER a successful publish, but before the
  // release commit so the deletion is committed. For the `version` command
  // (no publish step) the PUBLISH_NPM constraint is dropped and this simply
  // runs before git-commit. This prevents losing version intent when publish
  // fails partway.
  //
  // Also after AI note generation: between the delete and the commit the
  // changesets exist nowhere but git's index, and generating notes is a slow
  // network call to an AI provider. Ordering it first shrinks that window to
  // nothing.
  after: [Phases.DETERMINE_VERSION, Phases.PUBLISH_NPM, Phases.AI_NOTES_GENERATE],
  before: [Phases.GIT_COMMIT],
  hasSideEffects: true,

  shouldRun: ctx => ctx.changesets?.length > 0 && !(ctx as any).isPrerelease,

  async execute(ctx): Promise<void> {
    for (const cs of ctx.changesets) {
      const filePath = join(ctx.rootDir, '.changeset', `${cs.id}.md`);
      if (existsSync(filePath)) {
        debug('consume-changesets', `deleting ${filePath}`);
        unlinkSync(filePath);
      }
    }
    debug('consume-changesets', `consumed ${ctx.changesets.length} changesets`);
  },
};
