import type { PipelineStep } from './step.js';

export function topologicalSort(steps: PipelineStep<any, any>[]): PipelineStep<any, any>[] {
  const phaseToStep = new Map<string, PipelineStep<any, any>>();
  for (const step of steps) {
    // Two steps sharing a phase would collapse to one here and later surface as
    // a bogus "cycle detected"; fail with the real cause instead.
    if (phaseToStep.has(step.phase)) {
      throw new Error(
        `Duplicate pipeline phase "${step.phase}" (steps "${phaseToStep.get(step.phase)!.name}" and "${step.name}") — each phase must be unique.`
      );
    }
    phaseToStep.set(step.phase, step);
  }

  const registeredPhases = new Set(phaseToStep.keys());

  // Build adjacency list: edge from A → B means A must run before B
  const graph = new Map<string, Set<string>>();
  const inDegree = new Map<string, number>();

  for (const step of steps) {
    graph.set(step.phase, graph.get(step.phase) ?? new Set());
    inDegree.set(step.phase, inDegree.get(step.phase) ?? 0);
  }

  for (const step of steps) {
    // "after" constraint: dependency → this step
    for (const dep of step.after) {
      if (!registeredPhases.has(dep)) continue;
      if (!graph.get(dep)!.has(step.phase)) {
        graph.get(dep)!.add(step.phase);
        inDegree.set(step.phase, (inDegree.get(step.phase) ?? 0) + 1);
      }
    }

    // "before" constraint: this step → target
    for (const target of step.before) {
      if (!registeredPhases.has(target)) continue;
      if (!graph.get(step.phase)!.has(target)) {
        graph.get(step.phase)!.add(target);
        inDegree.set(target, (inDegree.get(target) ?? 0) + 1);
      }
    }
  }

  // Kahn's algorithm — use array (not Set) as queue to preserve insertion order
  const queue: string[] = [];
  for (const step of steps) {
    if (inDegree.get(step.phase) === 0) {
      queue.push(step.phase);
    }
  }

  const sorted: PipelineStep<any, any>[] = [];
  let idx = 0;

  while (idx < queue.length) {
    const phase = queue[idx++];
    sorted.push(phaseToStep.get(phase)!);

    for (const neighbor of graph.get(phase) ?? []) {
      const deg = inDegree.get(neighbor)! - 1;
      inDegree.set(neighbor, deg);
      if (deg === 0) {
        queue.push(neighbor);
      }
    }
  }

  if (sorted.length !== steps.length) {
    const remaining = steps.filter(s => !sorted.some(r => r.phase === s.phase)).map(s => s.phase);
    throw new Error(`Cycle detected in pipeline phases: ${remaining.join(' → ')}`);
  }

  return sorted;
}
