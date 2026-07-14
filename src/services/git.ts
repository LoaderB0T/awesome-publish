import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface Commit {
  hash: string;
  message: string;
}

export class GitService {
  constructor(private readonly cwd: string) {}

  public async isWorkingTreeClean(): Promise<boolean> {
    const { stdout } = await this.exec('git', ['status', '--porcelain']);
    return stdout.trim() === '';
  }

  public async getLatestTag(prefix?: string): Promise<string | null> {
    try {
      const args = ['describe', '--tags', '--abbrev=0'];
      if (prefix) {
        args.push(`--match=${prefix}*`);
      }
      const { stdout } = await this.exec('git', args);
      return stdout.trim() || null;
    } catch {
      return null;
    }
  }

  public async getCommitsSinceTag(tag: string): Promise<Commit[]> {
    const { stdout } = await this.exec('git', [
      'log',
      `${tag}..HEAD`,
      '--format=%H%n%s',
      '--no-merges',
    ]);
    if (!stdout.trim()) return [];

    const lines = stdout.trim().split('\n');
    const commits: Commit[] = [];
    for (let i = 0; i < lines.length; i += 2) {
      commits.push({ hash: lines[i], message: lines[i + 1] });
    }
    return commits;
  }

  public async createTag(tag: string): Promise<void> {
    await this.exec('git', ['tag', tag]);
  }

  public async tagExists(tag: string): Promise<boolean> {
    const { stdout } = await this.exec('git', ['tag', '--list', tag]);
    return stdout.trim() !== '';
  }

  /**
   * Stage all changes and create a release commit.
   * ponytail: `git add -A` assumes a clean tree before the release (the default
   * requireCleanGit gate guarantees this). With --ignore-git the user has opted
   * out, so any pre-existing dirty state is folded into the release commit.
   */
  public async commitAll(message: string): Promise<void> {
    await this.exec('git', ['add', '-A']);
    await this.exec('git', ['commit', '-m', message]);
  }

  public async pushCurrentBranch(): Promise<void> {
    await this.exec('git', ['push']);
  }

  public async pushTags(tags?: string[]): Promise<void> {
    if (tags && tags.length > 0) {
      await this.exec('git', ['push', 'origin', ...tags]);
    } else {
      await this.exec('git', ['push', '--tags']);
    }
  }

  public async getStagedFiles(): Promise<string[]> {
    const { stdout } = await this.exec('git', ['diff', '--cached', '--name-only']);
    return stdout.trim().split('\n').filter(Boolean);
  }

  public async getUserName(): Promise<string | null> {
    try {
      const { stdout } = await this.exec('git', ['config', 'user.name']);
      return stdout.trim() || null;
    } catch {
      return null;
    }
  }

  public async getUserEmail(): Promise<string | null> {
    try {
      const { stdout } = await this.exec('git', ['config', 'user.email']);
      return stdout.trim() || null;
    } catch {
      return null;
    }
  }

  public async getChangedFilesSince(branch: string): Promise<string[]> {
    try {
      const { stdout } = await this.exec('git', ['diff', '--name-only', `${branch}...HEAD`]);
      return stdout.trim().split('\n').filter(Boolean);
    } catch {
      // Fallback: branch might not exist, try without three-dot
      const { stdout } = await this.exec('git', ['diff', '--name-only', branch]);
      return stdout.trim().split('\n').filter(Boolean);
    }
  }

  private async exec(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
    return execFileAsync(cmd, args, { cwd: this.cwd });
  }
}
