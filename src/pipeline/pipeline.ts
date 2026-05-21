import { rmSync } from 'node:fs';
import { topologicalSort } from './topological-sort.js';
import type { PipelineStep } from './step.js';
import type { CoreContext } from './context.js';
import { debug } from '../services/debug.js';

let activeTempDirs: string[] = [];
let cleanupRegistered = false;

function registerCleanupHandler() {
  if (cleanupRegistered) return;
  cleanupRegistered = true;
  const cleanup = () => {
    for (const dir of activeTempDirs) {
      try { rmSync(dir, { recursive: true, force: true }); } catch {}
    }
  };
  process.once('SIGINT', () => { cleanup(); process.exit(130); });
}

export interface PipelineResult {
  status: 'success' | 'failed';
  completed: string[];
  failed?: string;
  skipped: string[];
  error?: Error;
}

export async function runPipeline(
  steps: PipelineStep<any, any>[],
  ctx: CoreContext,
): Promise<PipelineResult> {
  registerCleanupHandler();
  const sorted = topologicalSort(steps);
  const accumulated: Record<string, unknown> = { ...ctx };
  const completed: string[] = [];
  const skipped: string[] = [];

  debug('pipeline', 'sorted step order', sorted.map(s => s.name));
  debug('pipeline', 'packages', ctx.packages.map(p => `${p.name}@${p.version}`));
  debug('pipeline', 'mode', ctx.mode, 'dryRun', ctx.dryRun);

  for (let i = 0; i < sorted.length; i++) {
    const step = sorted[i];

    const shouldRun = await step.shouldRun(accumulated as any);
    if (!shouldRun) {
      debug('step', step.name, 'skipped (shouldRun=false)');
      skipped.push(step.name);
      continue;
    }

    if (ctx.dryRun && step.hasSideEffects) {
      debug('step', step.name, 'skipped (dry-run + hasSideEffects)');
      skipped.push(step.name);
      continue;
    }

    debug('step', step.name, 'executing...');
    const startTime = Date.now();

    try {
      const result = await step.execute(accumulated as any);
      const elapsed = Date.now() - startTime;
      debug('step', step.name, `completed in ${elapsed}ms`);

      if (result != null && typeof result === 'object') {
        debug('step', step.name, 'context keys added', Object.keys(result));
        Object.assign(accumulated, result);
        if ('tempDirs' in result && result.tempDirs instanceof Map) {
          activeTempDirs = Array.from((result.tempDirs as Map<string, string>).values());
          debug('step', step.name, 'registered temp dirs', activeTempDirs);
        }
      }
      completed.push(step.name);
    } catch (error) {
      const elapsed = Date.now() - startTime;
      debug('step', step.name, `failed after ${elapsed}ms`, String(error));
      const remaining = sorted.slice(i + 1).map(s => s.name);
      return {
        status: 'failed',
        completed,
        failed: step.name,
        skipped: [...skipped, ...remaining],
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  debug('pipeline', 'completed', completed);
  debug('pipeline', 'skipped', skipped);
  activeTempDirs = [];
  return { status: 'success', completed, skipped };
}
