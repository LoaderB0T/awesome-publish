import type { ResolvedConfig } from '../types/config.js';
import type { PackageInfo } from '../types/package-info.js';
import { GitService } from './git.js';
import { GitHubService, parseGitHubRepo } from './github.js';
import { fetchPackageVersions } from './registry.js';
import { buildTagName, buildCombinedTagName } from '../steps/git-tag.js';
import { debug } from './debug.js';

/**
 * Where the version currently sitting in a package.json actually got to. A
 * release writes to up to three places — the registry, a git tag, a GitHub
 * release — and a crash between them leaves the version present in some and
 * missing from others. Reading those three back is what makes a release
 * resumable without any state file: the sinks themselves are the state.
 */
export interface PackageReleaseState {
  packageName: string;
  /** Version in the package's package.json — the one that may be in flight. */
  version: string;
  /** This exact version exists on the registry. */
  onRegistry: boolean;
  /** The package has *any* published version (false = never released at all). */
  everPublished: boolean;
  /** Git tag for this version exists. `true` when git tags are disabled (sink not in use). */
  tagged: boolean;
  /** GitHub release for this version exists. `true` when the sink is disabled or unverifiable. */
  released: boolean;
  /** Tag name for this version, or null when git tags are disabled. */
  tag: string | null;
  /** An enabled sink is missing this version — the release started and never finished. */
  inFlight: boolean;
}

export interface DetectReleaseStateOptions {
  rootDir: string;
  packages: PackageInfo[];
  config: ResolvedConfig;
  totalPackageCount: number;
  registry: string;
  /**
   * `true` (an explicit `--resume`): a lookup we cannot complete aborts. We are
   * about to act on the answer, and acting on a guess either double-publishes or
   * silently skips a package.
   *
   * `false` (the advisory check on an ordinary run): a lookup failure means "we
   * don't know", the package is reported as not in flight, and the run proceeds.
   * A registry blip must not fail a release that had nothing to do with resuming.
   */
  strict: boolean;
}

/**
 * The commit a release is (or was) cut from: the commit its git tag points at,
 * falling back to HEAD.
 *
 * The fallback is why a `--resume` long after the fact can still attribute the
 * release correctly *when git tags are enabled* — the tag pins the commit no
 * matter how far main has moved since.
 *
 * ponytail: with `gitTag.enabled: false` there is no pin, so a delayed resume
 * falls back to today's HEAD (the pre-existing behaviour). Recording the release
 * commit somewhere else would fix it; enabling git tags fixes it for free.
 */
export async function resolveReleaseCommit(
  git: GitService,
  opts: {
    packageName: string;
    version: string;
    packageCount: number;
    config: ResolvedConfig;
  }
): Promise<string | null> {
  if (opts.config.gitTag.enabled) {
    const tag = buildTagName(
      opts.packageName,
      opts.version,
      opts.packageCount,
      opts.config.gitTag.prefix
    );
    const sha = await git.getTagCommit(tag);
    if (sha) return sha;
  }
  return git.getHeadSha();
}

/**
 * Read back what actually happened for each package's current version.
 *
 * Costs one registry request per package, plus one GitHub request when GitHub
 * releases are enabled. Packages are probed concurrently.
 */
export async function detectReleaseState(
  opts: DetectReleaseStateOptions
): Promise<PackageReleaseState[]> {
  const git = new GitService(opts.rootDir);
  const github = await createGitHubService(opts);

  return Promise.all(opts.packages.map(pkg => detectOne(pkg, git, github, opts)));
}

