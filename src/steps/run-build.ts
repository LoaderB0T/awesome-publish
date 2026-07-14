import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { Phases } from '../pipeline/phases.js';
import type { PipelineStep } from '../pipeline/step.js';
import type { VersionContext } from '../pipeline/context.js';
import { debug } from '../services/debug.js';

const execAsync = promisify(exec);

/**
 * Run the configured build command before packing. awesome-publish copies
 * publishFiles as-is and strips lifecycle scripts, so a compiled package (e.g.
 * TypeScript → lib/) must be built here or it would publish stale/empty output.
 *
 * The command is user config run in the user's own repo, so a shell is
 * appropriate (they may use "&&", "npm run build", etc.).
 */
export const runBuildStep: PipelineStep<VersionContext & { rootDir: string }> = {
  name: 'run-build',
  phase: Phases.RUN_BUILD,
  // After write-versions so a build that embeds the package version picks up the
  // newly bumped one, not the old value.
  after: [Phases.DETERMINE_VERSION, Phases.CONFIRM_PUBLISH, Phases.WRITE_VERSIONS],
  before: [Phases.BUILD_TEMP_DIR],
  hasSideEffects: true,

  shouldRun: ctx => !!ctx.config.buildCommand && ctx.versionBumps?.size > 0,

  async execute(ctx): Promise<void> {
    const cmd = ctx.config.buildCommand!;
    debug('run-build', `running build command: ${cmd}`);
    const { stdout, stderr } = await execAsync(cmd, { cwd: (ctx as any).rootDir });
    debug('run-build', 'build stdout', stdout.trim());
    if (stderr.trim()) debug('run-build', 'build stderr', stderr.trim());
  },
};
