import type { ResolvedConfig } from '../types/config.js';

export const DEFAULT_CONFIG: Omit<
  ResolvedConfig,
  'packageManager' | 'publishFiles' | 'stripScripts'
> = {
  registry: 'https://registry.npmjs.org',
  access: 'public',
  provenance: false,
  requireCleanGit: true,
  gitTag: { enabled: true, prefix: '' },
  changelog: { enabled: true, file: 'CHANGELOG.md' },
  conventionalCommits: false,
  confirmPublish: true,
  syncDependencies: false,
  changesets: { enabled: false, enforceInPR: false },
  github: { releases: { enabled: false, mode: 'per-package', draft: false } },
  aiReleaseNotes: { enabled: false },
};
