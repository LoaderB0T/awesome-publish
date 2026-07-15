import { describe, it, expect } from 'vitest';
import { packLocalStep } from '../../src/steps/pack-local.js';
import { Phases } from '../../src/pipeline/phases.js';

describe('packLocalStep', () => {
  it('has correct phase and constraints', () => {
    expect(packLocalStep.phase).toBe(Phases.PACK_LOCAL);
    expect(packLocalStep.hasSideEffects).toBe(true);
    expect(packLocalStep.after).toContain(Phases.MODIFY_PACKAGE_JSON);
  });
});
