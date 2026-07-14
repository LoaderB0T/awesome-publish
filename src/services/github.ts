import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { withRetry, isTransientError } from './retry.js';

const execFileAsync = promisify(execFile);

export interface CreateReleaseOptions {
  tag: string;
  body?: string;
  draft?: boolean;
  prerelease?: boolean;
}

/**
 * Parse `owner/repo` from the `origin` remote. Assumes a GitHub-hosted remote
 * (this tool targets the GitHub REST API). Throws with a clear message when the
 * remote can't be parsed.
 */
export async function parseGitHubRepo(cwd: string): Promise<{ owner: string; repo: string }> {
  const { stdout } = await execFileAsync('git', ['remote', 'get-url', 'origin'], { cwd });
  const match = stdout.trim().match(/[:/]([^/]+)\/([^/.]+?)(?:\.git)?$/);
  if (!match) {
    throw new Error(`Could not parse GitHub owner/repo from git remote: "${stdout.trim()}"`);
  }
  return { owner: match[1], repo: match[2] };
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
          }),
        });

        if (!response.ok) {
          const text = await response.text();
          throw new Error(`GitHub API error ${response.status}: ${text}`);
        }

        return response.json() as Promise<{ id: number }>;
      },
      { label: 'github createRelease', shouldRetry: isTransientError }
    );
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
