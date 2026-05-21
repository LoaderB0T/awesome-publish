import { mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Phases } from '../pipeline/phases.js';
import type { PipelineStep } from '../pipeline/step.js';
import type { TempDirContext } from '../pipeline/context.js';
import { createAdapter } from '../services/package-manager.js';
import { debug } from '../services/debug.js';

export const packLocalStep: PipelineStep<TempDirContext & { cliArgs?: { out?: string } }> = {
  name: 'pack-local',
  phase: Phases.PACK_LOCAL,
  after: [Phases.MODIFY_PACKAGE_JSON],
  before: [Phases.CLEANUP],
  hasSideEffects: true,

  shouldRun: () => true,

  async execute(ctx): Promise<void> {
    const outDir = resolve(ctx.cliArgs?.out ?? './awesome-publish-pack');
    debug('pack-local', 'output dir', outDir);

    if (!existsSync(outDir)) {
      debug('pack-local', 'creating output dir');
      mkdirSync(outDir, { recursive: true });
    }

    const adapter = createAdapter(ctx.config.packageManager);

    for (const pkg of ctx.packages) {
      const tempDir = ctx.tempDirs.get(pkg.name);
      if (!tempDir) continue;
      debug('pack-local', `packing ${pkg.name} from ${tempDir}`);
      const tarball = await adapter.pack(tempDir, outDir);
      debug('pack-local', `${pkg.name} → ${tarball}`);
      console.log(`Packed: ${tarball}`);
    }
  },
};
