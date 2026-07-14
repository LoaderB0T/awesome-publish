import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
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

  it('always includes README and LICENSE even when not in publishFiles', async () => {
    const pkgDir = createFakePackage();
    writeFileSync(join(pkgDir, 'LICENSE'), 'MIT');
    // publishFiles deliberately omits README/LICENSE.
    const config = { publishFiles: ['lib'] } as ResolvedConfig;

    const ctx = {
      config,
      packages: [{ name: 'test', version: '1.0.0', dir: pkgDir, packageJson: {}, config }],
      mode: 'interactive' as const,
      dryRun: false,
    };

    const result = await buildTempDirStep.execute(ctx as any);
    const tempDir = result.tempDirs.get('test')!;
    createdDirs.push(tempDir);

    expect(existsSync(join(tempDir, 'README.md'))).toBe(true);
    expect(existsSync(join(tempDir, 'LICENSE'))).toBe(true);
  });

  it('does not crash when a directory matches the README/LICENSE glob', async () => {
    const pkgDir = createFakePackage();
    mkdirSync(join(pkgDir, 'LICENSES')); // REUSE convention — a directory
    writeFileSync(join(pkgDir, 'LICENSES', 'MIT.txt'), 'MIT');
    const config = { publishFiles: ['lib'] } as ResolvedConfig;

    const ctx = {
      config,
      packages: [{ name: 'test', version: '1.0.0', dir: pkgDir, packageJson: {}, config }],
      mode: 'interactive' as const,
      dryRun: false,
    };

    const result = await buildTempDirStep.execute(ctx as any);
    const tempDir = result.tempDirs.get('test')!;
    createdDirs.push(tempDir);
    // README.md (a file) is still copied; the LICENSES dir is skipped, no crash.
    expect(existsSync(join(tempDir, 'README.md'))).toBe(true);
    expect(existsSync(join(tempDir, 'LICENSES'))).toBe(false);
  });

  it('throws instead of publishing an empty package when publishFiles match nothing', async () => {
    const pkgDir = mkdtempSync(join(tmpdir(), 'ap-build-empty-'));
    writeFileSync(
      join(pkgDir, 'package.json'),
      JSON.stringify({ name: 'empty', version: '1.0.0' })
    );
    // publishFiles points at a dir that doesn't exist, and there IS a bump.
    const config = { publishFiles: ['dist'] } as ResolvedConfig;

    const ctx = {
      config,
      packages: [{ name: 'empty', version: '1.0.0', dir: pkgDir, packageJson: {}, config }],
      versionBumps: new Map([
        ['empty', { packageName: 'empty', from: '1.0.0', to: '1.0.1', type: 'patch' }],
      ]),
      mode: 'ci' as const,
      dryRun: false,
    };

    await expect(buildTempDirStep.execute(ctx as any)).rejects.toThrow(/empty|matched/i);
  });

  it('throws on an empty match under `pack` even with no version bump (C5)', async () => {
    const pkgDir = mkdtempSync(join(tmpdir(), 'ap-build-pack-empty-'));
    writeFileSync(
      join(pkgDir, 'package.json'),
      JSON.stringify({ name: 'empty', version: '1.0.0' })
    );
    const config = { publishFiles: ['dist'] } as ResolvedConfig;

    // No versionBumps for this package, but `pack` packs every resolved package
    // regardless of bump — an empty match must still fail loudly rather than
    // emit a tarball containing only package.json.
    const ctx = {
      config,
      packages: [{ name: 'empty', version: '1.0.0', dir: pkgDir, packageJson: {}, config }],
      versionBumps: new Map(),
      command: 'pack' as const,
      mode: 'ci' as const,
      dryRun: false,
    };

    await expect(buildTempDirStep.execute(ctx as any)).rejects.toThrow(/empty|matched/i);
  });

  it('does NOT throw on an empty match for a no-bump sibling under `publish`', async () => {
    const pkgDir = mkdtempSync(join(tmpdir(), 'ap-build-nobump-'));
    writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name: 'sib', version: '1.0.0' }));
    const config = { publishFiles: ['dist'] } as ResolvedConfig;

    // publish-npm skips a no-bump sibling, so an empty match for it is harmless.
    const ctx = {
      config,
      packages: [{ name: 'sib', version: '1.0.0', dir: pkgDir, packageJson: {}, config }],
      versionBumps: new Map(),
      command: 'publish' as const,
      mode: 'ci' as const,
      dryRun: false,
    };

    const result = await buildTempDirStep.execute(ctx as any);
    createdDirs.push(result.tempDirs.get('sib')!);
    expect(result.tempDirs.has('sib')).toBe(true);
  });
});
