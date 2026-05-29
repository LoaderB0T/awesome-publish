export interface CreateReleaseOptions {
  tag: string;
  body?: string;
  draft?: boolean;
  prerelease?: boolean;
}

export class GitHubService {
  private readonly baseUrl: string;

  constructor(
    private readonly owner: string,
    private readonly repo: string,
    private readonly token: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {
    this.baseUrl = `https://api.github.com/repos/${owner}/${repo}`;
  }

  async createRelease(options: CreateReleaseOptions): Promise<{ id: number }> {
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
  }

  async updateRelease(releaseId: number, body: string): Promise<void> {
    const response = await this.fetchFn(`${this.baseUrl}/releases/${releaseId}`, {
      method: 'PATCH',
      headers: this.headers(),
      body: JSON.stringify({ body }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`GitHub API error ${response.status}: ${text}`);
    }
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
