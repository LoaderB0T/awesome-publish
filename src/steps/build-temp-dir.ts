import { mkdtempSync, cpSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { Phases } from '../pipeline/phases.js';
import type { PipelineStep } from '../pipeline/step.js';
import type { TempDirContext } from '../pipeline/context.js';

export const buildTempDirStep: PipelineStep<unknown, TempDirContext> = {
  name: 'build-temp-dir',
  phase: Phases.BUILD_TEMP_DIR,
  after: [Phases.DETERMINE_VERSION],
  before: [Phases.MODIFY_PACKAGE_JSON],

  shouldRun: () => true,

  async execute(ctx): Promise<TempDirContext> {
    const tempDirs = new Map<string, string>();

    for (const pkg of ctx.packages) {
      const tempDir = mkdtempSync(
        join(tmpdir(), `awesome-publish-${pkg.name.replace(/[/@]/g, '-')}-`),
      );

      cpSync(join(pkg.dir, 'package.json'), join(tempDir, 'package.json'));

      for (const entry of pkg.config.publishFiles) {
        const src = resolve(pkg.dir, entry);
        if (!existsSync(src)) continue;
        const dest = join(tempDir, entry);
        cpSync(src, dest, { recursive: true });
      }

      tempDirs.set(pkg.name, tempDir);
    }

    return { tempDirs };
  },
};
