import { AwesomeLogger } from 'awesome-logging';
import { Phases } from '../pipeline/phases.js';
import type { PipelineStep } from '../pipeline/step.js';
import type { VersionContext } from '../pipeline/context.js';
import { debug } from '../services/debug.js';

export const confirmPublishStep: PipelineStep<VersionContext> = {
  name: 'confirm-publish',
  phase: Phases.CONFIRM_PUBLISH,
  after: [Phases.DETERMINE_VERSION],
  before: [Phases.SYNC_DEPENDENCIES],
  hasSideEffects: false,

  shouldRun: ctx => ctx.config.confirmPublish && ctx.mode === 'interactive' && !ctx.dryRun,

  async execute(ctx): Promise<void> {
    const bumps = ctx.versionBumps;
    if (!bumps.size) return;

    console.log('\nPackages to publish:');
    for (const [name, bump] of bumps) {
      // from === to means --resume: no bump is being applied, an unfinished
      // release of that exact version is being completed.
      console.log(
        bump.from === bump.to
          ? `  ${name}: ${bump.to} (resume unfinished release)`
          : `  ${name}: ${bump.from} → ${bump.to} (${bump.type})`
      );
    }
    console.log('');

    const confirmed = await AwesomeLogger.prompt('confirm', {
      text: 'Proceed with publish?',
      default: 'yes',
    }).result;

    debug('confirm-publish', 'confirmed', confirmed);

    if (!confirmed) {
      throw new Error('Publish cancelled by user');
    }
  },
};
