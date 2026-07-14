import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface Commit {
  hash: string;
  message: string;
  /** Commit body (everything after the subject line), used to detect the Conventional Commits `BREAKING CHANGE:` footer. */
  body?: string;
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
    // Unit separator (0x1f) between fields, record separator (0x1e) between
    // commits, so multi-line bodies survive and we can detect the
    // `BREAKING CHANGE:` footer (not just the `!` bang in the subject).
    const { stdout } = await this.exec('git', [
      'log',
      `${tag}..HEAD`,
      '--format=%H%x1f%s%x1f%b%x1e',
      '--no-merges',
    ]);

    const commits: Commit[] = [];
    for (const record of stdout.split('\x1e')) {
      const trimmed = record.trim();
      if (!trimmed) continue;
      const [hash, message = '', body = ''] = trimmed.split('\x1f');
      commits.push({ hash: hash.trim(), message: message.trim(), body: body.trim() });
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

  public async getCurrentBranch(): Promise<string | null> {
    try {
      const { stdout } = await this.exec('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
      const branch = stdout.trim();
      // "HEAD" means detached (e.g. actions/checkout's default state).
      return branch && branch !== 'HEAD' ? branch : null;
    } catch {
      return null;
    }
  }

  public async pushCurrentBranch(): Promise<void> {
    // Push an explicit refspec instead of a bare `git push`. A bare push relies
    // on an upstream + push.default, which is absent on a detached HEAD (the
    // default state after actions/checkout in CI) and fails there.
    const branch = await this.getCurrentBranch();
    if (branch) {
      await this.exec('git', ['push', 'origin', `HEAD:${branch}`]);
    } else {
      // Detached HEAD: fall back to a bare push so the underlying git error is
      // surfaced to the user rather than us guessing a branch name.
      await this.exec('git', ['push']);
    }
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
