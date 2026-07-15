import { GitService } from '../services/git.js';
import type { ResolvedConfig } from '../types/config.js';

/**
 * Enforce a clean working tree before a release, with a friendly message when
 * the directory isn't a git repo at all. Shared by publish/pack/version so all
 * three behave identically (no raw git errors leaking out).
 */
export async function assertGitClean(
  rootDir: string,
  config: ResolvedConfig,
  ignoreGit: boolean | undefined
): Promise<void> {
  if (!config.requireCleanGit || ignoreGit) return;

  const git = new GitService(rootDir);
  let clean: boolean;
  try {
    clean = await git.isWorkingTreeClean();
  } catch (error: any) {
    if (
      error?.message?.includes('not a git repository') ||
      error?.stderr?.includes('not a git repository')
    ) {
      throw new Error(
        'Not a git repository. Run "git init" first, or use --ignore-git to skip git checks'
      );
    }
    throw error;
  }

  if (!clean) {
    throw new Error('Working tree is not clean. Commit or stash changes, or use --ignore-git');
  }
}
