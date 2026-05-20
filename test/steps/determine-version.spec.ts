import { describe, it, expect } from 'vitest';
import { determineVersionStep } from '../../src/steps/determine-version.js';
import type { CoreContext, ChangesetContext } from '../../src/pipeline/context.js';
import type { ResolvedConfig } from '../../src/types/config.js';

function makeCtx(overrides: Record<string, unknown> = {}): CoreContext & Partial<ChangesetContext> {
  return {
    config: {
      packageManager: 'pnpm',
      publishFiles: ['lib'],
      stripScripts: true,
      requireCleanGit: true,
      changesets: { enabled: false, enforceInPR: false },
      github: { releases: { enabled: false, mode: 'per-package' } },
      aiReleaseNotes: { enabled: false },
    },
    packages: [
      { name: 'pkg-a', version: '1.0.0', dir: '/tmp/a', packageJson: {}, config: {} as ResolvedConfig },
    ],
    mode: 'ci' as const,
    dryRun: false,
    ...overrides,
  } as any;
}

describe('determineVersionStep', () => {
  it('determines version from changesets', async () => {
    const ctx = makeCtx({
      changesets: [
        { id: 'abc', summary: 'feat', releases: [{ name: 'pkg-a', type: 'minor' }] },
      ],
    });
    ctx.config.changesets = { enabled: true, enforceInPR: false };

    const result = await determineVersionStep.execute(ctx as any);
    expect(result.versionBumps.get('pkg-a')).toEqual({
      packageName: 'pkg-a',
      from: '1.0.0',
      to: '1.1.0',
      type: 'minor',
    });
  });

  it('uses --bump arg in CI mode without changesets', async () => {
    const ctx = makeCtx({ cliArgs: { bump: 'patch' } });
    const result = await determineVersionStep.execute(ctx as any);
    expect(result.versionBumps.get('pkg-a')?.to).toBe('1.0.1');
  });

  it('takes highest bump when multiple changesets affect same package', async () => {
    const ctx = makeCtx({
      changesets: [
        { id: 'a', summary: 'fix', releases: [{ name: 'pkg-a', type: 'patch' }] },
        { id: 'b', summary: 'feat', releases: [{ name: 'pkg-a', type: 'minor' }] },
      ],
    });
    ctx.config.changesets = { enabled: true, enforceInPR: false };

    const result = await determineVersionStep.execute(ctx as any);
    expect(result.versionBumps.get('pkg-a')?.type).toBe('minor');
  });
});
