import { rmSync } from 'node:fs';
import { Phases } from '../pipeline/phases.js';
import type { PipelineStep } from '../pipeline/step.js';
import type { TempDirContext } from '../pipeline/context.js';
import { debug } from '../services/debug.js';

export const cleanupStep: PipelineStep<Partial<TempDirContext>> = {
  name: 'cleanup',
  phase: Phases.CLEANUP,
  after: [Phases.PUBLISH_NPM, Phases.GITHUB_RELEASE, Phases.AI_NOTES_PUBLISH],
  before: [],

  shouldRun: (ctx) => ctx.tempDirs != null && ctx.tempDirs.size > 0,

  async execute(ctx): Promise<void> {
    if (!ctx.tempDirs) return;
    for (const [name, dir] of ctx.tempDirs) {
      debug('cleanup', `removing ${name}: ${dir}`);
      rmSync(dir, { recursive: true, force: true });
    }
    debug('cleanup', `removed ${ctx.tempDirs.size} temp dirs`);
  },
};
