import { rmSync } from 'node:fs';
import { AwesomeLogger } from 'awesome-logging';
import { topologicalSort } from './topological-sort.js';
import type { PipelineStep } from './step.js';
import type { CoreContext } from './context.js';
import type { VersionBump, PublishResult } from '../types/package-info.js';
import type { Changeset } from '../types/changeset.js';
import { debug } from '../services/debug.js';

let activeTempDirs: string[] = [];
let cleanupRegistered = false;

function registerCleanupHandler() {
  if (cleanupRegistered) return;
  cleanupRegistered = true;
  const cleanup = () => {
    for (const dir of activeTempDirs) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {}
    }
  };
  // Best-effort temp-dir cleanup on abnormal termination. Signals clean up then
  // exit with the conventional 128+signal code; 'exit' cleans up without
  // re-exiting (calling process.exit inside an 'exit' handler is a no-op).
  process.once('SIGINT', () => {
    cleanup();
    process.exit(130);
  });
  process.once('SIGTERM', () => {
    cleanup();
    process.exit(143);
  });
  process.once('exit', cleanup);
}

const STEP_LABELS: Record<string, string> = {
  'read-changesets': 'Read changesets',
  'consume-changesets': 'Consume changesets',
  'determine-version': 'Determine version',
  'confirm-publish': 'Confirm publish',
  'sync-dependencies': 'Sync dependencies',
  'write-versions': 'Write versions',
  'write-changelog': 'Write changelog',
  'ai-notes-generate': 'Generate AI release notes',
  'build-temp-dir': 'Build temp directory',
  'modify-package-json': 'Modify package.json',
  'publish-npm': 'Publish to npm',
  'pack-local': 'Pack locally',
  'git-commit': 'Commit release',
  'git-tag': 'Create git tags',
  'github-release': 'Create GitHub release',
  'ai-notes-publish': 'Publish AI notes to release',
  cleanup: 'Cleanup',
};

function stepLabel(name: string): string {
  return STEP_LABELS[name] ?? name;
}

