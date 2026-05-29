import { AwesomeLogger } from 'awesome-logging';
import { Phases } from '../pipeline/phases.js';
import type { PipelineStep } from '../pipeline/step.js';
import type { ChangesetContext, VersionContext } from '../pipeline/context.js';
import type { VersionBump } from '../types/package-info.js';
import type { Changeset } from '../types/changeset.js';
import { GitService } from '../services/git.js';
import { determineBumpFromCommits } from '../services/conventional-commits.js';
import {
  bumpVersion,
  highestBump,
  validateBumpType,
  stripPrerelease,
  extractPreIdentifier,
  resolvePreVersion,
} from '../services/version.js';
import { debug } from '../services/debug.js';

/**
 * Apply prerelease suffix to all bumps. Handles the double-bump edge case:
 * if current version is already a prerelease, uses the existing base version
 * instead of re-bumping (which would double-bump).
 *
 * When current is stable → use bumpVersion result as base (normal flow)
 * When current is prerelease with same identifier → keep same base, increment pre number
 * When current is prerelease with different identifier → keep same base, new identifier (promote)
 */
async function applyPrerelease(
  bumps: Map<string, VersionBump>,
  preId: string,
  registry: string,
  dryRun: boolean,
): Promise<void> {
  for (const [name, bump] of bumps) {
    let baseVersion: string;

    if (bump.from.includes('-')) {
      // Current version is already a prerelease — use its base to avoid double-bump
      // e.g. 1.1.0-beta.1 → base is 1.1.0 (NOT bumpVersion("1.1.0", type) which double-bumps)
      baseVersion = stripPrerelease(bump.from);
      const currentPreId = extractPreIdentifier(bump.from);
      debug('determine-version', `${name}: current is pre (${currentPreId}), reusing base ${baseVersion}`);
    } else {
      // Stable → prerelease: use the bumped version as base
      baseVersion = bump.to;
      debug('determine-version', `${name}: stable → pre, base ${baseVersion}`);
    }

    try {
      const preVersion = await resolvePreVersion(name, baseVersion, preId, registry);
      debug('determine-version', `${name}: prerelease → ${preVersion}`);
      bump.to = preVersion;
    } catch (error: any) {
      if (dryRun) {
        // Fallback during dry-run if registry unreachable
        console.warn(`⚠ ${name}: registry lookup failed, using .0 fallback — ${error?.message}`);
        bump.to = `${baseVersion}-${preId}.0`;
      } else {
        throw error;
      }
    }

    bump.prerelease = preId;
  }
}

export const determineVersionStep: PipelineStep<
  Partial<ChangesetContext> & { cliArgs?: { bump?: string; pre?: string }; rootDir: string },
  VersionContext
