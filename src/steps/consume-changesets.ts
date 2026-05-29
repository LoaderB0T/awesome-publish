import { unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { Phases } from '../pipeline/phases.js';
import type { PipelineStep } from '../pipeline/step.js';
import type { ChangesetContext } from '../pipeline/context.js';
import { debug } from '../services/debug.js';

export const consumeChangesetsStep: PipelineStep<ChangesetContext & { rootDir: string }> = {
  name: 'consume-changesets',
  phase: Phases.CONSUME_CHANGESETS,
  after: [Phases.DETERMINE_VERSION],
  before: [Phases.BUILD_TEMP_DIR],
  hasSideEffects: true,

  shouldRun: (ctx) => ctx.changesets?.length > 0 && !(ctx as any).isPrerelease,

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
