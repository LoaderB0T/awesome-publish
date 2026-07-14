import { describe, it, expect } from 'vitest';
import { gitCommitStep } from '../../src/steps/git-commit.js';
import { Phases } from '../../src/pipeline/phases.js';

describe('gitCommitStep', () => {
  it('runs after publish/write-versions and before git-tag', () => {
    expect(gitCommitStep.phase).toBe(Phases.GIT_COMMIT);
    expect(gitCommitStep.hasSideEffects).toBe(true);
    expect(gitCommitStep.after).toContain(Phases.PUBLISH_NPM);
    expect(gitCommitStep.before).toContain(Phases.GIT_TAG);
  });

  it('shouldRun only when there are version bumps', () => {
    expect(gitCommitStep.shouldRun({ versionBumps: new Map() } as any)).toBe(false);
    expect(gitCommitStep.shouldRun({
      versionBumps: new Map([['a', { to: '1.0.1' }]]),
    } as any)).toBe(true);
  });
});
