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
    versionBumps: new Map([['pkg-a', { packageName: 'pkg-a', from: '1.0.0', to: '1.1.0', type: 'minor' }]]),
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
    publishMock.mockImplementation(async () => { throw new Error('500 Internal Server Error'); });
    let err: Error | undefined;
    try { await publishNpmStep.execute(makeCtx()); } catch (e) { err = e as Error; }
    expect(err?.message).toMatch(/Failed to publish/);
  });

  it('treats 403/already-published as skipped, not a failure', async () => {
    publishMock.mockImplementation(async () => { throw new Error('403 Forbidden: previously published'); });
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
