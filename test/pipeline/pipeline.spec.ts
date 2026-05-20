import { describe, it, expect, vi } from 'vitest';
import { runPipeline } from '../../src/pipeline/pipeline.js';
import type { PipelineStep } from '../../src/pipeline/step.js';
import type { CoreContext } from '../../src/pipeline/context.js';
import type { ResolvedConfig } from '../../src/types/config.js';

function makeContext(overrides: Partial<CoreContext> = {}): CoreContext {
  return {
    config: {
      packageManager: 'pnpm',
      publishFiles: ['lib'],
      stripScripts: true,
      requireCleanGit: true,
      changesets: { enabled: false, enforceInPR: false },
      github: { releases: { enabled: false, mode: 'per-package' } },
      aiReleaseNotes: { enabled: false },
    } satisfies ResolvedConfig,
    packages: [],
    mode: 'interactive',
    dryRun: false,
    ...overrides,
  };
}

function fakeStep(name: string, opts: {
  phase?: string;
  after?: string[];
  before?: string[];
  hasSideEffects?: boolean;
  shouldRun?: () => boolean;
  execute?: (ctx: any) => Promise<any>;
} = {}): PipelineStep<any, any> {
  return {
    name,
    phase: (opts.phase ?? name) as any,
    after: (opts.after ?? []) as any[],
    before: (opts.before ?? []) as any[],
    hasSideEffects: opts.hasSideEffects,
    shouldRun: opts.shouldRun ?? (() => true),
    execute: opts.execute ?? (async () => {}),
  };
}

describe('runPipeline', () => {
  it('executes steps in sorted order', async () => {
    const order: string[] = [];
    const steps = [
      fakeStep('b', { after: ['a'], execute: async () => { order.push('b'); } }),
      fakeStep('a', { execute: async () => { order.push('a'); } }),
    ];

    await runPipeline(steps, makeContext());
    expect(order).toEqual(['a', 'b']);
  });

  it('skips steps where shouldRun returns false', async () => {
    const executed: string[] = [];
    const steps = [
      fakeStep('a', { execute: async () => { executed.push('a'); } }),
      fakeStep('b', {
        after: ['a'],
        shouldRun: () => false,
        execute: async () => { executed.push('b'); },
      }),
    ];

    await runPipeline(steps, makeContext());
    expect(executed).toEqual(['a']);
  });

  it('skips side-effect steps in dry run', async () => {
    const executed: string[] = [];
    const steps = [
      fakeStep('a', { execute: async () => { executed.push('a'); } }),
      fakeStep('b', {
        after: ['a'],
        hasSideEffects: true,
        execute: async () => { executed.push('b'); },
      }),
    ];

    await runPipeline(steps, makeContext({ dryRun: true }));
    expect(executed).toEqual(['a']);
  });

  it('merges step context contributions', async () => {
    const steps = [
      fakeStep('a', {
        execute: async () => ({ myValue: 42 }),
      }),
      fakeStep('b', {
        after: ['a'],
        execute: async (ctx: any) => {
          expect(ctx.myValue).toBe(42);
        },
      }),
    ];

    await runPipeline(steps, makeContext());
  });

  it('stops on failure and reports state', async () => {
    const steps = [
      fakeStep('a', { execute: async () => {} }),
      fakeStep('b', {
        after: ['a'],
        execute: async () => { throw new Error('publish failed'); },
      }),
      fakeStep('c', { after: ['b'], execute: async () => {} }),
    ];

    const result = await runPipeline(steps, makeContext());
    expect(result.status).toBe('failed');
    expect(result.completed).toContain('a');
    expect(result.failed).toBe('b');
    expect(result.skipped).toContain('c');
  });
});
