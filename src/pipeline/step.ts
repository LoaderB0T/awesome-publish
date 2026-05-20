import type { Phase } from './phases.js';
import type { CoreContext } from './context.js';

export interface PipelineStep<TRead = unknown, TWrite = void> {
  name: string;
  phase: Phase;
  after: Phase[];
  before: Phase[];
  hasSideEffects?: boolean;
  shouldRun(ctx: CoreContext & TRead): boolean | Promise<boolean>;
  execute(ctx: CoreContext & TRead): Promise<TWrite>;
}

export interface Feature {
  name: string;
  steps: PipelineStep<any, any>[];
}
