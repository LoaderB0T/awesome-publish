import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { withRetry, isTransientError } from './retry.js';

const execFileAsync = promisify(execFile);

export interface Commit {
  hash: string;
  message: string;
  /** Commit body (everything after the subject line), used to detect the Conventional Commits `BREAKING CHANGE:` footer. */
  body?: string;
}

export class GitService {
  constructor(private readonly cwd: string) {}

  public async isRepo(): Promise<boolean> {
    try {
      await this.exec('git', ['rev-parse', '--is-inside-work-tree']);
      return true;
    } catch {
      return false;
    }
  }

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

  /**
   * Commits since a tag, optionally scoped to a subdirectory (`git log -- dir`)
   * so a monorepo package's changelog/release notes list only its own commits.
   */
  public async getCommitsSinceTag(tag: string, pathScope?: string): Promise<Commit[]> {
    return this.logCommits(`${tag}..HEAD`, pathScope);
  }

  /**
   * All commits reachable from HEAD (optionally path-scoped). Used for a
   * package's first release, when no prior tag exists to diff against.
   */
  public async getAllCommits(pathScope?: string): Promise<Commit[]> {
    return this.logCommits('HEAD', pathScope);
  }

  private async logCommits(range: string, pathScope?: string): Promise<Commit[]> {
    // Unit separator (0x1f) between fields, record separator (0x1e) between
    // commits, so multi-line bodies survive and we can detect the
    // `BREAKING CHANGE:` footer (not just the `!` bang in the subject).
    const args = ['log', range, '--format=%H%x1f%s%x1f%b%x1e', '--no-merges'];
    // Path scope must come after a `--` separator.
    if (pathScope) args.push('--', pathScope);
    const { stdout } = await this.exec('git', args);

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

  public async getHeadSha(): Promise<string | null> {
    try {
      const { stdout } = await this.exec('git', ['rev-parse', 'HEAD']);
      return stdout.trim() || null;
    } catch {
      return null;
    }
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
    // Retry transient network failures — a blip here aborts the run *after* the
    // npm publish already succeeded, which is the worst place to give up.
    await withRetry(
      () =>
        branch
          ? this.exec('git', ['push', 'origin', `HEAD:${branch}`])
          : // Detached HEAD: fall back to a bare push so the underlying git error
            // is surfaced to the user rather than us guessing a branch name.
            this.exec('git', ['push']),
      { label: 'git push', shouldRetry: isTransientError }
    );
  }

  public async pushTags(tags?: string[]): Promise<void> {
    await withRetry(
      () =>
        tags && tags.length > 0
          ? this.exec('git', ['push', 'origin', ...tags])
          : this.exec('git', ['push', '--tags']),
      { label: 'git push tags', shouldRetry: isTransientError }
    );
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
    // execFile defaults to a 1 MiB stdout buffer; `git log` over a long history
    // (first release on an established repo) easily exceeds that. Raise it.
    return execFileAsync(cmd, args, { cwd: this.cwd, maxBuffer: 256 * 1024 * 1024 });
  }
}
