import { describe, it, expect } from 'vitest';
import { topologicalSort } from '../../src/pipeline/topological-sort.js';
import type { PipelineStep } from '../../src/pipeline/step.js';
import type { CoreContext } from '../../src/pipeline/context.js';

function fakeStep(phase: string, after: string[] = [], before: string[] = []): PipelineStep {
  return {
    name: phase,
    phase: phase as any,
    after: after as any[],
    before: before as any[],
    shouldRun: () => true,
    execute: async () => {},
  };
}

describe('topologicalSort', () => {
  it('returns steps in dependency order', () => {
    const steps = [
      fakeStep('c', ['b']),
      fakeStep('a'),
      fakeStep('b', ['a']),
    ];
    const sorted = topologicalSort(steps);
    const names = sorted.map(s => s.name);
    expect(names).toEqual(['a', 'b', 'c']);
  });

  it('handles before constraints', () => {
    const steps = [
      fakeStep('cleanup', [], []),
      fakeStep('publish', [], ['cleanup']),
    ];
    const sorted = topologicalSort(steps);
    const names = sorted.map(s => s.name);
    expect(names.indexOf('publish')).toBeLessThan(names.indexOf('cleanup'));
  });

  it('ignores missing phase references', () => {
    const steps = [
      fakeStep('b', ['nonexistent']),
      fakeStep('a'),
    ];
    const sorted = topologicalSort(steps);
    expect(sorted).toHaveLength(2);
  });

  it('throws on circular dependency', () => {
    const steps = [
      fakeStep('a', ['b']),
      fakeStep('b', ['a']),
    ];
    expect(() => topologicalSort(steps)).toThrow(/cycle/i);
  });

  it('preserves insertion order for independent steps', () => {
    const steps = [
      fakeStep('x'),
      fakeStep('y'),
      fakeStep('z'),
    ];
    const sorted = topologicalSort(steps);
    const names = sorted.map(s => s.name);
    expect(names).toEqual(['x', 'y', 'z']);
  });
});