async function createGitHubService(opts: DetectReleaseStateOptions): Promise<GitHubService | null> {
  if (!opts.config.github.releases.enabled) return null;
  // Drafts have no tag on GitHub until they are published, so the tag lookup
  // that identifies a release cannot see them. Treat the sink as unverifiable
  // rather than reporting every draft release as a missing one.
  if (opts.config.github.releases.draft) {
    debug('release-state', 'draft releases enabled — GitHub release sink not verifiable');
    return null;
  }
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    if (opts.strict) {
      throw new Error(
        'GITHUB_TOKEN is required to check whether the GitHub release for this version exists.'
      );
    }
    debug('release-state', 'no GITHUB_TOKEN — skipping GitHub release check');
    return null;
  }
  try {
    const { owner, repo } = await parseGitHubRepo(opts.rootDir);
    return new GitHubService(owner, repo, token);
  } catch (error: any) {
    if (opts.strict) throw error;
    debug('release-state', 'could not resolve GitHub repo', String(error));
    return null;
  }
}

async function detectOne(
  pkg: PackageInfo,
  git: GitService,
  github: GitHubService | null,
  opts: DetectReleaseStateOptions
): Promise<PackageReleaseState> {
  const version = pkg.version;
  const tag = opts.config.gitTag.enabled
    ? buildTagName(pkg.name, version, opts.totalPackageCount, opts.config.gitTag.prefix)
    : null;

  const unknown: PackageReleaseState = {
    packageName: pkg.name,
    version,
    onRegistry: false,
    everPublished: false,
    tagged: true,
    released: true,
    tag,
    inFlight: false,
  };

  let onRegistry: boolean;
  let everPublished: boolean;
  try {
    const versions = await fetchPackageVersions(pkg.name, opts.registry);
    everPublished = versions !== null && versions.length > 0;
    onRegistry = versions?.includes(version) ?? false;
  } catch (error: any) {
    if (opts.strict) {
      throw new Error(
        `Cannot determine whether ${pkg.name}@${version} is published: ${error?.message ?? error}\n` +
          `  Refusing to resume without knowing — retry once the registry is reachable.`
      );
    }
    debug(
      'release-state',
      `${pkg.name}: registry lookup failed, assuming not in flight`,
      String(error)
    );
    return unknown;
  }

  const tagged = tag ? await git.tagExists(tag) : true;

  let released = true;
  if (github) {
    // A combined release is keyed by the release commit, not the package
    // version, so resolve the commit first. Without a tag to pin it we cannot
    // identify the release, so the sink stays unverified.
    const releaseTag =
      opts.config.github.releases.mode === 'combined'
        ? await combinedTagFor(git, pkg, version, opts)
        : tag;
    if (releaseTag) {
      try {
        released = (await github.getReleaseByTag(releaseTag)) !== null;
      } catch (error: any) {
        if (opts.strict) {
          throw new Error(
            `Cannot determine whether the GitHub release ${releaseTag} exists: ${error?.message ?? error}`
          );
        }
        debug('release-state', `${pkg.name}: GitHub release lookup failed`, String(error));
      }
    }
  }

  // A package that has never been published and has no tags is not "in flight",
  // it is simply unreleased — otherwise every brand-new package would report a
  // phantom half-finished release of whatever version its package.json starts at.
  const started = everPublished || tagged;
  const inFlight = started && !(onRegistry && tagged && released);

  debug(
    'release-state',
    `${pkg.name}@${version}: registry=${onRegistry} tagged=${tagged} released=${released} inFlight=${inFlight}`
  );

  return {
    packageName: pkg.name,
    version,
    onRegistry,
    everPublished,
    tagged,
    released,
    tag,
    inFlight,
  };
}

async function combinedTagFor(
  git: GitService,
  pkg: PackageInfo,
  version: string,
  opts: DetectReleaseStateOptions
): Promise<string | null> {
  if (!opts.config.gitTag.enabled) return null;
  const commit = await resolveReleaseCommit(git, {
    packageName: pkg.name,
    version,
    packageCount: opts.totalPackageCount,
    config: opts.config,
  });
  return commit ? buildCombinedTagName(commit) : null;
}

/** Human-readable list of the sinks a version is missing from. */
export function describeMissingSinks(state: PackageReleaseState): string {
  const missing: string[] = [];
  if (!state.onRegistry) missing.push('not on registry');
  if (!state.tagged) missing.push('not tagged');
  if (!state.released) missing.push('no GitHub release');
  return missing.join(', ');
}
