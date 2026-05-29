import type { AwesomePublishConfig, ResolvedConfig } from '../types/config.js';
import { DEFAULT_CONFIG } from './defaults.js';

export function defineConfig(config: AwesomePublishConfig): AwesomePublishConfig {
  return config;
}

export function normalizeConfig(
  raw: AwesomePublishConfig,
  detectedPackageManager: 'npm' | 'yarn' | 'pnpm',
): ResolvedConfig {
  const aiReleaseNotes = raw.aiReleaseNotes === true
    ? { enabled: true }
    : raw.aiReleaseNotes === false || raw.aiReleaseNotes == null
      ? { enabled: false }
      : raw.aiReleaseNotes;

  const gitTag = raw.gitTag === true
    ? { enabled: true, prefix: '' }
    : raw.gitTag === false
      ? { enabled: false, prefix: '' }
      : raw.gitTag == null
        ? { ...DEFAULT_CONFIG.gitTag }
        : { enabled: raw.gitTag.enabled, prefix: raw.gitTag.prefix ?? '' };

  const changelog = raw.changelog === true
    ? { enabled: true, file: 'CHANGELOG.md' }
    : raw.changelog === false
      ? { enabled: false, file: 'CHANGELOG.md' }
      : raw.changelog == null
        ? { ...DEFAULT_CONFIG.changelog }
        : { enabled: raw.changelog.enabled, file: raw.changelog.file ?? 'CHANGELOG.md' };

  return {
    packageManager: raw.packageManager ?? detectedPackageManager,
    registry: raw.registry ?? DEFAULT_CONFIG.registry,
    publishFiles: raw.publishFiles,
    stripScripts: raw.stripScripts,
    requireCleanGit: raw.requireCleanGit ?? DEFAULT_CONFIG.requireCleanGit,
    gitTag,
    changelog,
    conventionalCommits: raw.conventionalCommits ?? DEFAULT_CONFIG.conventionalCommits,
    confirmPublish: raw.confirmPublish ?? DEFAULT_CONFIG.confirmPublish,
    syncDependencies: raw.syncDependencies ?? DEFAULT_CONFIG.syncDependencies,
    changesets: raw.changesets
      ? { enabled: raw.changesets.enabled, enforceInPR: raw.changesets.enforceInPR ?? false }
      : { ...DEFAULT_CONFIG.changesets },
    github: raw.github?.releases
      ? { releases: { enabled: raw.github.releases.enabled, mode: raw.github.releases.mode, draft: raw.github.releases.draft ?? false } }
      : { ...DEFAULT_CONFIG.github },
    aiProvider: raw.aiProvider,
    aiReleaseNotes,
  };
}

export function validateConfig(
  raw: AwesomePublishConfig,
  detectedPackageManager: 'npm' | 'yarn' | 'pnpm',
): ResolvedConfig {
  if (!raw.publishFiles || raw.publishFiles.length === 0) {
    throw new Error('Config error: publishFiles must be a non-empty array');
  }

  if (raw.github?.releases?.mode && !['per-package', 'combined'].includes(raw.github.releases.mode)) {
    throw new Error(`Config error: github.releases.mode must be 'per-package' or 'combined', got '${raw.github.releases.mode}'`);
  }

  const aiEnabled = raw.aiReleaseNotes === true
    || (typeof raw.aiReleaseNotes === 'object' && raw.aiReleaseNotes?.enabled);

  if (aiEnabled && !raw.aiProvider) {
    throw new Error('Config error: aiProvider must be configured when aiReleaseNotes is enabled');
  }

  return normalizeConfig(raw, detectedPackageManager);
}
