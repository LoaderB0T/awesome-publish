import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createJiti } from 'jiti';
import type { AwesomePublishConfig } from '../types/config.js';

const CONFIG_NAMES = [
  'awesome-publish.config.ts',
  'awesome-publish.config.mts',
  'awesome-publish.config.js',
  'awesome-publish.config.mjs',
];

export async function loadConfigFromDir(dir: string): Promise<AwesomePublishConfig | undefined> {
  for (const name of CONFIG_NAMES) {
    const configPath = resolve(dir, name);
    if (existsSync(configPath)) {
      const jiti = createJiti(configPath, { interopDefault: true });
      const mod = await jiti.import(configPath) as { default?: AwesomePublishConfig } | AwesomePublishConfig;
      return 'default' in mod ? mod.default : mod;
    }
  }
  return undefined;
}
