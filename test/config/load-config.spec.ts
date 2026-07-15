import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { loadConfigFromDir } from '../../src/config/load-config.js';

const fixturesDir = resolve(import.meta.dirname, '../fixtures/configs');

describe('loadConfigFromDir', () => {
  it('loads a TypeScript config file', async () => {
    const config = await loadConfigFromDir(resolve(fixturesDir, 'basic'));
    expect(config).toBeDefined();
    expect(config!.publishFiles).toEqual(['lib']);
  });

  it('returns undefined when no config file found', async () => {
    const config = await loadConfigFromDir(resolve(fixturesDir, 'empty'));
    expect(config).toBeUndefined();
  });
});
