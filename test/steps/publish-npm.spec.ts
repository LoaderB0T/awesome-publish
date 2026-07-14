import { describe, it, expect, vi } from 'vitest';
import { publishNpmStep } from '../../src/steps/publish-npm.js';
import { Phases } from '../../src/pipeline/phases.js';

const { publishMock } = vi.hoisted(() => ({ publishMock: vi.fn() }));
vi.mock('../../src/services/package-manager.js', () => ({
  createAdapter: () => ({ publish: publishMock, pack: vi.fn() }),
}));

function makeCtx(overrides: Record<string, unknown> = {}) {
  return {
    config: { packageManager: 'npm', registry: 'https://registry.npmjs.org' },
    packages: [{ name: 'pkg-a', version: '1.0.0', dir: '/tmp/a', packageJson: {}, config: {} }],
    tempDirs: new Map([['pkg-a', '/tmp/temp-a']]),
    versionBumps: new Map([
      ['pkg-a', { packageName: 'pkg-a', from: '1.0.0', to: '1.1.0', type: 'minor' }],
    ]),
    mode: 'ci',
    dryRun: false,
    cliArgs: {},
    ...overrides,
  } as any;
}

describe('publishNpmStep', () => {
  it('has correct phase and constraints', () => {
    expect(publishNpmStep.phase).toBe(Phases.PUBLISH_NPM);
    expect(publishNpmStep.hasSideEffects).toBe(true);
    expect(publishNpmStep.after).toContain(Phases.MODIFY_PACKAGE_JSON);
    expect(publishNpmStep.before).toContain(Phases.GITHUB_RELEASE);
  });

  it('throws when a package fails to publish (fail-fast)', async () => {
    // A permission 403 is non-transient (not retried) and must fail, not skip.
    publishMock.mockImplementation(async () => {
      throw new Error('403 Forbidden: you do not have permission to publish');
    });
    let err: Error | undefined;
    try {
      await publishNpmStep.execute(makeCtx());
    } catch (e) {
      err = e as Error;
    }
    expect(err?.message).toMatch(/Failed to publish/);
  });

  it('surfaces npm stderr (not just "Command failed") so failures are diagnosable', async () => {
    // Node's exec error carries the real reason in .stderr; .message is generic.
    publishMock.mockImplementation(async () => {
      const err: any = new Error('Command failed: npm publish');
      err.stderr = 'npm error code EOTP\nnpm error This operation requires a one-time password.';
      throw err;
    });
    let err: Error | undefined;
    try {
      await publishNpmStep.execute(makeCtx());
    } catch (e) {
      err = e as Error;
    }
    expect(err?.message).toMatch(/EOTP|one-time password/);
    // And the actionable OTP hint is appended.
    expect(err?.message).toMatch(/--otp <code>/);
  });

  it('treats a version-conflict as skipped, not a failure', async () => {
    publishMock.mockImplementation(async () => {
      throw new Error('403 Forbidden: cannot publish over the previously published version');
    });
    const result = await publishNpmStep.execute(makeCtx());
    expect(result.publishResults.get('pkg-a')?.status).toBe('skipped-already-exists');
  });

  it('skips packages with no version bump instead of re-publishing', async () => {
    publishMock.mockClear();
    const result = await publishNpmStep.execute(makeCtx({ versionBumps: new Map() }));
    expect(publishMock).not.toHaveBeenCalled();
    expect(result.publishResults.size).toBe(0);
  });
});
