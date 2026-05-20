import type { ResolvedConfig } from './config.js';

export interface PackageInfo {
  name: string;
  version: string;
  dir: string;
  packageJson: Record<string, unknown>;
  config: ResolvedConfig;
}

export interface VersionBump {
  packageName: string;
  from: string;
  to: string;
  type: 'patch' | 'minor' | 'major';
}

export interface PublishResult {
  packageName: string;
  version: string;
  registry: string;
  status: 'published' | 'skipped-already-exists';
}
