import { describe, it, expect } from 'vitest';
import { publishNpmStep } from '../../src/steps/publish-npm.js';
import { Phases } from '../../src/pipeline/phases.js';

describe('publishNpmStep', () => {
  it('has correct phase and constraints', () => {
    expect(publishNpmStep.phase).toBe(Phases.PUBLISH_NPM);
    expect(publishNpmStep.hasSideEffects).toBe(true);
    expect(publishNpmStep.after).toContain(Phases.MODIFY_PACKAGE_JSON);
    expect(publishNpmStep.before).toContain(Phases.GITHUB_RELEASE);
  });

  it('shouldRun returns true', () => {
    const ctx = { config: {}, packages: [], mode: 'interactive', dryRun: false } as any;
    expect(publishNpmStep.shouldRun(ctx)).toBe(true);
  });
});
