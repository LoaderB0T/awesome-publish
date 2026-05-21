import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createJiti } from 'jiti';
import type { AwesomePublishConfig } from '../types/config.js';
import { debug } from '../services/debug.js';

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
      const jiti = createJiti(configPath, { interopDefault: true });
      const mod = await jiti.import(configPath) as { default?: AwesomePublishConfig } | AwesomePublishConfig;
      const config = ('default' in mod ? mod.default : mod) as AwesomePublishConfig | undefined;
      debug('config', 'loaded config', config);
      return config;
    }
  }
  debug('config', 'no config found in', dir);
  return undefined;
}
