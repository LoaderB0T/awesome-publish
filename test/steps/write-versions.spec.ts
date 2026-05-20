import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { writeVersionsStep } from '../../src/steps/write-versions.js';

describe('writeVersionsStep', () => {
  it('writes bumped version to source package.json', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ap-write-ver-'));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'test', version: '1.0.0' }, null, 2));

    const ctx = {
      config: { packageManager: 'pnpm', publishFiles: ['lib'], stripScripts: true, requireCleanGit: true, changesets: { enabled: false, enforceInPR: false }, github: { releases: { enabled: false, mode: 'per-package' } }, aiReleaseNotes: { enabled: false } },
      packages: [{ name: 'test', version: '1.0.0', dir, packageJson: { name: 'test', version: '1.0.0' }, config: {} }],
      mode: 'interactive' as const,
      dryRun: false,
      versionBumps: new Map([['test', { packageName: 'test', from: '1.0.0', to: '1.1.0', type: 'minor' as const }]]),
    };

    await writeVersionsStep.execute(ctx as any);
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8'));
    expect(pkg.version).toBe('1.1.0');
  });
});
