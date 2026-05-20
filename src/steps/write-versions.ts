import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Phases } from '../pipeline/phases.js';
import type { PipelineStep } from '../pipeline/step.js';
import type { VersionContext } from '../pipeline/context.js';

export const writeVersionsStep: PipelineStep<VersionContext> = {
  name: 'write-versions',
  phase: Phases.WRITE_VERSIONS,
  after: [Phases.CONSUME_CHANGESETS],
  before: [Phases.BUILD_TEMP_DIR],
  hasSideEffects: true,

  shouldRun: (ctx) => ctx.versionBumps?.size > 0,

  async execute(ctx): Promise<void> {
    for (const pkg of ctx.packages) {
      const bump = ctx.versionBumps.get(pkg.name);
      if (!bump) continue;

      const pkgJsonPath = join(pkg.dir, 'package.json');
      const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
      pkgJson.version = bump.to;
      writeFileSync(pkgJsonPath, JSON.stringify(pkgJson, null, 2) + '\n');
    }
  },
};
