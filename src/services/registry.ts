import { withRetry, isTransientError } from './retry.js';

/**
 * Fetch every published version of a package from an npm registry.
 *
 * Returns `null` when the package does not exist on the registry at all (404),
 * which callers must distinguish from `[]` — "package exists, no versions" — and
 * from a thrown error ("we could not find out"). Guessing on a failed lookup is
 * how a release either double-publishes or silently skips, so failures throw.
 */
export async function fetchPackageVersions(
  packageName: string,
  registry: string,
  fetchFn: typeof fetch = fetch
): Promise<string[] | null> {
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
    return null;
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
  return data.versions ? Object.keys(data.versions) : [];
}
