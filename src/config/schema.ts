import type { AwesomePublishConfig, ResolvedConfig } from '../types/config.js';
import { DEFAULT_CONFIG } from './defaults.js';

export function defineConfig(config: AwesomePublishConfig): AwesomePublishConfig {
  return config;
}

export function normalizeConfig(
  raw: AwesomePublishConfig,
  detectedPackageManager: 'npm' | 'yarn' | 'pnpm'
): ResolvedConfig {
  const aiReleaseNotes =
    raw.aiReleaseNotes === true
      ? { enabled: true }
      : raw.aiReleaseNotes === false || raw.aiReleaseNotes == null
        ? { enabled: false }
        : raw.aiReleaseNotes;

  const gitTag =
    raw.gitTag === true
      ? { enabled: true, prefix: '' }
      : raw.gitTag === false
        ? { enabled: false, prefix: '' }
        : raw.gitTag == null
          ? { ...DEFAULT_CONFIG.gitTag }
          : { enabled: raw.gitTag.enabled, prefix: raw.gitTag.prefix ?? '' };

  const changelog =
    raw.changelog === true
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
    buildCommand: raw.buildCommand,
    access: raw.access ?? DEFAULT_CONFIG.access,
    provenance: raw.provenance ?? DEFAULT_CONFIG.provenance,
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
      ? {
          releases: {
            enabled: raw.github.releases.enabled,
            // Default the mode so releases enabled without an explicit mode
            // don't fall through to an undefined that silently reads as per-package.
            mode: raw.github.releases.mode ?? 'per-package',
            draft: raw.github.releases.draft ?? false,
          },
        }
      : { ...DEFAULT_CONFIG.github },
    aiProvider: raw.aiProvider,
    aiReleaseNotes,
  };
}

export function validateConfig(
  raw: AwesomePublishConfig,
  detectedPackageManager: 'npm' | 'yarn' | 'pnpm'
): ResolvedConfig {
  if (!raw.publishFiles || raw.publishFiles.length === 0) {
    throw new Error('Config error: publishFiles must be a non-empty array');
  }
  if (!Array.isArray(raw.publishFiles) || raw.publishFiles.some(f => typeof f !== 'string')) {
    throw new Error('Config error: publishFiles must be an array of strings');
  }

  if (
    typeof raw.stripScripts !== 'boolean' &&
    !(Array.isArray(raw.stripScripts) && raw.stripScripts.every(s => typeof s === 'string'))
  ) {
    throw new Error('Config error: stripScripts must be a boolean or an array of strings');
  }

  if (raw.buildCommand !== undefined && typeof raw.buildCommand !== 'string') {
    throw new Error('Config error: buildCommand must be a string');
  }

  if (
    raw.github?.releases?.mode &&
    !['per-package', 'combined'].includes(raw.github.releases.mode)
  ) {
    throw new Error(
      `Config error: github.releases.mode must be 'per-package' or 'combined', got '${raw.github.releases.mode}'`
    );
  }

  if (raw.access && !['public', 'restricted'].includes(raw.access)) {
    throw new Error(`Config error: access must be 'public' or 'restricted', got '${raw.access}'`);
  }

  if (raw.registry && !/^https?:\/\//.test(raw.registry)) {
    throw new Error(`Config error: registry must be an http(s) URL, got '${raw.registry}'`);
  }

  if (raw.aiProvider) {
    if (!['anthropic', 'openai-compatible'].includes(raw.aiProvider.provider)) {
      throw new Error(
        `Config error: aiProvider.provider must be 'anthropic' or 'openai-compatible', got '${raw.aiProvider.provider}'`
      );
    }
    if (!raw.aiProvider.model) {
      throw new Error('Config error: aiProvider.model is required');
    }
    if (raw.aiProvider.provider === 'openai-compatible' && !raw.aiProvider.baseUrl) {
      throw new Error(
        "Config error: aiProvider.baseUrl is required for the 'openai-compatible' provider"
      );
    }
    if (raw.aiProvider.baseUrl && !/^https?:\/\//.test(raw.aiProvider.baseUrl)) {
      throw new Error(
        `Config error: aiProvider.baseUrl must be an http(s) URL, got '${raw.aiProvider.baseUrl}'`
      );
    }
  }

  const aiEnabled =
    raw.aiReleaseNotes === true ||
    (typeof raw.aiReleaseNotes === 'object' && raw.aiReleaseNotes?.enabled);

  if (aiEnabled && !raw.aiProvider) {
    throw new Error('Config error: aiProvider must be configured when aiReleaseNotes is enabled');
  }

  return normalizeConfig(raw, detectedPackageManager);
}
