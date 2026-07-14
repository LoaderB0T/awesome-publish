export interface AwesomePublishConfig {
  packageManager?: 'npm' | 'yarn' | 'pnpm';
  registry?: string;
  publishFiles: string[];
  stripScripts: boolean | string[];
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
