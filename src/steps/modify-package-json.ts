import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Phases } from '../pipeline/phases.js';
import type { PipelineStep } from '../pipeline/step.js';
import type { TempDirContext, VersionContext } from '../pipeline/context.js';
import { debug } from '../services/debug.js';

const DEP_FIELDS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
] as const;

/**
 * Resolve a pnpm `workspace:` protocol range to a concrete published range.
 * We publish from a detached temp dir (outside the workspace), so pnpm never
 * rewrites these itself — without this the literal "workspace:*" would ship to
 * the registry and make the package uninstallable.
 *
 *   workspace:*      → 1.2.3   (exact sibling version)
 *   workspace:~      → ~1.2.3
 *   workspace:^      → ^1.2.3
 *   workspace:^1.2.3 → ^1.2.3  (explicit spec kept verbatim)
 */
function resolveWorkspaceRange(range: string, siblingVersion: string): string {
  const spec = range.slice('workspace:'.length);
  if (spec === '' || spec === '*') return siblingVersion;
  if (spec === '~' || spec === '^') return `${spec}${siblingVersion}`;
  return spec;
}

export const modifyPackageJsonStep: PipelineStep<TempDirContext & VersionContext> = {
  name: 'modify-package-json',
  phase: Phases.MODIFY_PACKAGE_JSON,
  after: [Phases.BUILD_TEMP_DIR],
  before: [Phases.PUBLISH_NPM],

  shouldRun: () => true,

  async execute(ctx): Promise<void> {
    // Map every in-scope package to the version it will publish as, so
    // workspace: protocol ranges resolve to real versions.
    const siblingVersions = new Map<string, string>();
    for (const pkg of ctx.packages) {
      siblingVersions.set(pkg.name, ctx.versionBumps.get(pkg.name)?.to ?? pkg.version);
    }

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

      // Resolve workspace: protocol ranges so the published package is installable.
      for (const field of DEP_FIELDS) {
        const deps = pkgJson[field] as Record<string, string> | undefined;
        if (!deps) continue;
        for (const [depName, range] of Object.entries(deps)) {
          if (!range.startsWith('workspace:')) continue;
          const siblingVersion = siblingVersions.get(depName);
          if (!siblingVersion) {
            throw new Error(
              `${pkg.name}: ${field}."${depName}" uses "${range}" but ${depName} is not in the publish set — cannot resolve the workspace protocol. Publish it together (drop --filter) or replace the range with a concrete version.`
            );
          }
          const resolved = resolveWorkspaceRange(range, siblingVersion);
          debug('modify-package-json', `${pkg.name}: ${field}.${depName} ${range} → ${resolved}`);
          deps[depName] = resolved;
        }
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
