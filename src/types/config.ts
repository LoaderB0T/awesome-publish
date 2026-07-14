export interface AwesomePublishConfig {
  packageManager?: 'npm' | 'yarn' | 'pnpm';
  registry?: string;
  publishFiles: string[];
  stripScripts: boolean | string[];
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
