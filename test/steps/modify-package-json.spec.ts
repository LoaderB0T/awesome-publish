import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { modifyPackageJsonStep } from '../../src/steps/modify-package-json.js';
import type { ResolvedConfig } from '../../src/types/config.js';

function setup(pkgJson: Record<string, unknown>, config: Partial<ResolvedConfig> = {}) {
  const tempDir = mkdtempSync(join(tmpdir(), 'ap-modify-test-'));
  writeFileSync(join(tempDir, 'package.json'), JSON.stringify(pkgJson, null, 2));

  const resolvedConfig = {
    publishFiles: ['lib'],
    stripScripts: true,
    ...config,
  } as ResolvedConfig;

  return {
    tempDir,
    ctx: {
      config: resolvedConfig,
      packages: [{ name: 'test', version: '1.0.0', dir: '/original', packageJson: pkgJson, config: resolvedConfig }],
      mode: 'interactive' as const,
      dryRun: false,
      tempDirs: new Map([['test', tempDir]]),
      versionBumps: new Map([['test', { packageName: 'test', from: '1.0.0', to: '1.1.0', type: 'minor' as const }]]),
    },
  };
}

describe('modifyPackageJsonStep', () => {
  it('strips all scripts when stripScripts is true', async () => {
    const { tempDir, ctx } = setup({
      name: 'test', version: '1.0.0',
      scripts: { build: 'tsc', test: 'vitest', preinstall: 'check' },
    });

    await modifyPackageJsonStep.execute(ctx as any);
    const result = JSON.parse(readFileSync(join(tempDir, 'package.json'), 'utf-8'));
    expect(result.scripts).toBeUndefined();
  });

  it('strips only listed scripts when stripScripts is string[]', async () => {
    const { tempDir, ctx } = setup(
      { name: 'test', version: '1.0.0', scripts: { build: 'tsc', test: 'vitest', start: 'node .' } },
      { stripScripts: ['build', 'test'] },
    );

    await modifyPackageJsonStep.execute(ctx as any);
    const result = JSON.parse(readFileSync(join(tempDir, 'package.json'), 'utf-8'));
    expect(result.scripts).toEqual({ start: 'node .' });
  });

  it('updates version from versionBumps', async () => {
    const { tempDir, ctx } = setup({ name: 'test', version: '1.0.0' });

    await modifyPackageJsonStep.execute(ctx as any);
    const result = JSON.parse(readFileSync(join(tempDir, 'package.json'), 'utf-8'));
    expect(result.version).toBe('1.1.0');
  });

  it('sets files field to publishFiles', async () => {
    const { tempDir, ctx } = setup({ name: 'test', version: '1.0.0' });

    await modifyPackageJsonStep.execute(ctx as any);
    const result = JSON.parse(readFileSync(join(tempDir, 'package.json'), 'utf-8'));
    expect(result.files).toEqual(['lib']);
  });
});
