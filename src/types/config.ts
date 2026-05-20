export interface AwesomePublishConfig {
  packageManager?: 'npm' | 'yarn' | 'pnpm';
  publishFiles: string[];
  stripScripts: boolean | string[];
  requireCleanGit?: boolean;
  changesets?: {
    enabled: boolean;
    enforceInPR?: boolean;
  };
  github?: {
    releases?: {
      enabled: boolean;
      mode: 'per-package' | 'combined';
    };
  };
  aiProvider?: {
    provider: 'anthropic' | 'openai-compatible';
    model: string;
    baseUrl?: string;
  };
  aiReleaseNotes?: boolean | {
    enabled: boolean;
    customPromptFile?: string;
  };
}

export interface ResolvedConfig {
  packageManager: 'npm' | 'yarn' | 'pnpm';
  publishFiles: string[];
  stripScripts: boolean | string[];
  requireCleanGit: boolean;
  changesets: { enabled: boolean; enforceInPR: boolean };
  github: { releases: { enabled: boolean; mode: 'per-package' | 'combined' } };
  aiProvider?: { provider: 'anthropic' | 'openai-compatible'; model: string; baseUrl?: string };
  aiReleaseNotes: { enabled: boolean; customPromptFile?: string };
}
