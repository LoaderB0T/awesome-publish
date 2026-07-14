import { mkdtempSync, cpSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { globSync } from 'glob';
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
        // publishFiles doubles as npm's `files` field, which accepts globs.
        // Expand here so glob patterns (e.g. "dist/**/*.js") are actually
        // copied into the temp dir, not just literal paths.
        const matches = globSync(entry, { cwd: pkg.dir, dot: true });
        if (matches.length === 0) {
          console.warn(`⚠ ${pkg.name}: publishFiles entry "${entry}" matched nothing — skipping`);
          debug('build-temp-dir', `${pkg.name}: no match for publishFile "${entry}"`);
          continue;
        }
        for (const match of matches) {
          const src = resolve(pkg.dir, match);
          const dest = join(tempDir, match);
          mkdirSync(dirname(dest), { recursive: true });
          cpSync(src, dest, { recursive: true });
        }
        debug('build-temp-dir', `${pkg.name}: copied ${entry} (${matches.length} match(es))`);
      }

      tempDirs.set(pkg.name, tempDir);
    }

    debug('build-temp-dir', `created ${tempDirs.size} temp dirs`);
    return { tempDirs };
  },
};
