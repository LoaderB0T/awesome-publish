import { existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createJiti } from 'jiti';
import type { AwesomePublishConfig, ResolvedConfig } from '../types/config.js';
import { validateConfig } from './schema.js';
import { debug } from '../services/debug.js';

/** True if the dir looks like a workspace root (per-package configs are normal). */
function isWorkspaceRoot(dir: string): boolean {
  if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return true;
  try {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8'));
    return pkg.workspaces != null;
  } catch {
    return false;
  }
}

const CONFIG_NAMES = [
  'awesome-publish.config.ts',
  'awesome-publish.config.mts',
  'awesome-publish.config.js',
  'awesome-publish.config.mjs',
];

export async function loadConfigFromDir(dir: string): Promise<AwesomePublishConfig | undefined> {
  debug('config', 'searching for config in', dir);
  for (const name of CONFIG_NAMES) {
    const configPath = resolve(dir, name);
    if (existsSync(configPath)) {
      debug('config', 'found config file', configPath);
      try {
        const jiti = createJiti(configPath, { interopDefault: true });
        const mod = (await jiti.import(configPath)) as
          | { default?: AwesomePublishConfig }
          | AwesomePublishConfig;
        const config = ('default' in mod ? mod.default : mod) as AwesomePublishConfig | undefined;
        debug('config', 'loaded config', config);
        return config;
      } catch (error: any) {
        throw new Error(`Failed to load config from ${configPath}: ${error?.message ?? error}`);
      }
    }
  }
  debug('config', 'no config found in', dir);
  return undefined;
}

/**
 * Load + validate the config for a command, warning loudly when none is found
 * (rather than silently publishing with defaults from the wrong directory). A
 * missing config is still allowed — zero-config `publishFiles: ['lib']` is a
 * supported quick start — but the user is told.
 */
export async function resolveConfigForCommand(
  dir: string,
  packageManager: 'npm' | 'yarn' | 'pnpm'
): Promise<ResolvedConfig> {
  const raw = await loadConfigFromDir(dir);
  if (!raw) {
    // In a workspace root, a missing root config is normal — packages carry
    // their own — so don't cry wolf. Warn only for a plain single-package repo.
    if (!isWorkspaceRoot(dir)) {
      console.warn(
        `⚠ No awesome-publish config found in ${dir} — using defaults (publishFiles: ['lib'], stripScripts: true). ` +
          `Run \`awesome-publish init\` to create one, or check you're in the right directory.`
      );
    }
    return validateConfig({ publishFiles: ['lib'], stripScripts: true }, packageManager);
  }
  return validateConfig(raw, packageManager);
}
