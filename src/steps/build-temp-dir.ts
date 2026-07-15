import { mkdtempSync, cpSync, existsSync, mkdirSync, chmodSync, rmSync } from 'node:fs';
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

    // The temp dirs hold a copy of .npmrc (with the npm auth token). They are
    // only registered for cleanup once this step returns successfully, so a
    // throw mid-loop (e.g. the empty-publishFiles guard below) would orphan the
    // token-bearing dirs in os.tmpdir() forever. Clean up what we created on
    // failure before rethrowing.
    try {
      for (const pkg of ctx.packages) {
        const tempDir = mkdtempSync(
          join(tmpdir(), `awesome-publish-${pkg.name.replace(/[/@]/g, '-')}-`)
        );
        tempDirs.set(pkg.name, tempDir);
        debug('build-temp-dir', `${pkg.name} → ${tempDir}`);

        // publishDir mode: pack from the built subdirectory (e.g. dist/) using
        // its generated package.json — the ng-packagr / tsc-post-build manifest
        // with real `exports` — instead of the source package.json. Everything
        // (manifest, README/LICENSE, publishFiles) is resolved relative to this
        // packRoot.
        const packRoot = pkg.config.publishDir ? join(pkg.dir, pkg.config.publishDir) : pkg.dir;
        if (pkg.config.publishDir && !existsSync(packRoot)) {
          throw new Error(
            `${pkg.name}: publishDir "${pkg.config.publishDir}" not found at ${packRoot}. ` +
              `Did the build run and emit it? (buildCommand must produce ${pkg.config.publishDir}/package.json)`
          );
        }

        cpSync(join(packRoot, 'package.json'), join(tempDir, 'package.json'));

        // npm always includes README/LICENSE/CHANGELOG in a tarball — but only
        // when they physically exist in the package dir. We publish from a
        // detached temp dir, so copy them explicitly (matching npm's
        // always-included set) or every package ships with no README/license.
        for (const entry of globSync('{README,LICENSE,LICENCE,CHANGELOG,NOTICE}*', {
          cwd: packRoot,
          nocase: true,
          nodir: true, // a dir named LICENSES/ (REUSE convention) would crash cpSync
        })) {
          cpSync(join(packRoot, entry), join(tempDir, entry));
          debug('build-temp-dir', `${pkg.name}: included ${entry}`);
        }

        // Copy .npmrc into the temp dir so registry auth is resolved when we
        // publish from os.tmpdir() (outside the repo). CI (actions/setup-node)
        // writes .npmrc to the workspace root; a package-local .npmrc wins.
        const rootDir = (ctx as any).rootDir as string | undefined;
        for (const srcDir of [rootDir, pkg.dir]) {
          if (!srcDir) continue;
          const npmrc = join(srcDir, '.npmrc');
          if (existsSync(npmrc)) {
            const dest = join(tempDir, '.npmrc');
            cpSync(npmrc, dest);
            // .npmrc may carry an auth token; it lives in a world-readable tmpdir,
            // so restrict it to the owner. No-op on Windows (POSIX perms ignored).
            try {
              chmodSync(dest, 0o600);
            } catch {}
            debug('build-temp-dir', `${pkg.name}: copied .npmrc from ${srcDir}`);
          }
        }

        let totalMatched = 0;
        for (const entry of pkg.config.publishFiles) {
          // publishFiles doubles as npm's `files` field, which accepts globs.
          // Expand here so glob patterns (e.g. "dist/**/*.js") are actually
          // copied into the temp dir, not just literal paths. In publishDir mode
          // it is a copy filter relative to the built dir (default '**/*').
          const matches = globSync(entry, {
            cwd: packRoot,
            dot: true,
            // The manifest is copied separately above; never copy it twice (and
            // '**/*' would otherwise re-copy the built dir's package.json).
            ignore: 'package.json',
          });
          if (matches.length === 0) {
            console.warn(`⚠ ${pkg.name}: publishFiles entry "${entry}" matched nothing — skipping`);
            debug('build-temp-dir', `${pkg.name}: no match for publishFile "${entry}"`);
            continue;
          }
          totalMatched += matches.length;
          for (const match of matches) {
            const src = resolve(packRoot, match);
            const dest = join(tempDir, match);
            mkdirSync(dirname(dest), { recursive: true });
            cpSync(src, dest, { recursive: true });
          }
          debug('build-temp-dir', `${pkg.name}: copied ${entry} (${matches.length} match(es))`);
        }

        // If a package we're about to publish/pack matched NO publishFiles, the
        // tarball would contain only package.json — an empty, broken package that
        // burns the version on npm irreversibly. Fail before publish. Applies to
        // any package that will actually be published (has a bump), OR any package
        // at all under `pack` — pack-local.ts packs every resolved package
        // regardless of bump, so a no-bump sibling would silently emit a broken
        // tarball. (Under publish, a no-bump monorepo sibling is skipped by
        // publish-npm anyway, so an empty match for it is harmless.)
        const willPublish = (ctx as any).versionBumps?.get?.(pkg.name);
        const isPack = (ctx as any).command === 'pack';
        if (totalMatched === 0 && (willPublish || isPack)) {
          throw new Error(
            `${pkg.name}: none of publishFiles [${pkg.config.publishFiles.join(', ')}] matched any files in ${packRoot}. ` +
              `The package would be published empty. Check your build output and publishFiles (did the build run? correct directory?).`
          );
        }
      }
    } catch (error) {
      for (const dir of tempDirs.values()) {
        try {
          rmSync(dir, { recursive: true, force: true });
        } catch {}
      }
      throw error;
    }

    debug('build-temp-dir', `created ${tempDirs.size} temp dirs`);
    return { tempDirs };
  },
};
