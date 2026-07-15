export interface AwesomePublishConfig {
  packageManager?: 'npm' | 'yarn' | 'pnpm';
  registry?: string;
  /**
   * Files/globs to include in the published package (also written to `files`).
   * Optional only when {@link publishDir} is set — then it defaults to the whole
   * built directory and acts as a copy filter rather than the package contents.
   */
  publishFiles?: string[];
  stripScripts: boolean | string[];
  /**
   * Publish from a built subdirectory (e.g. `'dist'`) instead of the package
   * root. When set, awesome-publish packs the manifest and files found *inside*
   * `<packageDir>/<publishDir>` — so the generated `dist/package.json` (with its
   * own `exports`, resolved by ng-packagr / a tsc post-build) is published, not
   * the source `package.json`. {@link publishFiles} becomes an optional copy
   * filter (default: the whole directory), and the built manifest's own `files`
   * is left untouched. Version bumping and `workspace:` range resolution still
   * apply to the built manifest.
   */
  publishDir?: string;
  /**
   * Command run (in the repo, before packing) to build publishable artifacts —
   * e.g. 'npm run build'. Needed because publishFiles are copied as-is and
   * lifecycle scripts are stripped, so a compiled package must be built first.
   */
  buildCommand?: string;
  /** npm access for scoped packages on first publish. Default 'public'. */
  access?: 'public' | 'restricted';
  /** Publish with npm provenance (requires OIDC, e.g. GitHub Actions id-token). Default false. */
  provenance?: boolean;
  requireCleanGit?: boolean;
  gitTag?:
    | boolean
    | {
        enabled: boolean;
        prefix?: string;
      };
  changelog?:
    | boolean
    | {
        enabled: boolean;
        file?: string;
      };
  conventionalCommits?: boolean;
  confirmPublish?: boolean;
  syncDependencies?: boolean;
  changesets?: {
    enabled: boolean;
    enforceInPR?: boolean;
  };
  github?: {
    releases?: {
      enabled: boolean;
      mode: 'per-package' | 'combined';
      draft?: boolean;
    };
  };
  aiProvider?: {
    provider: 'anthropic' | 'openai-compatible';
    model: string;
    baseUrl?: string;
  };
  aiReleaseNotes?:
    | boolean
    | {
        enabled: boolean;
        customPromptFile?: string;
      };
}

export interface ResolvedConfig {
  packageManager: 'npm' | 'yarn' | 'pnpm';
  registry: string;
  publishFiles: string[];
  publishDir?: string;
  stripScripts: boolean | string[];
  buildCommand?: string;
  access: 'public' | 'restricted';
  provenance: boolean;
  requireCleanGit: boolean;
  gitTag: { enabled: boolean; prefix: string };
  changelog: { enabled: boolean; file: string };
  conventionalCommits: boolean;
  confirmPublish: boolean;
  syncDependencies: boolean;
  changesets: { enabled: boolean; enforceInPR: boolean };
  github: { releases: { enabled: boolean; mode: 'per-package' | 'combined'; draft: boolean } };
  aiProvider?: { provider: 'anthropic' | 'openai-compatible'; model: string; baseUrl?: string };
  aiReleaseNotes: { enabled: boolean; customPromptFile?: string };
}
