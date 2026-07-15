import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { withRetry, isTransientError } from './retry.js';

const execFileAsync = promisify(execFile);

export interface CreateReleaseOptions {
  tag: string;
  body?: string;
  draft?: boolean;
  prerelease?: boolean;
  /** Commit-ish the tag should point at (`target_commitish`). */
  target?: string;
}

/**
 * Parse `owner/repo` from the `origin` remote. Assumes a GitHub-hosted remote
 * (this tool targets the GitHub REST API). Throws with a clear message when the
 * remote can't be parsed.
 */
export function parseRemoteUrl(url: string): { owner: string; repo: string } {
  // Strip an optional trailing `.git`, then take the last two path segments.
  // Done as two steps (not one regex) so repo names that legitimately contain
  // dots — e.g. owner/foo.js, owner/my.cool.repo — parse correctly.
  const cleaned = url.trim().replace(/\.git$/, '');
  const match = cleaned.match(/[:/]([^/]+)\/([^/]+?)\/?$/);
  if (!match) {
    throw new Error(`Could not parse GitHub owner/repo from git remote: "${url.trim()}"`);
  }
  return { owner: match[1], repo: match[2] };
}

export async function parseGitHubRepo(cwd: string): Promise<{ owner: string; repo: string }> {
  const { stdout } = await execFileAsync('git', ['remote', 'get-url', 'origin'], { cwd });
  return parseRemoteUrl(stdout);
}

export class GitHubService {
  private readonly baseUrl: string;

  constructor(
    private readonly owner: string,
    private readonly repo: string,
    private readonly token: string,
    private readonly fetchFn: typeof fetch = fetch
  ) {
    this.baseUrl = `https://api.github.com/repos/${owner}/${repo}`;
  }

  async createRelease(options: CreateReleaseOptions): Promise<{ id: number }> {
    return withRetry(
      async () => {
        const response = await this.fetchFn(`${this.baseUrl}/releases`, {
          method: 'POST',
          headers: this.headers(),
          body: JSON.stringify({
            tag_name: options.tag,
            name: options.tag,
            body: options.body ?? '',
            draft: options.draft ?? false,
            prerelease: options.prerelease ?? false,
            ...(options.target ? { target_commitish: options.target } : {}),
          }),
        });

        if (!response.ok) {
          // Idempotency: a re-run (or a prior partial failure) may hit a tag that
          // already has a release → GitHub 422 already_exists. Reuse it instead
          // of aborting the whole pipeline after npm already published.
          if (response.status === 422) {
            const existing = await this.getReleaseByTag(options.tag);
            if (existing) return existing;
          }
          const text = await response.text();
          throw new Error(`GitHub API error ${response.status}: ${text}`);
        }

        return response.json() as Promise<{ id: number }>;
      },
      { label: 'github createRelease', shouldRetry: isTransientError }
    );
  }

  /** Look up an existing release by tag name. Returns null if there is none. */
  async getReleaseByTag(tag: string): Promise<{ id: number } | null> {
    const response = await this.fetchFn(
      `${this.baseUrl}/releases/tags/${encodeURIComponent(tag)}`,
      { headers: this.headers() }
    );
    if (response.status === 404) return null;
    if (!response.ok) return null;
    return response.json() as Promise<{ id: number }>;
  }

  async updateRelease(releaseId: number, body: string): Promise<void> {
    await withRetry(
      async () => {
        const response = await this.fetchFn(`${this.baseUrl}/releases/${releaseId}`, {
          method: 'PATCH',
          headers: this.headers(),
          body: JSON.stringify({ body }),
        });

        if (!response.ok) {
          const text = await response.text();
          throw new Error(`GitHub API error ${response.status}: ${text}`);
        }
      },
      { label: 'github updateRelease', shouldRetry: isTransientError }
    );
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }
}
