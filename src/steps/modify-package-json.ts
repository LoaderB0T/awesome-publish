import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Phases } from '../pipeline/phases.js';
import type { PipelineStep } from '../pipeline/step.js';
import type { TempDirContext, VersionContext } from '../pipeline/context.js';
import { debug } from '../services/debug.js';

export const modifyPackageJsonStep: PipelineStep<TempDirContext & VersionContext> = {
  name: 'modify-package-json',
  phase: Phases.MODIFY_PACKAGE_JSON,
  after: [Phases.BUILD_TEMP_DIR],
  before: [Phases.PUBLISH_NPM],

  shouldRun: () => true,

  async execute(ctx): Promise<void> {
    for (const pkg of ctx.packages) {
      const tempDir = ctx.tempDirs.get(pkg.name);
      if (!tempDir) continue;

      const pkgJsonPath = join(tempDir, 'package.json');
      const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));

      const bump = ctx.versionBumps.get(pkg.name);
      if (bump) {
        debug('modify-package-json', `${pkg.name}: version ${bump.from} → ${bump.to}`);
        pkgJson.version = bump.to;
      }

      if (pkg.config.stripScripts === true) {
        debug('modify-package-json', `${pkg.name}: stripping all scripts`);
        delete pkgJson.scripts;
      } else if (Array.isArray(pkg.config.stripScripts)) {
        debug('modify-package-json', `${pkg.name}: stripping scripts`, pkg.config.stripScripts);
        if (pkgJson.scripts) {
          for (const script of pkg.config.stripScripts) {
            delete pkgJson.scripts[script];
          }
          if (Object.keys(pkgJson.scripts).length === 0) {
            delete pkgJson.scripts;
          }
        }
      }

      pkgJson.files = pkg.config.publishFiles;
      debug('modify-package-json', `${pkg.name}: files set to`, pkg.config.publishFiles);

      writeFileSync(pkgJsonPath, `${JSON.stringify(pkgJson, null, 2)}\n`);
    }
  },
};
