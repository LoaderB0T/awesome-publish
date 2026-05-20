import { topologicalSort } from './topological-sort.js';
import type { PipelineStep } from './step.js';
import type { CoreContext } from './context.js';

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
  const sorted = topologicalSort(steps);
  const accumulated: Record<string, unknown> = { ...ctx };
  const completed: string[] = [];
  const skipped: string[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const step = sorted[i];

    const shouldRun = await step.shouldRun(accumulated as any);
    if (!shouldRun) {
      skipped.push(step.name);
      continue;
    }

    if (ctx.dryRun && step.hasSideEffects) {
      skipped.push(step.name);
      continue;
    }

    try {
      const result = await step.execute(accumulated as any);
      if (result != null && typeof result === 'object') {
        Object.assign(accumulated, result);
      }
      completed.push(step.name);
    } catch (error) {
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

  return { status: 'success', completed, skipped };
}
