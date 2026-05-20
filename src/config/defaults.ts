import type { ResolvedConfig } from '../types/config.js';

export const DEFAULT_CONFIG: Omit<ResolvedConfig, 'packageManager' | 'publishFiles' | 'stripScripts'> = {
  requireCleanGit: true,
  changesets: { enabled: false, enforceInPR: false },
  github: { releases: { enabled: false, mode: 'per-package' } },
  aiReleaseNotes: { enabled: false },
};
