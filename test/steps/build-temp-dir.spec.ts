import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rmSync } from 'node:fs';
import { buildTempDirStep } from '../../src/steps/build-temp-dir.js';
import type { ResolvedConfig } from '../../src/types/config.js';

function createFakePackage(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ap-build-test-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'test', version: '1.0.0' }));
  mkdirSync(join(dir, 'lib'));
  writeFileSync(join(dir, 'lib', 'index.js'), 'export default 1;');
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src', 'index.ts'), 'export default 1;');
  writeFileSync(join(dir, 'README.md'), '# Test');
  return dir;
}

const createdDirs: string[] = [];

afterEach(() => {
  for (const d of createdDirs) {
    rmSync(d, { recursive: true, force: true });
  }
  createdDirs.length = 0;
});

describe('buildTempDirStep', () => {
  it('copies only whitelisted files to temp dir', async () => {
    const pkgDir = createFakePackage();
    const config = {
      publishFiles: ['lib', 'README.md'],
    } as ResolvedConfig;

    const ctx = {
      config,
      packages: [{ name: 'test', version: '1.0.0', dir: pkgDir, packageJson: {}, config }],
      mode: 'interactive' as const,
      dryRun: false,
    };

    const result = await buildTempDirStep.execute(ctx as any);
    const tempDir = result.tempDirs.get('test')!;
    createdDirs.push(tempDir);

    expect(existsSync(join(tempDir, 'lib', 'index.js'))).toBe(true);
    expect(existsSync(join(tempDir, 'README.md'))).toBe(true);
    expect(existsSync(join(tempDir, 'src'))).toBe(false);
    expect(existsSync(join(tempDir, 'package.json'))).toBe(true);
  });
});
