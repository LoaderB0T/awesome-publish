import type { ResolvedConfig } from '../types/config.js';
import type { PackageInfo, VersionBump, PublishResult } from '../types/package-info.js';
import type { Changeset } from '../types/changeset.js';

export interface CoreContext {
  config: ResolvedConfig;
  packages: PackageInfo[];
  mode: 'interactive' | 'ci';
  dryRun: boolean;
  debug: boolean;
}

export interface ChangesetContext {
  changesets: Changeset[];
}

export interface VersionContext {
  versionBumps: Map<string, VersionBump>;
  isPrerelease: boolean;
}

export interface TempDirContext {
  tempDirs: Map<string, string>;
}

export interface AiNotesContext {
  releaseNotes: Map<string, string>;
}

export interface PublishContext {
  publishResults: Map<string, PublishResult>;
}

export interface GithubReleaseContext {
  releaseIds: Map<string, number>;
}

export interface ChangelogContext {
  changelogEntries: Map<string, string>;
}