function stepSummary(name: string, ctx: Record<string, unknown>): string {
  const label = stepLabel(name);

  switch (name) {
    case 'read-changesets': {
      const changesets = ctx.changesets as Changeset[] | undefined;
      if (!changesets?.length) return `${label}: none found`;
      const types = new Set(changesets.flatMap(cs => cs.releases.map(r => r.type)));
      const highest = types.has('major') ? 'major' : types.has('minor') ? 'minor' : 'patch';
      return `${label}: ${changesets.length} found (${highest})`;
    }

    case 'determine-version': {
      const bumps = ctx.versionBumps as Map<string, VersionBump> | undefined;
      if (!bumps?.size) return `${label}: no bumps`;
      if (bumps.size === 1) {
        const bump = bumps.values().next().value!;
        return `${label}: ${bump.from} → ${bump.to} (${bump.type})`;
      }
      return `${label}: ${bumps.size} packages`;
    }

    case 'write-versions': {
      const bumps = ctx.versionBumps as Map<string, VersionBump> | undefined;
      if (!bumps?.size) return label;
      if (bumps.size === 1) {
        const bump = bumps.values().next().value!;
        return `${label}: ${bump.packageName}@${bump.to}`;
      }
      return `${label}: ${bumps.size} packages`;
    }

    case 'consume-changesets': {
      const changesets = ctx.changesets as Changeset[] | undefined;
      return `${label}: ${changesets?.length ?? 0} consumed`;
    }

    case 'build-temp-dir': {
      const tempDirs = ctx.tempDirs as Map<string, string> | undefined;
      return `${label}: ${tempDirs?.size ?? 0} packages`;
    }

    case 'modify-package-json': {
      const tempDirs = ctx.tempDirs as Map<string, string> | undefined;
      return `${label}: ${tempDirs?.size ?? 0} packages`;
    }

    case 'publish-npm': {
      const results = ctx.publishResults as Map<string, PublishResult> | undefined;
      if (!results?.size) return label;
      const published = [...results.values()].filter(r => r.status === 'published');
      const skipped = [...results.values()].filter(r => r.status === 'skipped-already-exists');
      const parts: string[] = [];
      if (published.length) parts.push(`${published.length} published`);
      if (skipped.length) parts.push(`${skipped.length} already exist`);
      return `${label}: ${parts.join(', ')}`;
    }

    case 'pack-local': {
      const tempDirs = ctx.tempDirs as Map<string, string> | undefined;
      return `${label}: ${tempDirs?.size ?? 0} tarballs`;
    }

    case 'github-release': {
      const releaseIds = ctx.releaseIds as Map<string, number> | undefined;
      if (!releaseIds?.size) return label;
      return `${label}: ${releaseIds.size} created`;
    }

    case 'ai-notes-generate': {
      const notes = ctx.releaseNotes as Map<string, string> | undefined;
      return `${label}: ${notes?.size ?? 0} packages`;
    }

    case 'ai-notes-publish': {
      const notes = ctx.releaseNotes as Map<string, string> | undefined;
      return `${label}: ${notes?.size ?? 0} updated`;
    }

    case 'confirm-publish':
      return `${label}: confirmed`;

    case 'sync-dependencies': {
      return label;
    }

    case 'write-changelog': {
      const entries = ctx.changelogEntries as Map<string, string> | undefined;
      return `${label}: ${entries?.size ?? 0} packages`;
    }

    case 'git-tag': {
      const bumps2 = ctx.versionBumps as Map<string, VersionBump> | undefined;
      return `${label}: ${bumps2?.size ?? 0} tags`;
    }

    case 'cleanup': {
      const tempDirs = ctx.tempDirs as Map<string, string> | undefined;
      return `${label}: ${tempDirs?.size ?? 0} dirs removed`;
    }

    default:
      return label;
  }
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
  ctx: CoreContext
): Promise<PipelineResult> {
  registerCleanupHandler();
  const sorted = topologicalSort(steps);
  const accumulated: Record<string, unknown> = { ...ctx };
  const completed: string[] = [];
  const skipped: string[] = [];

  debug(
    'pipeline',
    'sorted step order',
    sorted.map(s => s.name)
  );
  debug(
    'pipeline',
    'packages',
    ctx.packages.map(p => `${p.name}@${p.version}`)
  );
  debug('pipeline', 'mode', ctx.mode, 'dryRun', ctx.dryRun);

  const items = sorted.map(s => ({ text: stepLabel(s.name), state: 'pending' as const }));
  const checklist = AwesomeLogger.log('checklist', { items, logAllFinalStates: true });

  for (let i = 0; i < sorted.length; i++) {
    const step = sorted[i];

    const shouldRun = await step.shouldRun(accumulated as any);
    if (!shouldRun) {
      debug('step', step.name, 'skipped (shouldRun=false)');
      checklist.changeState(i, 'skipped', `${stepLabel(step.name)} (skipped)`);
      skipped.push(step.name);
      continue;
    }

    if (ctx.dryRun && step.hasSideEffects) {
      debug('step', step.name, 'skipped (dry-run + hasSideEffects)');
      checklist.changeState(i, 'skipped', `${stepLabel(step.name)} (dry-run)`);
      skipped.push(step.name);
      continue;
    }

    checklist.changeState(i, 'inProgress');
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
      checklist.changeState(i, 'succeeded', stepSummary(step.name, accumulated));
      completed.push(step.name);
    } catch (error) {
      const elapsed = Date.now() - startTime;
      debug('step', step.name, `failed after ${elapsed}ms`, String(error));
      checklist.changeState(i, 'failed', `${stepLabel(step.name)} ✗`);

      // Mark remaining as skipped
      for (let j = i + 1; j < sorted.length; j++) {
        checklist.changeState(j, 'skipped', `${stepLabel(sorted[j].name)} (skipped)`);
      }
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
