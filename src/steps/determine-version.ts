import { relative } from 'node:path';
import semver from 'semver';
import { AwesomeLogger } from 'awesome-logging';
import { Phases } from '../pipeline/phases.js';
import type { PipelineStep } from '../pipeline/step.js';
import type { ChangesetContext, CoreContext, VersionContext } from '../pipeline/context.js';
import type { VersionBump } from '../types/package-info.js';
import type { Changeset } from '../types/changeset.js';
import { GitService } from '../services/git.js';
import { tagMatchPrefix, parseTagVersion, previousReleaseTag } from './git-tag.js';
import {
  detectReleaseState,
  describeMissingSinks,
  type PackageReleaseState,
} from '../services/release-state.js';
import { determineBumpFromCommits } from '../services/conventional-commits.js';
import {
  bumpVersion,
  highestBump,
  validateBumpType,
  stripPrerelease,
  extractPreIdentifier,
  resolvePreVersion,
  assertNoDowngrade,
  type BumpType,
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

/**
 * `--resume`: finish the release that is already in flight instead of starting a
 * new one. Emits a no-op bump (`from === to`) per unfinished package so every
 * downstream step's `versionBumps.size > 0` guard passes and each one re-runs
 * against its own already-done work (npm 409-skips, git-tag skips existing tags,
 * GitHub reuses the release for an existing tag).
 *
 * Changesets are deliberately ignored here — they describe the *next* release,
 * and rolling them in would bump past the version we are trying to finish.
 */
async function resumeInFlightRelease(
  ctx: CoreContext & { rootDir: string },
  registry: string
): Promise<VersionContext> {
  const packageCount = ctx.totalPackageCount ?? ctx.packages.length;
  const states = await detectReleaseState({
    rootDir: ctx.rootDir,
    packages: ctx.packages,
    config: ctx.config,
    totalPackageCount: packageCount,
    registry,
    // About to act on the answer — a lookup we cannot complete must abort, not guess.
    strict: true,
  });

  const inFlight = states.filter(s => s.inFlight);
  if (inFlight.length === 0) {
    throw new Error(
      "--resume: no unfinished release found — every package's current version is fully released.\n" +
        '  Drop --resume to publish a new version.'
    );
  }

  const git = new GitService(ctx.rootDir);
  const versionBumps = new Map<string, VersionBump>();
  const previousTags = new Map<string, string | null>();

  for (const state of inFlight) {
    console.log(
      `↻ Resuming ${state.packageName}@${state.version} (${describeMissingSinks(state)})`
    );
    versionBumps.set(state.packageName, {
      packageName: state.packageName,
      from: state.version,
      to: state.version,
      // No bump is being applied; the type is carried only for display.
      type: 'patch',
    });
    previousTags.set(
      state.packageName,
      await previousReleaseTag(git, {
        packageName: state.packageName,
        packageCount,
        prefix: ctx.config.gitTag.prefix,
        // Exclude the resumed version's own tag, which already exists whenever
        // the run died after git-tag.
        below: state.version,
        stableOnly: semver.prerelease(state.version) === null,
      })
    );
  }

  return {
    versionBumps,
    isPrerelease: inFlight.some(s => s.version.includes('-')),
    previousTags,
  };
}

/**
 * Read-only check on an ordinary run: is any package's current version already
 * half-released? Never throws — a registry blip must not fail a release that has
 * nothing to do with resuming.
 */
async function detectInFlightAdvisory(
  ctx: CoreContext & { rootDir: string },
  registry: string
): Promise<PackageReleaseState[]> {
  try {
    const states = await detectReleaseState({
      rootDir: ctx.rootDir,
      packages: ctx.packages,
      config: ctx.config,
      totalPackageCount: ctx.totalPackageCount ?? ctx.packages.length,
      registry,
      strict: false,
    });
    return states.filter(s => s.inFlight);
  } catch (error: any) {
    debug('determine-version', 'in-flight advisory check failed', String(error));
    return [];
  }
}

export const determineVersionStep: PipelineStep<
  Partial<ChangesetContext> & {
    cliArgs?: { bump?: string; pre?: string; resume?: boolean };
    rootDir: string;
  },
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

    // --resume short-circuits every versioning strategy: the version to publish
    // is already written in package.json, the only question is which sinks are
    // still missing it.
    if ((ctx as any).cliArgs?.resume) {
      return resumeInFlightRelease(ctx as any, registry);
    }

    const rawBumpArg = (ctx as any).cliArgs?.bump as string | undefined;
    if (
      ctx.config.changesets.enabled &&
      !ctx.config.conventionalCommits &&
      !changesets?.length &&
      ctx.mode === 'ci' &&
      !preId &&
      !rawBumpArg
    ) {
      // No changesets on this run and no conventional-commits fallback — nothing
      // to release. Return empty bumps so the pipeline is a clean no-op
      // (publish/tag/release steps all skip) and CI stays green on ordinary
      // commits instead of failing every push. When conventionalCommits is ALSO
      // enabled we must fall through so real feat:/fix: commits still ship — the
      // conventional-commits branch below handles the empty-changeset case.
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
          tagMatchPrefix(
            pkg.name,
            ctx.totalPackageCount ?? ctx.packages.length,
            ctx.config.gitTag.prefix
          )
        )
      );
    }

    // The version a bump is computed FROM. Normally that is package.json, which
    // at rest equals the last released version. It stops being equal when a
    // previous run bumped package.json and then died before reaching npm: the
    // file says 0.0.3, nothing published 0.0.3, and bumping from it would burn a
    // version number (0.0.3 → 0.0.4) on every failed attempt. Rebase onto the
    // last version that actually shipped so a retry lands where it was aiming.
    //
    // Only when the version never reached the registry: once 0.0.3 is live,
    // 0.0.3 IS the last released version and the next release must be 0.0.4.
    const baseVersions = new Map<string, string>(ctx.packages.map(p => [p.name, p.version]));
    if (ctx.command === 'publish') {
      for (const state of await detectInFlightAdvisory(ctx as any, registry)) {
        console.warn(
          `⚠ ${state.packageName}@${state.version} looks half-released (${describeMissingSinks(state)}).\n` +
            `    Run \`awesome-publish publish --resume\` to finish it instead of starting a new version.`
        );
        if (state.onRegistry) continue;
        const priorTag = previousTags.get(state.packageName);
        const priorVersion = priorTag
          ? parseTagVersion(
              priorTag,
              state.packageName,
              ctx.totalPackageCount ?? ctx.packages.length,
              ctx.config.gitTag.prefix
            )
          : null;
        if (priorVersion) {
          debug(
            'determine-version',
            `${state.packageName}: rebasing bump onto last released ${priorVersion} (package.json is an unpublished ${state.version})`
          );
          baseVersions.set(state.packageName, priorVersion);
        }
      }
    }
    const baseOf = (pkgName: string, fallback: string) => baseVersions.get(pkgName) ?? fallback;

    // Attach the stashed previous tags and guard against downgrades on the way
    // out, for every resolution path.
    const finalize = async (resolved: Map<string, VersionBump>): Promise<VersionContext> => {
      for (const bump of resolved.values()) {
        // Now that the target version is known, narrow the range start to the
        // previous release *of the same kind*. The loop above took the latest
        // tag of any kind, which is what bump detection wants but not what the
        // notes want: a stable release diffed against its own prerelease finds
        // no commits and ships an empty body. Keyed off bump.to rather than the
        // --pre flag so a `next` changeset (a prerelease with no flag) is
        // classified correctly too.
        previousTags.set(
          bump.packageName,
          await previousReleaseTag(git, {
            packageName: bump.packageName,
            packageCount: ctx.totalPackageCount ?? ctx.packages.length,
            prefix: ctx.config.gitTag.prefix,
            below: bump.to,
            stableOnly: semver.prerelease(bump.to) === null,
          })
        );

        // A `next` bump deliberately switches the prerelease line (e.g.
        // 0.0.1-pre7 → 0.0.1-next.0), which semver ranks as LOWER because "next"
        // < "pre" alphabetically. That's intentional churn, not a downgrade, so
        // skip the guard for next bumps; the next.N → next.N+1 steps increase
        // normally anyway.
        if (bump.type === 'next') continue;
        assertNoDowngrade(bump.from, bump.to);
      }
      return { versionBumps: resolved, isPrerelease: !!preId, previousTags };
    };

    // 1. Changesets take priority
    if (ctx.config.changesets.enabled && changesets?.length) {
      const bumpTypes = new Map<string, BumpType>();

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
          const base = baseOf(pkg.name, pkg.version);
          const bump: VersionBump = {
            packageName: pkg.name,
            from: base,
            // zeroBased: automatic releases never graduate a 0.x package to 1.0.0.
            to: bumpVersion(base, type, { zeroBased: true }),
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
        const base = baseOf(pkg.name, pkg.version);
        const bump: VersionBump = {
          packageName: pkg.name,
          from: base,
          // Explicit --bump is the intentional escape hatch: no zeroBased demotion,
          // so `--bump major` on a 0.x package can deliberately reach 1.0.0.
          to: bumpVersion(base, bumpType),
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
        // In a monorepo, scope the commit range to the package's own directory
        // (same as write-changelog) — otherwise every package bumps on any
        // repo-wide fix/feat commit and ships a bogus "Version bump" release.
        const scope =
          (ctx.totalPackageCount ?? ctx.packages.length) > 1
            ? relative(ctx.rootDir, pkg.dir)
            : undefined;
        // First-ever release (no tag yet): scan the whole history so an initial
        // release is possible in conventional-commits mode, instead of finding
        // zero commits and erroring out in CI.
        const commits = latestTag
          ? await git.getCommitsSinceTag(latestTag, scope)
          : await git.getAllCommits(scope);
        debug(
          'determine-version',
          `${pkg.name}: ${commits.length} commits since ${latestTag ?? 'beginning'}`
        );

        const detected = determineBumpFromCommits(commits);
        if (detected) {
          const base = baseOf(pkg.name, pkg.version);
          const bump: VersionBump = {
            packageName: pkg.name,
            from: base,
            // zeroBased: automatic releases never graduate a 0.x package to 1.0.0.
            to: bumpVersion(base, detected, { zeroBased: true }),
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

      // conventionalCommits is configured but no fix/feat/breaking commit landed
      // since the last release — a routine chore-only cycle. In CI this must be a
      // clean no-op (green build), NOT a hard error, matching the documented
      // behavior and the changesets no-op path above.
      if (ctx.mode === 'ci') {
        console.log('No releasable commits since the last release — nothing to release.');
        return finalize(bumps);
      }
    }

    // 4. CI mode with NO versioning strategy configured at all = misconfiguration.
    if (ctx.mode === 'ci') {
      throw new Error(
        'CI mode requires --bump=patch|minor|major, changesets, or conventional commits'
      );
    }

    // 5. Interactive prompt
    for (const pkg of ctx.packages) {
      const selected = await AwesomeLogger.prompt('choice', {
        text: `Bump type for ${pkg.name} (current: ${pkg.version}):`,
        options: ['patch', 'minor', 'major', 'next', 'skip'],
      }).result;

      if (selected === 'skip') continue;

      const type = selected as BumpType;
      const base = baseOf(pkg.name, pkg.version);
      bumps.set(pkg.name, {
        packageName: pkg.name,
        from: base,
        to: bumpVersion(base, type),
        type,
      });
    }

    if (preId) await applyPrerelease(bumps, preId, registry, ctx.dryRun);
    debug('determine-version', `total bumps: ${bumps.size}`);
    return finalize(bumps);
  },
};
