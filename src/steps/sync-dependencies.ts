import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Phases } from '../pipeline/phases.js';
import type { PipelineStep } from '../pipeline/step.js';
import type { VersionContext } from '../pipeline/context.js';
import { debug } from '../services/debug.js';

const DEP_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'] as const;

export const syncDependenciesStep: PipelineStep<VersionContext> = {
  name: 'sync-dependencies',
  phase: Phases.SYNC_DEPENDENCIES,
  after: [Phases.DETERMINE_VERSION],
  before: [Phases.WRITE_VERSIONS],
  hasSideEffects: true,

  shouldRun: (ctx) => ctx.config.syncDependencies && ctx.versionBumps?.size > 0 && ctx.packages.length > 1,

  async execute(ctx): Promise<void> {
    const bumpedNames = new Map<string, string>();
    for (const [name, bump] of ctx.versionBumps) {
      bumpedNames.set(name, bump.to);
    }

    for (const pkg of ctx.packages) {
      const pkgJsonPath = join(pkg.dir, 'package.json');
      const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
      let modified = false;

      for (const field of DEP_FIELDS) {
        const deps = pkgJson[field] as Record<string, string> | undefined;
        if (!deps) continue;

        for (const [depName, currentRange] of Object.entries(deps)) {
          const newVersion = bumpedNames.get(depName);
          if (!newVersion) continue;

          // Preserve range prefix (^, ~, >=, etc.)
          const prefixMatch = currentRange.match(/^([~^>=<]*)/);
          const prefix = prefixMatch?.[1] ?? '^';
          const updatedRange = `${prefix}${newVersion}`;

          if (deps[depName] !== updatedRange) {
            debug('sync-dependencies', `${pkg.name}: ${field}.${depName} ${currentRange} → ${updatedRange}`);
            deps[depName] = updatedRange;
            modified = true;
          }
        }
      }

      if (modified) {
        writeFileSync(pkgJsonPath, JSON.stringify(pkgJson, null, 2) + '\n');
        debug('sync-dependencies', `updated ${pkgJsonPath}`);
      }
    }
  },
};
