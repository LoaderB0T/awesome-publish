const BUMP_ORDER = { patch: 0, minor: 1, major: 2 } as const;

/**
 * Bump a semver version string. Handles prerelease versions by stripping
 * the prerelease suffix before bumping (e.g. 1.0.0-beta.1 → 1.0.0 for patch).
 */
export function bumpVersion(version: string, type: 'patch' | 'minor' | 'major'): string {
  // Strip prerelease suffix (everything after first -)
  const baseVersion = version.includes('-') ? version.slice(0, version.indexOf('-')) : version;
  const parts = baseVersion.split('.');

  if (parts.length < 3) {
    throw new Error(`Invalid version: "${version}" — expected semver format (x.y.z)`);
  }

  const [major, minor, patch] = parts.map(Number);

  if ([major, minor, patch].some(n => Number.isNaN(n))) {
    throw new Error(`Invalid version: "${version}" — contains non-numeric parts`);
  }

  switch (type) {
    case 'major':
      return `${major + 1}.0.0`;
    case 'minor':
      return `${major}.${minor + 1}.0`;
    case 'patch':
      return `${major}.${minor}.${patch + 1}`;
  }
}

/**
 * Return the higher of two bump types.
 */
export function highestBump(
  a: 'patch' | 'minor' | 'major',
  b: 'patch' | 'minor' | 'major',
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
  fetchFn: typeof fetch = fetch,
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

    const response = await fetchFn(url, { headers });

    if (response.status === 404) {
      return `${prefix}0`;
    }

    if (response.status === 401 || response.status === 403) {
      throw new Error(
        `Registry returned ${response.status} for ${packageName}. Set NPM_TOKEN env var for private registries.`,
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
    throw new Error(`Failed to query registry for prerelease versions of ${packageName}: ${error?.message ?? error}`);
  }
}
