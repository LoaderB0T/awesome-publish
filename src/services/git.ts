import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface Commit {
  hash: string;
  message: string;
}

export class GitService {
  constructor(private readonly cwd: string) {}

  async isWorkingTreeClean(): Promise<boolean> {
    const { stdout } = await this.exec('git', ['status', '--porcelain']);
    return stdout.trim() === '';
  }

  async getLatestTag(prefix?: string): Promise<string | null> {
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

  async getCommitsSinceTag(tag: string): Promise<Commit[]> {
    const { stdout } = await this.exec('git', ['log', `${tag}..HEAD`, '--format=%H%n%s', '--no-merges']);
    if (!stdout.trim()) return [];

    const lines = stdout.trim().split('\n');
    const commits: Commit[] = [];
    for (let i = 0; i < lines.length; i += 2) {
      commits.push({ hash: lines[i], message: lines[i + 1] });
    }
    return commits;
  }

  async createTag(tag: string): Promise<void> {
    await this.exec('git', ['tag', tag]);
  }

  async getStagedFiles(): Promise<string[]> {
    const { stdout } = await this.exec('git', ['diff', '--cached', '--name-only']);
    return stdout.trim().split('\n').filter(Boolean);
  }

  async getUserName(): Promise<string | null> {
    try {
      const { stdout } = await this.exec('git', ['config', 'user.name']);
      return stdout.trim() || null;
    } catch {
      return null;
    }
  }

  async getUserEmail(): Promise<string | null> {
    try {
      const { stdout } = await this.exec('git', ['config', 'user.email']);
      return stdout.trim() || null;
    } catch {
      return null;
    }
  }

  async getChangedFilesSince(branch: string): Promise<string[]> {
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
