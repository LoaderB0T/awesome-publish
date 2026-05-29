import { AwesomeLogger } from 'awesome-logging';
import { Phases } from '../pipeline/phases.js';
import type { PipelineStep } from '../pipeline/step.js';
import type { ChangesetContext, VersionContext } from '../pipeline/context.js';
import type { VersionBump } from '../types/package-info.js';
import type { Changeset } from '../types/changeset.js';
import { GitService } from '../services/git.js';
import { determineBumpFromCommits } from '../services/conventional-commits.js';
import { debug } from '../services/debug.js';

const BUMP_ORDER = { patch: 0, minor: 1, major: 2 } as const;

function bumpVersion(version: string, type: 'patch' | 'minor' | 'major'): string {
  const [major, minor, patch] = version.split('.').map(Number);
  switch (type) {
    case 'major':
      return `${major + 1}.0.0`;
    case 'minor':
      return `${major}.${minor + 1}.0`;
    case 'patch':
      return `${major}.${minor}.${patch + 1}`;
  }
}

function highestBump(
  a: 'patch' | 'minor' | 'major',
  b: 'patch' | 'minor' | 'major',
): 'patch' | 'minor' | 'major' {
  return BUMP_ORDER[a] >= BUMP_ORDER[b] ? a : b;
}

export const determineVersionStep: PipelineStep<
  Partial<ChangesetContext> & { cliArgs?: { bump?: string }; rootDir: string },
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

    debug('determine-version', 'changesets enabled', ctx.config.changesets.enabled);
    debug('determine-version', 'changeset count', changesets?.length ?? 0);
    debug('determine-version', 'cli bump arg', (ctx as any).cliArgs?.bump);
    debug('determine-version', 'conventional commits', ctx.config.conventionalCommits);

    if (ctx.config.changesets.enabled && !changesets?.length && ctx.mode === 'ci') {
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
          const bump = {
            packageName: pkg.name,
            from: pkg.version,
            to: bumpVersion(pkg.version, type),
            type,
          };
          debug('determine-version', `${pkg.name}: ${bump.from} → ${bump.to} (${type})`);
          bumps.set(pkg.name, bump);
        }
      }
      return { versionBumps: bumps };
    }

    // 2. Explicit --bump flag
    const bumpType = (ctx as any).cliArgs?.bump as 'patch' | 'minor' | 'major' | undefined;
    if (bumpType) {
      debug('determine-version', 'using cli bump type', bumpType);
      for (const pkg of ctx.packages) {
        const bump = {
          packageName: pkg.name,
          from: pkg.version,
          to: bumpVersion(pkg.version, bumpType),
          type: bumpType,
        };
        debug('determine-version', `${pkg.name}: ${bump.from} → ${bump.to} (${bumpType})`);
        bumps.set(pkg.name, bump);
      }
      return { versionBumps: bumps };
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
          const bump = {
            packageName: pkg.name,
            from: pkg.version,
            to: bumpVersion(pkg.version, detected),
            type: detected,
          };
          debug('determine-version', `${pkg.name}: conventional commits → ${detected}`);
          bumps.set(pkg.name, bump);
        }
      }

      if (bumps.size > 0) return { versionBumps: bumps };
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

    debug('determine-version', `total bumps: ${bumps.size}`);
    return { versionBumps: bumps };
  },
};
