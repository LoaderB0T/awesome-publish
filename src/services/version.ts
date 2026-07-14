import semver from 'semver';
import { withRetry, isTransientError } from './retry.js';

const BUMP_ORDER = { patch: 0, minor: 1, major: 2 } as const;

export interface BumpOptions {
  /**
   * Apply changesets-style pre-1.0 semantics: while the major version is 0, a
   * `major` bump is demoted to `minor` and a `minor` to `patch`, so an
   * automatic (changeset / conventional-commit) release never silently
   * graduates a 0.x package to 1.0.0. Explicit `--bump major` does NOT pass
   * this flag, so it stays the intentional escape hatch to reach 1.0.0.
   */
  zeroBased?: boolean;
}

/**
 * Bump a semver version string using the canonical `semver` library. Standard
 * semver semantics apply: finalizing a prerelease keeps its target version
 * (1.0.0-beta.1 + patch → 1.0.0, not 1.0.1) and build metadata is handled
 * correctly. See {@link BumpOptions.zeroBased} for pre-1.0 handling.
 */
export function bumpVersion(
  version: string,
  type: 'patch' | 'minor' | 'major',
  options: BumpOptions = {}
): string {
  let effectiveType = type;
  if (options.zeroBased && semver.major(version) === 0) {
    if (type === 'major') effectiveType = 'minor';
    else if (type === 'minor') effectiveType = 'patch';
  }
  const result = semver.inc(version, effectiveType);
  if (!result) {
    throw new Error(`Invalid version: "${version}" — expected semver format (x.y.z)`);
  }
  return result;
}

/**
 * Guard against writing a version that is not strictly newer than the current
 * one (a downgrade). Finalizing a prerelease to its own base (1.0.0-beta.1 →
 * 1.0.0) is an increase and passes; a computed version lower than the current
 * (e.g. a mismatched `--pre` identifier resolving below a published stable)
 * throws so the release aborts before anything is written or published.
 */
export function assertNoDowngrade(from: string, to: string): void {
  if (semver.valid(from) && semver.valid(to) && semver.lt(to, from)) {
    throw new Error(`Refusing to publish a downgrade: ${from} → ${to}`);
  }
}

/**
 * Return the higher of two bump types.
 */
export function highestBump(
  a: 'patch' | 'minor' | 'major',
  b: 'patch' | 'minor' | 'major'
): 'patch' | 'minor' | 'major' {
  return BUMP_ORDER[a] >= BUMP_ORDER[b] ? a : b;
}

const VALID_BUMPS = new Set(['patch', 'minor', 'major']);

/**
 * Validate a bump type string from user input. Returns the validated type or throws.
 */
export function validateBumpType(value: string): 'patch' | 'minor' | 'major' {
  if (!VALID_BUMPS.has(value)) {
    throw new Error(`Invalid bump type: "${value}" — must be patch, minor, or major`);
  }
  return value as 'patch' | 'minor' | 'major';
}

const PRE_ID_RE = /^[a-zA-Z][a-zA-Z0-9-]*$/;

/**
 * Validate a prerelease identifier (e.g. "beta", "alpha", "rc").
 */
export function validatePreIdentifier(id: string): string {
  if (!PRE_ID_RE.test(id)) {
    throw new Error(`Invalid prerelease identifier "${id}" — must match [a-zA-Z][a-zA-Z0-9-]*`);
  }
  return id;
}

/**
 * Extract the base version (without prerelease suffix) from a semver string.
 */
export function stripPrerelease(version: string): string {
  return version.includes('-') ? version.slice(0, version.indexOf('-')) : version;
}

/**
 * Extract the prerelease identifier from a version string (e.g. "1.1.0-beta.3" → "beta").
 * Returns null if not a prerelease version.
 */
export function extractPreIdentifier(version: string): string | null {
  const dashIdx = version.indexOf('-');
  if (dashIdx === -1) return null;
  const pre = version.slice(dashIdx + 1);
  // identifier is everything before the last .N
  const dotIdx = pre.lastIndexOf('.');
  if (dotIdx === -1) return pre;
  return pre.slice(0, dotIdx);
}

/**
 * Query npm registry for existing prerelease versions and return the next
 * auto-incremented prerelease version.
 *
 * e.g. if 1.1.0-beta.0 and 1.1.0-beta.1 exist, returns "1.1.0-beta.2"
 */
export async function resolvePreVersion(
  packageName: string,
  baseVersion: string,
  identifier: string,
  registry: string,
  fetchFn: typeof fetch = fetch
): Promise<string> {
  const prefix = `${baseVersion}-${identifier}.`;

  try {
    const url = `${registry.replace(/\/$/, '')}/${encodeURIComponent(packageName)}`;
    const headers: Record<string, string> = {
      Accept: 'application/vnd.npm.install-v1+json',
    };

    const token = process.env.NPM_TOKEN;
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const response = await withRetry(() => fetchFn(url, { headers }), {
      label: `registry query ${packageName}`,
      shouldRetry: isTransientError,
    });

    if (response.status === 404) {
      return `${prefix}0`;
    }

    if (response.status === 401 || response.status === 403) {
      throw new Error(
        `Registry returned ${response.status} for ${packageName}. Set NPM_TOKEN env var for private registries.`
      );
    }

    if (!response.ok) {
      throw new Error(`Registry returned ${response.status} for ${packageName}`);
    }

    const data = (await response.json()) as { versions?: Record<string, unknown> };
    const versions = data.versions ? Object.keys(data.versions) : [];

    let maxN = -1;
    for (const v of versions) {
      if (v.startsWith(prefix)) {
        const n = parseInt(v.slice(prefix.length), 10);
        if (!Number.isNaN(n) && n > maxN) maxN = n;
      }
    }

    return `${prefix}${maxN + 1}`;
  } catch (error: any) {
    if (error?.message?.includes('Registry returned')) throw error;
    throw new Error(
      `Failed to query registry for prerelease versions of ${packageName}: ${error?.message ?? error}`
    );
  }
}
