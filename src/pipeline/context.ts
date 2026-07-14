import type { ResolvedConfig } from '../types/config.js';
import type { PackageInfo, VersionBump, PublishResult } from '../types/package-info.js';
import type { Changeset } from '../types/changeset.js';

export interface CoreContext {
  config: ResolvedConfig;
  packages: PackageInfo[];
  /**
   * Total publishable packages in the workspace, BEFORE any `--filter` is
   * applied. Monorepo-vs-single-package decisions (tag naming, commit scoping,
   * changelog format) must key off this, not `packages.length` — a filtered
   * single-package run of a monorepo must still use `pkg@1.2.3` tags and
   * dir-scoped commit ranges. Falls back to `packages.length` when unset.
   */
  totalPackageCount?: number;
  /** Which CLI command is driving the pipeline. */
  command?: 'publish' | 'pack' | 'version';
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
  /**
   * Latest existing tag per package, captured before git-tag creates the new
   * release tag. Downstream steps diff commits since this to build changelogs
   * and release notes. `null` means the package has no prior tag.
   */
  previousTags: Map<string, string | null>;
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
