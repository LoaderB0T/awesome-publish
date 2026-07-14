import semver from 'semver';
import { AwesomeLogger } from 'awesome-logging';
import { Phases } from '../pipeline/phases.js';
import type { PipelineStep } from '../pipeline/step.js';
import type { ChangesetContext, VersionContext } from '../pipeline/context.js';
import type { VersionBump } from '../types/package-info.js';
import type { Changeset } from '../types/changeset.js';
import { GitService } from '../services/git.js';
import { tagMatchPrefix } from './git-tag.js';
import { determineBumpFromCommits } from '../services/conventional-commits.js';
import {
  bumpVersion,
  highestBump,
  validateBumpType,
  stripPrerelease,
  extractPreIdentifier,
  resolvePreVersion,
  assertNoDowngrade,
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
  dryRun: boolean
): Promise<void> {
  for (const [name, bump] of bumps) {
    let baseVersion: string;

    if (bump.from.includes('-')) {
      // Current version is already a prerelease. Use its base to avoid
      // double-bumping (1.1.0-beta.1 → base 1.1.0, not bumpVersion("1.1.0")),
      // BUT if the computed stable bump (bump.to) targets a higher base — e.g. a
      // breaking change lands mid-beta so 1.1.0-beta.1 + major → 2.0.0 — escalate
      // to that higher base so the prerelease series can advance (2.0.0-beta.0).
      const currentBase = stripPrerelease(bump.from);
      baseVersion = semver.gt(bump.to, currentBase) ? bump.to : currentBase;
      const currentPreId = extractPreIdentifier(bump.from);
      debug(
        'determine-version',
        `${name}: current is pre (${currentPreId}), base ${baseVersion} (from ${currentBase}, bump.to ${bump.to})`
      );
    } else {
      // Stable → prerelease: use the bumped version as base
      baseVersion = bump.to;
      debug('determine-version', `${name}: stable → pre, base ${baseVersion}`);
    }

    try {
      let preVersion = await resolvePreVersion(name, baseVersion, preId, registry);
      // Registry-behind-local retry: if package.json is already at a higher
      // prerelease than the registry knows (a prior run bumped locally but the
      // publish failed), advance from the local version so we don't resolve to a
      // lower number and trip the downgrade guard.
      if (bump.from.includes('-') && semver.lte(preVersion, bump.from)) {
        const local = semver.inc(bump.from, 'prerelease', preId);
        if (local && semver.gt(local, preVersion)) {
          debug('determine-version', `${name}: registry behind local, advancing to ${local}`);
          preVersion = local;
        }
      }
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
    const registry = ((ctx as any).cliArgs?.registry as string | undefined) ?? ctx.config.registry;

    debug('determine-version', 'changesets enabled', ctx.config.changesets.enabled);
    debug('determine-version', 'changeset count', changesets?.length ?? 0);
    debug('determine-version', 'cli bump arg', (ctx as any).cliArgs?.bump);
    debug('determine-version', 'conventional commits', ctx.config.conventionalCommits);
    debug('determine-version', 'prerelease', preId ?? 'none');

    const rawBumpArg = (ctx as any).cliArgs?.bump as string | undefined;
    if (
      ctx.config.changesets.enabled &&
      !changesets?.length &&
      ctx.mode === 'ci' &&
      !preId &&
      !rawBumpArg
    ) {
      // No changesets on this run — nothing to release. Return empty bumps so
      // the pipeline is a clean no-op (publish/tag/release steps all skip) and
      // CI stays green on ordinary commits instead of failing every push. Skip
      // the git tag lookups below — there's nothing to compute notes for.
      console.log('No changesets found — nothing to release.');
      return { versionBumps: bumps, isPrerelease: false, previousTags: new Map() };
    }

    // Capture the latest existing tag per package NOW, before any later step
    // (git-tag) creates the new release tag. Downstream steps (write-changelog,
    // ai-notes-generate, github-release) read this stashed map to diff commits
    // since the *previous* release — github-release runs after git-tag, so
    // querying git itself there would return the tag we just created and yield
    // an empty range.
    const git = new GitService(ctx.rootDir);
    const previousTags = new Map<string, string | null>();
    for (const pkg of ctx.packages) {
      previousTags.set(
        pkg.name,
        await git.getLatestTag(
          tagMatchPrefix(pkg.name, ctx.packages.length, ctx.config.gitTag.prefix)
        )
      );
    }

    // Attach the stashed previous tags and guard against downgrades on the way
    // out, for every resolution path.
    const finalize = (resolved: Map<string, VersionBump>): VersionContext => {
      for (const bump of resolved.values()) assertNoDowngrade(bump.from, bump.to);
      return { versionBumps: resolved, isPrerelease: !!preId, previousTags };
    };

    // 1. Changesets take priority
    if (ctx.config.changesets.enabled && changesets?.length) {
      const bumpTypes = new Map<string, 'patch' | 'minor' | 'major'>();

      for (const cs of changesets) {
        for (const release of cs.releases) {
          const existing = bumpTypes.get(release.name);
          bumpTypes.set(
            release.name,
            existing ? highestBump(existing, release.type) : release.type
          );
        }
      }
      debug('determine-version', 'bump types from changesets', bumpTypes);

      // Fail fast on a changeset that names a package we don't publish (typo,
      // rename, or a package outside the current --filter). Silently dropping it
      // and then consuming (deleting) the changeset would destroy release intent
      // with no error. Point the user at the valid names.
      const knownNames = new Set(ctx.packages.map(p => p.name));
      const unknown = [...bumpTypes.keys()].filter(name => !knownNames.has(name));
      if (unknown.length > 0) {
        throw new Error(
          `Changeset references unknown package(s): ${unknown.join(', ')}. ` +
            `Known packages: ${[...knownNames].join(', ') || '(none)'}.`
        );
      }

      for (const pkg of ctx.packages) {
        const type = bumpTypes.get(pkg.name);
        if (type) {
          const bump: VersionBump = {
            packageName: pkg.name,
            from: pkg.version,
            // zeroBased: automatic releases never graduate a 0.x package to 1.0.0.
            to: bumpVersion(pkg.version, type, { zeroBased: true }),
            type,
          };
          debug('determine-version', `${pkg.name}: ${bump.from} → ${bump.to} (${type})`);
          bumps.set(pkg.name, bump);
        }
      }

      if (preId) await applyPrerelease(bumps, preId, registry, ctx.dryRun);
      return finalize(bumps);
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
          // Explicit --bump is the intentional escape hatch: no zeroBased demotion,
          // so `--bump major` on a 0.x package can deliberately reach 1.0.0.
          to: bumpVersion(pkg.version, bumpType),
          type: bumpType,
        };
        debug('determine-version', `${pkg.name}: ${bump.from} → ${bump.to} (${bumpType})`);
        bumps.set(pkg.name, bump);
      }

      if (preId) await applyPrerelease(bumps, preId, registry, ctx.dryRun);
      return finalize(bumps);
    }

    // 3. Conventional commits auto-detection
    if (ctx.config.conventionalCommits) {
      for (const pkg of ctx.packages) {
        const latestTag = previousTags.get(pkg.name) ?? null;
        // First-ever release (no tag yet): scan the whole history so an initial
        // release is possible in conventional-commits mode, instead of finding
        // zero commits and erroring out in CI.
        const commits = latestTag
          ? await git.getCommitsSinceTag(latestTag)
          : await git.getAllCommits();
        debug(
          'determine-version',
          `${pkg.name}: ${commits.length} commits since ${latestTag ?? 'beginning'}`
        );

        const detected = determineBumpFromCommits(commits);
        if (detected) {
          const bump: VersionBump = {
            packageName: pkg.name,
            from: pkg.version,
            // zeroBased: automatic releases never graduate a 0.x package to 1.0.0.
            to: bumpVersion(pkg.version, detected, { zeroBased: true }),
            type: detected,
          };
          debug('determine-version', `${pkg.name}: conventional commits → ${detected}`);
          bumps.set(pkg.name, bump);
        }
      }

      if (bumps.size > 0) {
        if (preId) await applyPrerelease(bumps, preId, registry, ctx.dryRun);
        return finalize(bumps);
      }
      debug('determine-version', 'no conventional commits matched bump types');
    }

    // 4. CI mode without anything = error
    if (ctx.mode === 'ci') {
      throw new Error(
        'CI mode requires --bump=patch|minor|major, changesets, or conventional commits'
      );
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
    return finalize(bumps);
  },
};
