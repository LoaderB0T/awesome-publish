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
  public async getCommitsSinceTag(
    tag: string,
    pathScope?: string,
    head = 'HEAD'
  ): Promise<Commit[]> {
    return this.logCommits(`${tag}..${head}`, pathScope);
  }

  /**
   * All commits reachable from `head` (optionally path-scoped). Used for a
   * package's first release, when no prior tag exists to diff against.
   */
  public async getAllCommits(pathScope?: string, head = 'HEAD'): Promise<Commit[]> {
    return this.logCommits(head, pathScope);
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
      commits.push({
        hash: hash.trim(),
        message: message.trim(),
        body: body.trim(),
      });
    }
    return commits;
  }

  /**
   * All tags matching a prefix. Unlike {@link getLatestTag} (which is
   * `git describe`, so it only sees tags reachable from HEAD and returns the
   * single nearest one) this lists every matching tag, so callers can pick the
   * highest version *below* a given one — needed when resuming a release whose
   * own tag already exists.
   */
  public async listTags(prefix?: string): Promise<string[]> {
    const args = ['tag', '--list'];
    if (prefix) args.push(`${prefix}*`);
    const { stdout } = await this.exec('git', args);
    return stdout
      .split('\n')
      .map(t => t.trim())
      .filter(Boolean);
  }

  /**
   * Committer date of a commit, ISO-8601 with the committer's own offset
   * (`2026-08-17T20:07:53+00:00`). Read from the commit rather than the clock so
   * a value derived from it stays the same on a later re-run.
   */
  public async getCommitDate(commitish: string): Promise<string | null> {
    try {
      const { stdout } = await this.exec('git', ['show', '-s', '--format=%cI', commitish]);
      return stdout.trim() || null;
    } catch {
      return null;
    }
  }

  /** Commit SHA a tag points at, or null if the tag does not exist. */
  public async getTagCommit(tag: string): Promise<string | null> {
    try {
      // `^{commit}` dereferences annotated tags to their commit.
      const { stdout } = await this.exec('git', ['rev-list', '-n', '1', tag]);
      return stdout.trim() || null;
    } catch {
      return null;
    }
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
    // On a fresh CI runner (e.g. GitHub Actions) no git identity is configured,
    // so a bare `git commit` aborts with "Please tell me who you are" — and that
    // happens AFTER npm publish has already run, leaving the release half-done.
    // Inject a bot identity via `-c` for whichever of name/email is missing, so
    // the release commit always succeeds. A configured value always wins.
    const args = ['commit', '-m', message];
    const [name, email] = await Promise.all([this.getUserName(), this.getUserEmail()]);
    if (!email) args.unshift('-c', 'user.email=awesome-publish@users.noreply.github.com');
    if (!name) args.unshift('-c', 'user.name=awesome-publish');
    await this.exec('git', args);
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
    // Detached HEAD is the DEFAULT state after actions/checkout on a push event,
    // so getCurrentBranch() is null in exactly the tool's own generated CI. A
    // bare `git push` has no upstream there and fails *after* npm publish already
    // ran. Fall back to the CI-provided branch name (GITHUB_REF_NAME is the
    // pushed branch on push events) and push an explicit refspec.
    const targetBranch = branch ?? process.env.GITHUB_REF_NAME ?? null;
    // Retry transient network failures — a blip here aborts the run *after* the
    // npm publish already succeeded, which is the worst place to give up.
    await withRetry(
      () =>
        targetBranch
          ? this.exec('git', ['push', 'origin', `HEAD:refs/heads/${targetBranch}`])
          : // Truly detached with no CI hint: bare push so git's own error
            // surfaces rather than us guessing a branch name.
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

  /**
   * Files changed since `branch` — committed, staged, unstaged AND untracked.
   * `git diff branch...HEAD` only compares commits, so a dirty tree on main (or a
   * branch whose work isn't committed yet) looks like "no changes". Diffing the
   * merge-base against the WORKING TREE (two-dot, no HEAD) covers committed +
   * staged + unstaged tracked files; `ls-files --others` adds new files.
   */
  public async getChangedFilesSince(branch: string): Promise<string[]> {
    let base = branch;
    try {
      const { stdout } = await this.exec('git', ['merge-base', branch, 'HEAD']);
      base = stdout.trim() || branch;
    } catch {
      // Branch doesn't exist (or no HEAD yet) — diff against it directly below.
    }
    const [tracked, untracked] = await Promise.all([
      this.exec('git', ['diff', '--name-only', base]).then(r => r.stdout),
      this.exec('git', ['ls-files', '--others', '--exclude-standard']).then(r => r.stdout),
    ]);
    return [
      ...new Set(
        `${tracked}\n${untracked}`
          .split('\n')
          .map(f => f.trim())
          .filter(Boolean)
      ),
    ];
  }

  private async exec(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
    // execFile defaults to a 1 MiB stdout buffer; `git log` over a long history
    // (first release on an established repo) easily exceeds that. Raise it.
    return execFileAsync(cmd, args, {
      cwd: this.cwd,
      maxBuffer: 256 * 1024 * 1024,
    });
  }
}