> = {
  name: 'determine-version',
  phase: Phases.DETERMINE_VERSION,
  after: [Phases.READ_CHANGESETS],
  before: [Phases.BUILD_TEMP_DIR],

  shouldRun: () => true,

  async execute(ctx): Promise<VersionContext> {
    const bumps = new Map<string, VersionBump>();
    const changesets: Changeset[] | undefined = (ctx as any).changesets;
    const preId = (ctx as any).cliArgs?.pre as string | undefined;
    const registry = (ctx as any).cliArgs?.registry as string | undefined ?? ctx.config.registry;

    debug('determine-version', 'changesets enabled', ctx.config.changesets.enabled);
    debug('determine-version', 'changeset count', changesets?.length ?? 0);
    debug('determine-version', 'cli bump arg', (ctx as any).cliArgs?.bump);
    debug('determine-version', 'conventional commits', ctx.config.conventionalCommits);
    debug('determine-version', 'prerelease', preId ?? 'none');

    if (ctx.config.changesets.enabled && !changesets?.length && ctx.mode === 'ci' && !preId) {
      throw new Error('No changesets found. Add a changeset before publishing in CI mode, or use --bump to override.');
    }

    // 1. Changesets take priority
    if (ctx.config.changesets.enabled && changesets?.length) {
      const bumpTypes = new Map<string, 'patch' | 'minor' | 'major'>();

      for (const cs of changesets) {
        for (const release of cs.releases) {
          const existing = bumpTypes.get(release.name);
          bumpTypes.set(release.name, existing ? highestBump(existing, release.type) : release.type);
        }
      }
      debug('determine-version', 'bump types from changesets', bumpTypes);

      for (const pkg of ctx.packages) {
        const type = bumpTypes.get(pkg.name);
        if (type) {
          const bump: VersionBump = {
            packageName: pkg.name,
            from: pkg.version,
            to: bumpVersion(pkg.version, type),
            type,
          };
          debug('determine-version', `${pkg.name}: ${bump.from} → ${bump.to} (${type})`);
          bumps.set(pkg.name, bump);
        }
      }

      if (preId) await applyPrerelease(bumps, preId, registry, ctx.dryRun);
      return { versionBumps: bumps, isPrerelease: !!preId };
    }

    // 2. Explicit --bump flag
    const rawBump = (ctx as any).cliArgs?.bump as string | undefined;
    if (rawBump) {
      const bumpType = validateBumpType(rawBump);
      debug('determine-version', 'using cli bump type', bumpType);
      for (const pkg of ctx.packages) {
        const bump: VersionBump = {
          packageName: pkg.name,
          from: pkg.version,
          to: bumpVersion(pkg.version, bumpType),
          type: bumpType,
        };
        debug('determine-version', `${pkg.name}: ${bump.from} → ${bump.to} (${bumpType})`);
        bumps.set(pkg.name, bump);
      }

      if (preId) await applyPrerelease(bumps, preId, registry, ctx.dryRun);
      return { versionBumps: bumps, isPrerelease: !!preId };
    }

    // 3. Conventional commits auto-detection
    if (ctx.config.conventionalCommits) {
      const git = new GitService(ctx.rootDir);

      for (const pkg of ctx.packages) {
        const latestTag = await git.getLatestTag(ctx.packages.length === 1 ? undefined : pkg.name);
        const commits = latestTag ? await git.getCommitsSinceTag(latestTag) : [];
        debug('determine-version', `${pkg.name}: ${commits.length} commits since ${latestTag ?? 'beginning'}`);

        const detected = determineBumpFromCommits(commits);
        if (detected) {
          const bump: VersionBump = {
            packageName: pkg.name,
            from: pkg.version,
            to: bumpVersion(pkg.version, detected),
            type: detected,
          };
          debug('determine-version', `${pkg.name}: conventional commits → ${detected}`);
          bumps.set(pkg.name, bump);
        }
      }

      if (bumps.size > 0) {
        if (preId) await applyPrerelease(bumps, preId, registry, ctx.dryRun);
        return { versionBumps: bumps, isPrerelease: !!preId };
      }
      debug('determine-version', 'no conventional commits matched bump types');
    }

    // 4. CI mode without anything = error
    if (ctx.mode === 'ci') {
      throw new Error('CI mode requires --bump=patch|minor|major, changesets, or conventional commits');
    }

    // 5. Interactive prompt
    for (const pkg of ctx.packages) {
      const selected = await AwesomeLogger.prompt('choice', {
        text: `Bump type for ${pkg.name} (current: ${pkg.version}):`,
        options: ['patch', 'minor', 'major', 'skip'],
      }).result;

      if (selected === 'skip') continue;

      const type = selected as 'patch' | 'minor' | 'major';
      bumps.set(pkg.name, {
        packageName: pkg.name,
        from: pkg.version,
        to: bumpVersion(pkg.version, type),
        type,
      });
    }

    if (preId) await applyPrerelease(bumps, preId, registry, ctx.dryRun);
    debug('determine-version', `total bumps: ${bumps.size}`);
    return { versionBumps: bumps, isPrerelease: !!preId };
  },
};
