import { mkdtempSync, cpSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { Phases } from '../pipeline/phases.js';
import type { PipelineStep } from '../pipeline/step.js';
import type { TempDirContext } from '../pipeline/context.js';
import { debug } from '../services/debug.js';

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
        join(tmpdir(), `awesome-publish-${pkg.name.replace(/[/@]/g, '-')}-`)
      );
      debug('build-temp-dir', `${pkg.name} → ${tempDir}`);

      cpSync(join(pkg.dir, 'package.json'), join(tempDir, 'package.json'));

      // Copy .npmrc into the temp dir so registry auth is resolved when we
      // publish from os.tmpdir() (outside the repo). CI (actions/setup-node)
      // writes .npmrc to the workspace root; a package-local .npmrc wins.
      const rootDir = (ctx as any).rootDir as string | undefined;
      for (const srcDir of [rootDir, pkg.dir]) {
        if (!srcDir) continue;
        const npmrc = join(srcDir, '.npmrc');
        if (existsSync(npmrc)) {
          cpSync(npmrc, join(tempDir, '.npmrc'));
          debug('build-temp-dir', `${pkg.name}: copied .npmrc from ${srcDir}`);
        }
      }

      for (const entry of pkg.config.publishFiles) {
        const src = resolve(pkg.dir, entry);
        if (!existsSync(src)) {
          console.warn(`⚠ ${pkg.name}: publishFiles entry "${entry}" not found — skipping`);
          debug('build-temp-dir', `${pkg.name}: skipping missing publishFile "${entry}"`);
          continue;
        }
        const dest = join(tempDir, entry);
        cpSync(src, dest, { recursive: true });
        debug('build-temp-dir', `${pkg.name}: copied ${entry}`);
      }

      tempDirs.set(pkg.name, tempDir);
    }

    debug('build-temp-dir', `created ${tempDirs.size} temp dirs`);
    return { tempDirs };
  },
};
