# awesome-publish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a CLI tool for effortless npm package publishing with pipeline architecture, config system, monorepo support, GitHub releases, and AI release notes.

**Architecture:** Pipeline with dependency-based step ordering via topological sort. Features register steps with typed before/after constraints. Config loaded via jiti. Services injected through pipeline context.

**Tech Stack:** TypeScript (ESM), citty (CLI), awesome-logging (prompts/logging), jiti (TS config loading), vitest (tests), @anthropic-ai/sdk (AI)

**Spec:** `docs/superpowers/specs/2026-05-20-awesome-publish-design.md`

---

## Task 1: Project Scaffolding

**Files:**
- Modify: `package.json`
- Modify: `tsconfig.base.json`
- Modify: `tsconfig.json`
- Modify: `src/index.ts`
- Remove: `src/test.ts`

- [ ] **Step 1: Update package.json**

Add dependencies, bin entry, update description and exports:

```json
{
  "name": "awesome-publish",
  "version": "0.0.1",
  "description": "Effortless npm package publishing with pipeline architecture",
  "main": "./lib/index.js",
  "bin": {
    "awesome-publish": "./lib/cli/index.js"
  },
  "exports": {
    ".": {
      "import": "./lib/index.js"
    }
  },
  "type": "module",
  "files": ["lib"],
  "scripts": {
    "preinstall": "npx only-allow pnpm",
    "lint": "pnpm eslint ./src/**",
    "test": "vitest run",
    "prebuild": "pnpm rimraf lib",
    "build": "tsc -p .",
    "dev": "node --loader ts-node/esm ./src/cli/index.ts"
  }
}
```

Add dependencies:

```bash
pnpm add citty awesome-logging jiti @anthropic-ai/sdk glob
```

- [ ] **Step 2: Update tsconfig.base.json**

Change `moduleResolution` from `node` to `bundler` (needed for ESM-native packages like citty). Bump target to ES2022 for top-level await support:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "baseUrl": "./",
    "lib": ["ES2022", "ESNext"],
    "declaration": true,
    "strict": true,
    "types": ["node"],
    "sourceMap": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "strictPropertyInitialization": true,
    "moduleResolution": "bundler",
    "stripInternal": true
  }
}
```

Remove `experimentalDecorators` and `emitDecoratorMetadata` — not needed.

- [ ] **Step 3: Clean up starter files**

Delete `src/test.ts`. Create empty `src/index.ts` with the `defineConfig` export:

```ts
export { defineConfig } from './config/schema.js';
```

- [ ] **Step 4: Verify build**

Run: `pnpm build`
Expected: compiles successfully (will fail until we create the config/schema module — that's OK, just verify deps installed)

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: scaffold project with dependencies and bin entry"
```

---

## Task 2: Core Types

**Files:**
- Create: `src/types/config.ts`
- Create: `src/types/package-info.ts`
- Create: `src/types/changeset.ts`

- [ ] **Step 1: Create config types**

`src/types/config.ts`:

```ts
export interface AwesomePublishConfig {
  packageManager?: 'npm' | 'yarn' | 'pnpm';
  publishFiles: string[];
  stripScripts: boolean | string[];
  requireCleanGit?: boolean;
  changesets?: {
    enabled: boolean;
    enforceInPR?: boolean;
  };
  github?: {
    releases?: {
      enabled: boolean;
      mode: 'per-package' | 'combined';
    };
  };
  aiProvider?: {
    provider: 'anthropic' | 'openai-compatible';
    model: string;
    baseUrl?: string;
  };
  aiReleaseNotes?: boolean | {
    enabled: boolean;
    customPromptFile?: string;
  };
}

export interface ResolvedConfig {
  packageManager: 'npm' | 'yarn' | 'pnpm';
  publishFiles: string[];
  stripScripts: boolean | string[];
  requireCleanGit: boolean;
  changesets: { enabled: boolean; enforceInPR: boolean };
  github: { releases: { enabled: boolean; mode: 'per-package' | 'combined' } };
  aiProvider?: { provider: 'anthropic' | 'openai-compatible'; model: string; baseUrl?: string };
  aiReleaseNotes: { enabled: boolean; customPromptFile?: string };
}
```

- [ ] **Step 2: Create package-info type**

`src/types/package-info.ts`:

```ts
import type { ResolvedConfig } from './config.js';

export interface PackageInfo {
  name: string;
  version: string;
  dir: string;
  packageJson: Record<string, unknown>;
  config: ResolvedConfig;
}

export interface VersionBump {
  packageName: string;
  from: string;
  to: string;
  type: 'patch' | 'minor' | 'major';
}

export interface PublishResult {
  packageName: string;
  version: string;
  registry: string;
  status: 'published' | 'skipped-already-exists';
}
```

- [ ] **Step 3: Create changeset type**

`src/types/changeset.ts`:

```ts
export interface Changeset {
  id: string;
  summary: string;
  releases: {
    name: string;
    type: 'patch' | 'minor' | 'major';
  }[];
}
```

- [ ] **Step 4: Verify types compile**

Run: `pnpm build`
Expected: no type errors from the types directory

- [ ] **Step 5: Commit**

```bash
git add src/types/
git commit -m "feat: add core type definitions"
```

---

## Task 3: Pipeline Engine — Phases & Step Interface

**Files:**
- Create: `src/pipeline/phases.ts`
- Create: `src/pipeline/step.ts`
- Create: `src/pipeline/context.ts`

- [ ] **Step 1: Create typed phase registry**

`src/pipeline/phases.ts`:

```ts
export const Phases = {
  READ_CHANGESETS: 'read-changesets',
  CONSUME_CHANGESETS: 'consume-changesets',
  DETERMINE_VERSION: 'determine-version',
  AI_NOTES_GENERATE: 'ai-notes-generate',
  BUILD_TEMP_DIR: 'build-temp-dir',
  MODIFY_PACKAGE_JSON: 'modify-package-json',
  PUBLISH_NPM: 'publish-npm',
  AI_NOTES_PUBLISH: 'ai-notes-publish',
  GITHUB_RELEASE: 'github-release',
  CLEANUP: 'cleanup',
} as const;

export type Phase = (typeof Phases)[keyof typeof Phases];
```

- [ ] **Step 2: Create step interface**

`src/pipeline/step.ts`:

```ts
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
```

- [ ] **Step 3: Create context types**

`src/pipeline/context.ts`:

```ts
import type { ResolvedConfig } from '../types/config.js';
import type { PackageInfo, VersionBump, PublishResult } from '../types/package-info.js';
import type { Changeset } from '../types/changeset.js';

export interface CoreContext {
  config: ResolvedConfig;
  packages: PackageInfo[];
  mode: 'interactive' | 'ci';
  dryRun: boolean;
}

export interface ChangesetContext {
  changesets: Changeset[];
}

export interface VersionContext {
  versionBumps: Map<string, VersionBump>;
}

export interface TempDirContext {
  tempDirs: Map<string, string>;
}

export interface AiNotesContext {
  releaseNotes: Map<string, string>;
}

export interface PublishContext {
  publishResults: Map<string, PublishResult>;
}

export interface GithubReleaseContext {
  releaseIds: Map<string, number>;
}
```

- [ ] **Step 4: Verify compile**

Run: `pnpm build`
Expected: types and pipeline modules compile

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/
git commit -m "feat: add pipeline phases, step interface, and context types"
```

---

## Task 4: Pipeline Engine — Topological Sort

**Files:**
- Create: `src/pipeline/topological-sort.ts`
- Create: `test/pipeline/topological-sort.spec.ts`

- [ ] **Step 1: Write failing tests for topological sort**

`test/pipeline/topological-sort.spec.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- test/pipeline/topological-sort.spec.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement topological sort**

`src/pipeline/topological-sort.ts`:

```ts
import type { PipelineStep } from './step.js';

export function topologicalSort(steps: PipelineStep<any, any>[]): PipelineStep<any, any>[] {
  const phaseToStep = new Map<string, PipelineStep<any, any>>();
  for (const step of steps) {
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
    const remaining = steps
      .filter(s => !sorted.some(r => r.phase === s.phase))
      .map(s => s.phase);
    throw new Error(`Cycle detected in pipeline phases: ${remaining.join(' → ')}`);
  }

  return sorted;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- test/pipeline/topological-sort.spec.ts`
Expected: all 5 tests pass

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/topological-sort.ts test/pipeline/topological-sort.spec.ts
git commit -m "feat: implement pipeline topological sort with tests"
```

---

## Task 5: Pipeline Engine — Runner

**Files:**
- Create: `src/pipeline/pipeline.ts`
- Create: `test/pipeline/pipeline.spec.ts`

- [ ] **Step 1: Write failing tests for pipeline runner**

`test/pipeline/pipeline.spec.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- test/pipeline/pipeline.spec.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement pipeline runner**

`src/pipeline/pipeline.ts`:

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- test/pipeline/pipeline.spec.ts`
Expected: all 5 tests pass

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/pipeline.ts test/pipeline/pipeline.spec.ts
git commit -m "feat: implement pipeline runner with fail-fast and context merging"
```

---

## Task 6: Config — Schema, Defaults & Validation

**Files:**
- Create: `src/config/schema.ts`
- Create: `src/config/defaults.ts`
- Create: `test/config/schema.spec.ts`

- [ ] **Step 1: Write failing tests for config normalization and validation**

`test/config/schema.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { normalizeConfig, validateConfig, defineConfig } from '../../src/config/schema.js';

describe('defineConfig', () => {
  it('returns the config as-is (identity function)', () => {
    const input = { publishFiles: ['lib'], stripScripts: true };
    expect(defineConfig(input)).toBe(input);
  });
});

describe('normalizeConfig', () => {
  it('normalizes aiReleaseNotes: true to object form', () => {
    const result = normalizeConfig({
      publishFiles: ['lib'],
      stripScripts: true,
      aiReleaseNotes: true,
    }, 'pnpm');
    expect(result.aiReleaseNotes).toEqual({ enabled: true });
  });

  it('normalizes undefined aiReleaseNotes to disabled', () => {
    const result = normalizeConfig({
      publishFiles: ['lib'],
      stripScripts: true,
    }, 'pnpm');
    expect(result.aiReleaseNotes).toEqual({ enabled: false });
  });

  it('fills missing changesets with defaults', () => {
    const result = normalizeConfig({
      publishFiles: ['lib'],
      stripScripts: true,
    }, 'pnpm');
    expect(result.changesets).toEqual({ enabled: false, enforceInPR: false });
  });

  it('fills missing github with defaults', () => {
    const result = normalizeConfig({
      publishFiles: ['lib'],
      stripScripts: true,
    }, 'pnpm');
    expect(result.github).toEqual({ releases: { enabled: false, mode: 'per-package' } });
  });

  it('defaults requireCleanGit to true', () => {
    const result = normalizeConfig({
      publishFiles: ['lib'],
      stripScripts: true,
    }, 'pnpm');
    expect(result.requireCleanGit).toBe(true);
  });

  it('uses detected package manager when not specified', () => {
    const result = normalizeConfig({
      publishFiles: ['lib'],
      stripScripts: true,
    }, 'yarn');
    expect(result.packageManager).toBe('yarn');
  });

  it('config packageManager overrides detected', () => {
    const result = normalizeConfig({
      publishFiles: ['lib'],
      stripScripts: true,
      packageManager: 'npm',
    }, 'pnpm');
    expect(result.packageManager).toBe('npm');
  });
});

describe('validateConfig', () => {
  it('throws if publishFiles is empty', () => {
    expect(() => validateConfig({
      publishFiles: [],
      stripScripts: true,
    }, 'pnpm')).toThrow(/publishFiles/);
  });

  it('throws if AI feature enabled without aiProvider', () => {
    expect(() => validateConfig({
      publishFiles: ['lib'],
      stripScripts: true,
      aiReleaseNotes: true,
    }, 'pnpm')).toThrow(/aiProvider/);
  });

  it('passes when AI feature enabled with aiProvider', () => {
    expect(() => validateConfig({
      publishFiles: ['lib'],
      stripScripts: true,
      aiReleaseNotes: true,
      aiProvider: { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
    }, 'pnpm')).not.toThrow();
  });

  it('throws if github.releases.mode is invalid', () => {
    expect(() => validateConfig({
      publishFiles: ['lib'],
      stripScripts: true,
      github: { releases: { enabled: true, mode: 'invalid' as any } },
    }, 'pnpm')).toThrow(/mode/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- test/config/schema.spec.ts`
Expected: FAIL

- [ ] **Step 3: Implement defaults**

`src/config/defaults.ts`:

```ts
import type { ResolvedConfig } from '../types/config.js';

export const DEFAULT_CONFIG: Omit<ResolvedConfig, 'packageManager' | 'publishFiles' | 'stripScripts'> = {
  requireCleanGit: true,
  changesets: { enabled: false, enforceInPR: false },
  github: { releases: { enabled: false, mode: 'per-package' } },
  aiReleaseNotes: { enabled: false },
};
```

- [ ] **Step 4: Implement schema (defineConfig, normalizeConfig, validateConfig)**

`src/config/schema.ts`:

```ts
import type { AwesomePublishConfig, ResolvedConfig } from '../types/config.js';
import { DEFAULT_CONFIG } from './defaults.js';

export function defineConfig(config: AwesomePublishConfig): AwesomePublishConfig {
  return config;
}

export function normalizeConfig(
  raw: AwesomePublishConfig,
  detectedPackageManager: 'npm' | 'yarn' | 'pnpm',
): ResolvedConfig {
  const aiReleaseNotes = raw.aiReleaseNotes === true
    ? { enabled: true }
    : raw.aiReleaseNotes === false || raw.aiReleaseNotes == null
      ? { enabled: false }
      : raw.aiReleaseNotes;

  return {
    packageManager: raw.packageManager ?? detectedPackageManager,
    publishFiles: raw.publishFiles,
    stripScripts: raw.stripScripts,
    requireCleanGit: raw.requireCleanGit ?? DEFAULT_CONFIG.requireCleanGit,
    changesets: raw.changesets
      ? { enabled: raw.changesets.enabled, enforceInPR: raw.changesets.enforceInPR ?? false }
      : { ...DEFAULT_CONFIG.changesets },
    github: raw.github?.releases
      ? { releases: raw.github.releases }
      : { ...DEFAULT_CONFIG.github },
    aiProvider: raw.aiProvider,
    aiReleaseNotes,
  };
}

export function validateConfig(
  raw: AwesomePublishConfig,
  detectedPackageManager: 'npm' | 'yarn' | 'pnpm',
): ResolvedConfig {
  if (!raw.publishFiles || raw.publishFiles.length === 0) {
    throw new Error('Config error: publishFiles must be a non-empty array');
  }

  if (raw.github?.releases?.mode && !['per-package', 'combined'].includes(raw.github.releases.mode)) {
    throw new Error(`Config error: github.releases.mode must be 'per-package' or 'combined', got '${raw.github.releases.mode}'`);
  }

  const aiEnabled = raw.aiReleaseNotes === true
    || (typeof raw.aiReleaseNotes === 'object' && raw.aiReleaseNotes?.enabled);

  if (aiEnabled && !raw.aiProvider) {
    throw new Error('Config error: aiProvider must be configured when aiReleaseNotes is enabled');
  }

  return normalizeConfig(raw, detectedPackageManager);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test -- test/config/schema.spec.ts`
Expected: all tests pass

- [ ] **Step 6: Update src/index.ts export**

```ts
export { defineConfig } from './config/schema.js';
```

- [ ] **Step 7: Commit**

```bash
git add src/config/ test/config/ src/index.ts
git commit -m "feat: add config schema, defaults, validation, and defineConfig"
```

---

## Task 7: Config — Loading via jiti

**Files:**
- Create: `src/config/load-config.ts`
- Create: `test/config/load-config.spec.ts`
- Create: `test/fixtures/configs/basic/awesome-publish.config.ts`
- Create: `test/fixtures/configs/empty/`

- [ ] **Step 1: Write failing tests for config loading**

`test/fixtures/configs/basic/awesome-publish.config.ts`:

```ts
export default {
  publishFiles: ['lib'],
  stripScripts: true,
};
```

`test/config/load-config.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { loadConfigFromDir } from '../../src/config/load-config.js';

const fixturesDir = resolve(import.meta.dirname, '../fixtures/configs');

describe('loadConfigFromDir', () => {
  it('loads a TypeScript config file', async () => {
    const config = await loadConfigFromDir(resolve(fixturesDir, 'basic'));
    expect(config).toBeDefined();
    expect(config!.publishFiles).toEqual(['lib']);
  });

  it('returns undefined when no config file found', async () => {
    const config = await loadConfigFromDir(resolve(fixturesDir, 'empty'));
    expect(config).toBeUndefined();
  });
});
```

- [ ] **Step 2: Create empty fixture directory**

Create `test/fixtures/configs/empty/.gitkeep` (empty dir placeholder).

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm test -- test/config/load-config.spec.ts`
Expected: FAIL

- [ ] **Step 4: Implement config loading**

`src/config/load-config.ts`:

```ts
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createJiti } from 'jiti';
import type { AwesomePublishConfig } from '../types/config.js';

const CONFIG_NAMES = [
  'awesome-publish.config.ts',
  'awesome-publish.config.mts',
  'awesome-publish.config.js',
  'awesome-publish.config.mjs',
];

export async function loadConfigFromDir(dir: string): Promise<AwesomePublishConfig | undefined> {
  for (const name of CONFIG_NAMES) {
    const configPath = resolve(dir, name);
    if (existsSync(configPath)) {
      const jiti = createJiti(configPath, { interopDefault: true });
      const mod = await jiti.import(configPath) as { default?: AwesomePublishConfig } | AwesomePublishConfig;
      return 'default' in mod ? mod.default : mod;
    }
  }
  return undefined;
}
```

Note: check the jiti v2 API — `createJiti` is the current entry point. If the API differs, adapt accordingly. Reference jiti docs via context7 if needed.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test -- test/config/load-config.spec.ts`
Expected: all tests pass

- [ ] **Step 6: Commit**

```bash
git add src/config/load-config.ts test/config/ test/fixtures/configs/
git commit -m "feat: add config file loading via jiti"
```

---

## Task 8: Git Service

**Files:**
- Create: `src/services/git.ts`
- Create: `test/services/git.spec.ts`

- [ ] **Step 1: Write failing tests**

`test/services/git.spec.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { GitService } from '../../src/services/git.js';

function createTempGitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'awesome-publish-test-'));
  execFileSync('git', ['init'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  writeFileSync(join(dir, 'file.txt'), 'initial');
  execFileSync('git', ['add', '.'], { cwd: dir });
  execFileSync('git', ['commit', '-m', 'initial'], { cwd: dir });
  return dir;
}

describe('GitService', () => {
  let dir: string;
  let git: GitService;

  beforeEach(() => {
    dir = createTempGitRepo();
    git = new GitService(dir);
  });

  it('detects clean working tree', async () => {
    expect(await git.isWorkingTreeClean()).toBe(true);
  });

  it('detects dirty working tree', async () => {
    writeFileSync(join(dir, 'dirty.txt'), 'changes');
    expect(await git.isWorkingTreeClean()).toBe(false);
  });

  it('creates and retrieves tags', async () => {
    await git.createTag('v1.0.0');
    const tag = await git.getLatestTag();
    expect(tag).toBe('v1.0.0');
  });

  it('gets commits since tag', async () => {
    await git.createTag('v1.0.0');
    writeFileSync(join(dir, 'new.txt'), 'new');
    execFileSync('git', ['add', '.'], { cwd: dir });
    execFileSync('git', ['commit', '-m', 'second commit'], { cwd: dir });
    const commits = await git.getCommitsSinceTag('v1.0.0');
    expect(commits).toHaveLength(1);
    expect(commits[0].message).toBe('second commit');
  });

  it('returns null for getLatestTag when no tags exist', async () => {
    const tag = await git.getLatestTag();
    expect(tag).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- test/services/git.spec.ts`
Expected: FAIL

- [ ] **Step 3: Implement git service**

`src/services/git.ts`:

```ts
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface Commit {
  hash: string;
  message: string;
}

export class GitService {
  constructor(private readonly cwd: string) {}

  async isWorkingTreeClean(): Promise<boolean> {
    const { stdout } = await this.exec('git', ['status', '--porcelain']);
    return stdout.trim() === '';
  }

  async getLatestTag(prefix?: string): Promise<string | null> {
    try {
      const args = ['describe', '--tags', '--abbrev=0'];
      if (prefix) {
        args.push(`--match=${prefix}*`);
      }
      const { stdout } = await this.exec('git', args);
      return stdout.trim() || null;
    } catch {
      return null;
    }
  }

  async getCommitsSinceTag(tag: string): Promise<Commit[]> {
    const { stdout } = await this.exec('git', ['log', `${tag}..HEAD`, '--format=%H%n%s', '--no-merges']);
    if (!stdout.trim()) return [];

    const lines = stdout.trim().split('\n');
    const commits: Commit[] = [];
    for (let i = 0; i < lines.length; i += 2) {
      commits.push({ hash: lines[i], message: lines[i + 1] });
    }
    return commits;
  }

  async createTag(tag: string): Promise<void> {
    await this.exec('git', ['tag', tag]);
  }

  async getStagedFiles(): Promise<string[]> {
    const { stdout } = await this.exec('git', ['diff', '--cached', '--name-only']);
    return stdout.trim().split('\n').filter(Boolean);
  }

  private async exec(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
    return execFileAsync(cmd, args, { cwd: this.cwd });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- test/services/git.spec.ts`
Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
git add src/services/git.ts test/services/git.spec.ts
git commit -m "feat: add git service with tag, commit, and clean-tree operations"
```

---

## Task 9: Package Manager Service

**Files:**
- Create: `src/services/package-manager.ts`
- Create: `test/services/package-manager.spec.ts`

- [ ] **Step 1: Write failing tests**

`test/services/package-manager.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { detectPackageManager } from '../../src/services/package-manager.js';

describe('detectPackageManager', () => {
  it('detects pnpm from pnpm-lock.yaml', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ap-test-'));
    writeFileSync(join(dir, 'pnpm-lock.yaml'), '');
    expect(detectPackageManager(dir)).toBe('pnpm');
  });

  it('detects yarn from yarn.lock', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ap-test-'));
    writeFileSync(join(dir, 'yarn.lock'), '');
    expect(detectPackageManager(dir)).toBe('yarn');
  });

  it('detects npm from package-lock.json', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ap-test-'));
    writeFileSync(join(dir, 'package-lock.json'), '{}');
    expect(detectPackageManager(dir)).toBe('npm');
  });

  it('defaults to npm when no lockfile found', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ap-test-'));
    expect(detectPackageManager(dir)).toBe('npm');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- test/services/package-manager.spec.ts`
Expected: FAIL

- [ ] **Step 3: Implement package manager service**

`src/services/package-manager.ts`:

```ts
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type PackageManagerName = 'npm' | 'yarn' | 'pnpm';

export function detectPackageManager(dir: string): PackageManagerName {
  if (existsSync(join(dir, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(dir, 'yarn.lock'))) return 'yarn';
  if (existsSync(join(dir, 'package-lock.json'))) return 'npm';
  return 'npm';
}

export interface PackageManagerAdapter {
  publish(dir: string, tag?: string): Promise<void>;
  pack(dir: string, outDir: string): Promise<string>;
}

function buildPublishArgs(pm: PackageManagerName, dir: string, tag?: string): { cmd: string; args: string[] } {
  const args = ['publish', dir];
  if (tag) args.push('--tag', tag);
  args.push('--no-git-checks');
  return { cmd: pm, args };
}

function buildPackArgs(pm: PackageManagerName, dir: string, outDir: string): { cmd: string; args: string[] } {
  return { cmd: pm, args: ['pack', '--pack-destination', outDir], };
}

export function createAdapter(pm: PackageManagerName): PackageManagerAdapter {
  return {
    async publish(dir: string, tag?: string): Promise<void> {
      const { cmd, args } = buildPublishArgs(pm, dir, tag);
      await execFileAsync(cmd, args, { cwd: dir });
    },
    async pack(dir: string, outDir: string): Promise<string> {
      const { cmd, args } = buildPackArgs(pm, dir, outDir);
      const { stdout } = await execFileAsync(cmd, args, { cwd: dir });
      return stdout.trim();
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- test/services/package-manager.spec.ts`
Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
git add src/services/package-manager.ts test/services/package-manager.spec.ts
git commit -m "feat: add package manager detection and adapter service"
```

---

## Task 10: Workspace Service

**Files:**
- Create: `src/services/workspace.ts`
- Create: `test/services/workspace.spec.ts`
- Create: `test/fixtures/monorepo/` (fixture files)
- Create: `test/fixtures/single-package/` (fixture files)

- [ ] **Step 1: Create test fixtures**

`test/fixtures/single-package/package.json`:
```json
{ "name": "my-pkg", "version": "1.0.0" }
```

`test/fixtures/monorepo/package.json`:
```json
{ "name": "root", "version": "0.0.0", "private": true, "workspaces": ["packages/*"] }
```

`test/fixtures/monorepo/packages/pkg-a/package.json`:
```json
{ "name": "@scope/pkg-a", "version": "1.0.0" }
```

`test/fixtures/monorepo/packages/pkg-b/package.json`:
```json
{ "name": "@scope/pkg-b", "version": "2.0.0" }
```

- [ ] **Step 2: Write failing tests**

`test/services/workspace.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { resolvePackages } from '../../src/services/workspace.js';
import type { ResolvedConfig } from '../../src/types/config.js';

const fixturesDir = resolve(import.meta.dirname, '../fixtures');

const defaultConfig: ResolvedConfig = {
  packageManager: 'pnpm',
  publishFiles: ['lib'],
  stripScripts: true,
  requireCleanGit: true,
  changesets: { enabled: false, enforceInPR: false },
  github: { releases: { enabled: false, mode: 'per-package' } },
  aiReleaseNotes: { enabled: false },
};

describe('resolvePackages', () => {
  it('resolves single-package repo', async () => {
    const packages = await resolvePackages(resolve(fixturesDir, 'single-package'), defaultConfig);
    expect(packages).toHaveLength(1);
    expect(packages[0].name).toBe('my-pkg');
    expect(packages[0].version).toBe('1.0.0');
  });

  it('resolves monorepo packages from workspaces field', async () => {
    const packages = await resolvePackages(resolve(fixturesDir, 'monorepo'), defaultConfig);
    expect(packages).toHaveLength(2);
    const names = packages.map(p => p.name).sort();
    expect(names).toEqual(['@scope/pkg-a', '@scope/pkg-b']);
  });

  it('filters packages by name pattern', async () => {
    const packages = await resolvePackages(
      resolve(fixturesDir, 'monorepo'),
      defaultConfig,
      '@scope/pkg-a',
    );
    expect(packages).toHaveLength(1);
    expect(packages[0].name).toBe('@scope/pkg-a');
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm test -- test/services/workspace.spec.ts`
Expected: FAIL

- [ ] **Step 4: Implement workspace service**

`src/services/workspace.ts`:

```ts
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';
import { globSync } from 'glob';
import type { PackageInfo } from '../types/package-info.js';
import type { ResolvedConfig } from '../types/config.js';
import { loadConfigFromDir } from '../config/load-config.js';
import { validateConfig } from '../config/schema.js';
import { detectPackageManager } from './package-manager.js';

function readPackageJson(dir: string): Record<string, unknown> {
  const content = readFileSync(join(dir, 'package.json'), 'utf-8');
  return JSON.parse(content);
}

function resolveGlobPatterns(rootDir: string, patterns: string[]): string[] {
  const dirs: string[] = [];
  for (const pattern of patterns) {
    const matches = globSync(pattern, { cwd: rootDir, absolute: true });
    for (const match of matches) {
      if (existsSync(join(match, 'package.json'))) {
        dirs.push(match);
      }
    }
  }
  return dirs;
}

function matchesFilter(name: string, filter: string): boolean {
  if (filter.includes('*')) {
    const regex = new RegExp('^' + filter.replace(/\*/g, '.*') + '$');
    return regex.test(name);
  }
  return name === filter;
}

export async function resolvePackages(
  rootDir: string,
  rootConfig: ResolvedConfig,
  filter?: string,
): Promise<PackageInfo[]> {
  const rootPkg = readPackageJson(rootDir);
  const workspaces = rootPkg.workspaces as string[] | undefined;

  let packageDirs: string[];

  if (workspaces && Array.isArray(workspaces)) {
    packageDirs = resolveGlobPatterns(rootDir, workspaces);
  } else if (existsSync(join(rootDir, 'pnpm-workspace.yaml'))) {
    const yamlContent = readFileSync(join(rootDir, 'pnpm-workspace.yaml'), 'utf-8');
    const patterns = parseWorkspaceYaml(yamlContent);
    packageDirs = resolveGlobPatterns(rootDir, patterns);
  } else {
    packageDirs = [rootDir];
  }

  const packages: PackageInfo[] = [];

  for (const dir of packageDirs) {
    const pkg = readPackageJson(dir);
    const name = pkg.name as string;

    if (filter && !matchesFilter(name, filter)) continue;

    const localConfig = await loadConfigFromDir(dir);
    const config = localConfig
      ? validateConfig(localConfig, rootConfig.packageManager)
      : rootConfig;

    packages.push({
      name,
      version: pkg.version as string,
      dir,
      packageJson: pkg,
      config,
    });
  }

  return packages;
}

function parseWorkspaceYaml(content: string): string[] {
  const patterns: string[] = [];
  let inPackages = false;
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === 'packages:') {
      inPackages = true;
      continue;
    }
    if (inPackages) {
      if (trimmed.startsWith('- ')) {
        patterns.push(trimmed.slice(2).replace(/['"]/g, ''));
      } else if (trimmed && !trimmed.startsWith('#')) {
        break;
      }
    }
  }
  return patterns;
}
```

Note: Uses the `glob` package (added as dependency) for cross-Node-version compatibility.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test -- test/services/workspace.spec.ts`
Expected: all tests pass

- [ ] **Step 6: Commit**

```bash
git add src/services/workspace.ts test/services/workspace.spec.ts test/fixtures/
git commit -m "feat: add workspace service with monorepo and filter support"
```

---

## Task 11: Pipeline Steps — Determine Version

**Files:**
- Create: `src/steps/determine-version.ts`
- Create: `test/steps/determine-version.spec.ts`

- [ ] **Step 1: Write failing tests**

`test/steps/determine-version.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { determineVersionStep } from '../../src/steps/determine-version.js';
import type { CoreContext, ChangesetContext } from '../../src/pipeline/context.js';
import type { ResolvedConfig } from '../../src/types/config.js';

function makeCtx(overrides: Record<string, unknown> = {}): CoreContext & Partial<ChangesetContext> {
  return {
    config: {
      packageManager: 'pnpm',
      publishFiles: ['lib'],
      stripScripts: true,
      requireCleanGit: true,
      changesets: { enabled: false, enforceInPR: false },
      github: { releases: { enabled: false, mode: 'per-package' } },
      aiReleaseNotes: { enabled: false },
    },
    packages: [
      { name: 'pkg-a', version: '1.0.0', dir: '/tmp/a', packageJson: {}, config: {} as ResolvedConfig },
    ],
    mode: 'ci' as const,
    dryRun: false,
    ...overrides,
  } as any;
}

describe('determineVersionStep', () => {
  it('determines version from changesets', async () => {
    const ctx = makeCtx({
      changesets: [
        { id: 'abc', summary: 'feat', releases: [{ name: 'pkg-a', type: 'minor' }] },
      ],
    });
    ctx.config.changesets = { enabled: true, enforceInPR: false };

    const result = await determineVersionStep.execute(ctx as any);
    expect(result.versionBumps.get('pkg-a')).toEqual({
      packageName: 'pkg-a',
      from: '1.0.0',
      to: '1.1.0',
      type: 'minor',
    });
  });

  it('uses --bump arg in CI mode without changesets', async () => {
    const ctx = makeCtx({ cliArgs: { bump: 'patch' } });
    const result = await determineVersionStep.execute(ctx as any);
    expect(result.versionBumps.get('pkg-a')?.to).toBe('1.0.1');
  });

  it('takes highest bump when multiple changesets affect same package', async () => {
    const ctx = makeCtx({
      changesets: [
        { id: 'a', summary: 'fix', releases: [{ name: 'pkg-a', type: 'patch' }] },
        { id: 'b', summary: 'feat', releases: [{ name: 'pkg-a', type: 'minor' }] },
      ],
    });
    ctx.config.changesets = { enabled: true, enforceInPR: false };

    const result = await determineVersionStep.execute(ctx as any);
    expect(result.versionBumps.get('pkg-a')?.type).toBe('minor');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- test/steps/determine-version.spec.ts`
Expected: FAIL

- [ ] **Step 3: Implement determine-version step**

`src/steps/determine-version.ts`:

```ts
import { Phases } from '../pipeline/phases.js';
import type { PipelineStep } from '../pipeline/step.js';
import type { ChangesetContext, VersionContext } from '../pipeline/context.js';
import type { VersionBump } from '../types/package-info.js';
import type { Changeset } from '../types/changeset.js';

const BUMP_ORDER = { patch: 0, minor: 1, major: 2 } as const;

function bumpVersion(version: string, type: 'patch' | 'minor' | 'major'): string {
  const [major, minor, patch] = version.split('.').map(Number);
  switch (type) {
    case 'major': return `${major + 1}.0.0`;
    case 'minor': return `${major}.${minor + 1}.0`;
    case 'patch': return `${major}.${minor}.${patch + 1}`;
  }
}

function highestBump(a: 'patch' | 'minor' | 'major', b: 'patch' | 'minor' | 'major'): 'patch' | 'minor' | 'major' {
  return BUMP_ORDER[a] >= BUMP_ORDER[b] ? a : b;
}

export const determineVersionStep: PipelineStep<Partial<ChangesetContext> & { cliArgs?: { bump?: string } }, VersionContext> = {
  name: 'determine-version',
  phase: Phases.DETERMINE_VERSION,
  after: [Phases.READ_CHANGESETS],
  before: [Phases.BUILD_TEMP_DIR],

  shouldRun: () => true,

  async execute(ctx): Promise<VersionContext> {
    const bumps = new Map<string, VersionBump>();
    const changesets: Changeset[] | undefined = (ctx as any).changesets;

    if (ctx.config.changesets.enabled && changesets?.length) {
      const bumpTypes = new Map<string, 'patch' | 'minor' | 'major'>();

      for (const cs of changesets) {
        for (const release of cs.releases) {
          const existing = bumpTypes.get(release.name);
          bumpTypes.set(release.name, existing ? highestBump(existing, release.type) : release.type);
        }
      }

      for (const pkg of ctx.packages) {
        const type = bumpTypes.get(pkg.name);
        if (type) {
          bumps.set(pkg.name, {
            packageName: pkg.name,
            from: pkg.version,
            to: bumpVersion(pkg.version, type),
            type,
          });
        }
      }
    } else {
      const bumpType = (ctx as any).cliArgs?.bump as 'patch' | 'minor' | 'major' | undefined;
      if (ctx.mode === 'ci' && !bumpType) {
        throw new Error('CI mode requires --bump=patch|minor|major when changesets are not enabled');
      }

      if (bumpType) {
        for (const pkg of ctx.packages) {
          bumps.set(pkg.name, {
            packageName: pkg.name,
            from: pkg.version,
            to: bumpVersion(pkg.version, bumpType),
            type: bumpType,
          });
        }
      }
      // Interactive mode without bumpType: will be handled by prompting (Task 19)
    }

    return { versionBumps: bumps };
  },
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- test/steps/determine-version.spec.ts`
Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
git add src/steps/determine-version.ts test/steps/determine-version.spec.ts
git commit -m "feat: add determine-version pipeline step"
```

---

## Task 12: Pipeline Steps — Build Temp Dir

**Files:**
- Create: `src/steps/build-temp-dir.ts`
- Create: `test/steps/build-temp-dir.spec.ts`

- [ ] **Step 1: Write failing tests**

`test/steps/build-temp-dir.spec.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rmSync } from 'node:fs';
import { buildTempDirStep } from '../../src/steps/build-temp-dir.js';
import type { ResolvedConfig } from '../../src/types/config.js';

function createFakePackage(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ap-build-test-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'test', version: '1.0.0' }));
  mkdirSync(join(dir, 'lib'));
  writeFileSync(join(dir, 'lib', 'index.js'), 'export default 1;');
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src', 'index.ts'), 'export default 1;');
  writeFileSync(join(dir, 'README.md'), '# Test');
  return dir;
}

const createdDirs: string[] = [];

afterEach(() => {
  for (const d of createdDirs) {
    rmSync(d, { recursive: true, force: true });
  }
  createdDirs.length = 0;
});

describe('buildTempDirStep', () => {
  it('copies only whitelisted files to temp dir', async () => {
    const pkgDir = createFakePackage();
    const config = {
      publishFiles: ['lib', 'README.md'],
    } as ResolvedConfig;

    const ctx = {
      config,
      packages: [{ name: 'test', version: '1.0.0', dir: pkgDir, packageJson: {}, config }],
      mode: 'interactive' as const,
      dryRun: false,
    };

    const result = await buildTempDirStep.execute(ctx as any);
    const tempDir = result.tempDirs.get('test')!;
    createdDirs.push(tempDir);

    expect(existsSync(join(tempDir, 'lib', 'index.js'))).toBe(true);
    expect(existsSync(join(tempDir, 'README.md'))).toBe(true);
    expect(existsSync(join(tempDir, 'src'))).toBe(false);
    expect(existsSync(join(tempDir, 'package.json'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- test/steps/build-temp-dir.spec.ts`
Expected: FAIL

- [ ] **Step 3: Implement build-temp-dir step**

`src/steps/build-temp-dir.ts`:

```ts
import { mkdtempSync, cpSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { Phases } from '../pipeline/phases.js';
import type { PipelineStep } from '../pipeline/step.js';
import type { TempDirContext } from '../pipeline/context.js';

export const buildTempDirStep: PipelineStep<unknown, TempDirContext> = {
  name: 'build-temp-dir',
  phase: Phases.BUILD_TEMP_DIR,
  after: [Phases.DETERMINE_VERSION],
  before: [Phases.MODIFY_PACKAGE_JSON],

  shouldRun: () => true,

  async execute(ctx): Promise<TempDirContext> {
    const tempDirs = new Map<string, string>();

    for (const pkg of ctx.packages) {
      const tempDir = mkdtempSync(join(tmpdir(), `awesome-publish-${pkg.name.replace(/[/@]/g, '-')}-`));

      // Always copy package.json
      cpSync(join(pkg.dir, 'package.json'), join(tempDir, 'package.json'));

      // Copy whitelisted files/dirs
      for (const entry of pkg.config.publishFiles) {
        const src = resolve(pkg.dir, entry);
        if (!existsSync(src)) continue;
        const dest = join(tempDir, entry);
        cpSync(src, dest, { recursive: true });
      }

      tempDirs.set(pkg.name, tempDir);
    }

    return { tempDirs };
  },
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- test/steps/build-temp-dir.spec.ts`
Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
git add src/steps/build-temp-dir.ts test/steps/build-temp-dir.spec.ts
git commit -m "feat: add build-temp-dir step with file whitelisting"
```

---

## Task 13: Pipeline Steps — Modify Package JSON

**Files:**
- Create: `src/steps/modify-package-json.ts`
- Create: `test/steps/modify-package-json.spec.ts`

- [ ] **Step 1: Write failing tests**

`test/steps/modify-package-json.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { modifyPackageJsonStep } from '../../src/steps/modify-package-json.js';
import type { ResolvedConfig } from '../../src/types/config.js';

function setup(pkgJson: Record<string, unknown>, config: Partial<ResolvedConfig> = {}) {
  const tempDir = mkdtempSync(join(tmpdir(), 'ap-modify-test-'));
  writeFileSync(join(tempDir, 'package.json'), JSON.stringify(pkgJson, null, 2));

  const resolvedConfig = {
    publishFiles: ['lib'],
    stripScripts: true,
    ...config,
  } as ResolvedConfig;

  return {
    tempDir,
    ctx: {
      config: resolvedConfig,
      packages: [{ name: 'test', version: '1.0.0', dir: '/original', packageJson: pkgJson, config: resolvedConfig }],
      mode: 'interactive' as const,
      dryRun: false,
      tempDirs: new Map([['test', tempDir]]),
      versionBumps: new Map([['test', { packageName: 'test', from: '1.0.0', to: '1.1.0', type: 'minor' as const }]]),
    },
  };
}

describe('modifyPackageJsonStep', () => {
  it('strips all scripts when stripScripts is true', async () => {
    const { tempDir, ctx } = setup({
      name: 'test', version: '1.0.0',
      scripts: { build: 'tsc', test: 'vitest', preinstall: 'check' },
    });

    await modifyPackageJsonStep.execute(ctx as any);
    const result = JSON.parse(readFileSync(join(tempDir, 'package.json'), 'utf-8'));
    expect(result.scripts).toBeUndefined();
  });

  it('strips only listed scripts when stripScripts is string[]', async () => {
    const { tempDir, ctx } = setup(
      { name: 'test', version: '1.0.0', scripts: { build: 'tsc', test: 'vitest', start: 'node .' } },
      { stripScripts: ['build', 'test'] },
    );

    await modifyPackageJsonStep.execute(ctx as any);
    const result = JSON.parse(readFileSync(join(tempDir, 'package.json'), 'utf-8'));
    expect(result.scripts).toEqual({ start: 'node .' });
  });

  it('updates version from versionBumps', async () => {
    const { tempDir, ctx } = setup({ name: 'test', version: '1.0.0' });

    await modifyPackageJsonStep.execute(ctx as any);
    const result = JSON.parse(readFileSync(join(tempDir, 'package.json'), 'utf-8'));
    expect(result.version).toBe('1.1.0');
  });

  it('sets files field to publishFiles', async () => {
    const { tempDir, ctx } = setup({ name: 'test', version: '1.0.0' });

    await modifyPackageJsonStep.execute(ctx as any);
    const result = JSON.parse(readFileSync(join(tempDir, 'package.json'), 'utf-8'));
    expect(result.files).toEqual(['lib']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- test/steps/modify-package-json.spec.ts`
Expected: FAIL

- [ ] **Step 3: Implement modify-package-json step**

`src/steps/modify-package-json.ts`:

```ts
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Phases } from '../pipeline/phases.js';
import type { PipelineStep } from '../pipeline/step.js';
import type { TempDirContext, VersionContext } from '../pipeline/context.js';

export const modifyPackageJsonStep: PipelineStep<TempDirContext & VersionContext> = {
  name: 'modify-package-json',
  phase: Phases.MODIFY_PACKAGE_JSON,
  after: [Phases.BUILD_TEMP_DIR],
  before: [Phases.PUBLISH_NPM],

  shouldRun: () => true,

  async execute(ctx): Promise<void> {
    for (const pkg of ctx.packages) {
      const tempDir = ctx.tempDirs.get(pkg.name);
      if (!tempDir) continue;

      const pkgJsonPath = join(tempDir, 'package.json');
      const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));

      // Update version
      const bump = ctx.versionBumps.get(pkg.name);
      if (bump) {
        pkgJson.version = bump.to;
      }

      // Strip scripts
      if (pkg.config.stripScripts === true) {
        delete pkgJson.scripts;
      } else if (Array.isArray(pkg.config.stripScripts)) {
        if (pkgJson.scripts) {
          for (const script of pkg.config.stripScripts) {
            delete pkgJson.scripts[script];
          }
          if (Object.keys(pkgJson.scripts).length === 0) {
            delete pkgJson.scripts;
          }
        }
      }

      // Set files whitelist
      pkgJson.files = pkg.config.publishFiles;

      writeFileSync(pkgJsonPath, JSON.stringify(pkgJson, null, 2) + '\n');
    }
  },
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- test/steps/modify-package-json.spec.ts`
Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
git add src/steps/modify-package-json.ts test/steps/modify-package-json.spec.ts
git commit -m "feat: add modify-package-json step (version bump, script strip, files whitelist)"
```

---

## Task 14: Pipeline Steps — Read & Consume Changesets

**Files:**
- Create: `src/steps/read-changesets.ts`
- Create: `src/steps/consume-changesets.ts`
- Create: `test/steps/read-changesets.spec.ts`
- Create: `test/fixtures/changesets/.changeset/add-feature.md`
- Create: `test/fixtures/changesets/.changeset/fix-bug.md`

- [ ] **Step 1: Create changeset fixtures**

`test/fixtures/changesets/.changeset/config.json`:
```json
{ "$schema": "https://unpkg.com/@changesets/config@3.0.0/schema.json" }
```

`test/fixtures/changesets/.changeset/add-feature.md`:
```markdown
---
"@scope/pkg-a": minor
---

Added a new feature
```

`test/fixtures/changesets/.changeset/fix-bug.md`:
```markdown
---
"@scope/pkg-a": patch
"@scope/pkg-b": patch
---

Fixed a bug
```

- [ ] **Step 2: Write failing tests for read-changesets**

`test/steps/read-changesets.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { readChangesetsStep } from '../../src/steps/read-changesets.js';
import type { ResolvedConfig } from '../../src/types/config.js';

const fixtureDir = resolve(import.meta.dirname, '../fixtures/changesets');

describe('readChangesetsStep', () => {
  it('parses changeset files from .changeset directory', async () => {
    const ctx = {
      config: {
        changesets: { enabled: true, enforceInPR: false },
      } as ResolvedConfig,
      packages: [
        { name: '@scope/pkg-a', version: '1.0.0', dir: fixtureDir, packageJson: {}, config: {} as ResolvedConfig },
      ],
      mode: 'interactive' as const,
      dryRun: false,
      rootDir: fixtureDir,
    };

    const result = await readChangesetsStep.execute(ctx as any);
    expect(result.changesets).toHaveLength(2);

    const feature = result.changesets.find(c => c.id === 'add-feature');
    expect(feature).toBeDefined();
    expect(feature!.releases).toContainEqual({ name: '@scope/pkg-a', type: 'minor' });

    const bug = result.changesets.find(c => c.id === 'fix-bug');
    expect(bug).toBeDefined();
    expect(bug!.releases).toHaveLength(2);
  });

  it('returns empty array when no changeset files exist', async () => {
    const ctx = {
      config: { changesets: { enabled: true, enforceInPR: false } } as ResolvedConfig,
      packages: [],
      mode: 'interactive' as const,
      dryRun: false,
      rootDir: '/nonexistent',
    };

    const result = await readChangesetsStep.execute(ctx as any);
    expect(result.changesets).toEqual([]);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm test -- test/steps/read-changesets.spec.ts`
Expected: FAIL

- [ ] **Step 4: Implement read-changesets step**

`src/steps/read-changesets.ts`:

```ts
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { Phases } from '../pipeline/phases.js';
import type { PipelineStep } from '../pipeline/step.js';
import type { ChangesetContext } from '../pipeline/context.js';
import type { Changeset } from '../types/changeset.js';

function parseChangesetFile(filePath: string): Changeset | null {
  const content = readFileSync(filePath, 'utf-8');
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return null;

  const [, frontmatter, summary] = match;
  const releases: Changeset['releases'] = [];

  for (const line of frontmatter.split('\n')) {
    const lineMatch = line.match(/^"(.+)":\s*(patch|minor|major)\s*$/);
    if (lineMatch) {
      releases.push({ name: lineMatch[1], type: lineMatch[2] as 'patch' | 'minor' | 'major' });
    }
  }

  if (releases.length === 0) return null;

  return {
    id: basename(filePath, '.md'),
    summary: summary.trim(),
    releases,
  };
}

export const readChangesetsStep: PipelineStep<{ rootDir: string }, ChangesetContext> = {
  name: 'read-changesets',
  phase: Phases.READ_CHANGESETS,
  after: [],
  before: [Phases.DETERMINE_VERSION],

  shouldRun: (ctx) => ctx.config.changesets.enabled,

  async execute(ctx): Promise<ChangesetContext> {
    const changesetDir = join(ctx.rootDir, '.changeset');

    if (!existsSync(changesetDir)) {
      return { changesets: [] };
    }

    const files = readdirSync(changesetDir)
      .filter(f => f.endsWith('.md') && f !== 'README.md');

    const changesets: Changeset[] = [];
    for (const file of files) {
      const parsed = parseChangesetFile(join(changesetDir, file));
      if (parsed) changesets.push(parsed);
    }

    return { changesets };
  },
};
```

- [ ] **Step 5: Implement consume-changesets step**

`src/steps/consume-changesets.ts`:

```ts
import { unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { Phases } from '../pipeline/phases.js';
import type { PipelineStep } from '../pipeline/step.js';
import type { ChangesetContext } from '../pipeline/context.js';

export const consumeChangesetsStep: PipelineStep<ChangesetContext & { rootDir: string }> = {
  name: 'consume-changesets',
  phase: Phases.CONSUME_CHANGESETS,
  after: [Phases.DETERMINE_VERSION],
  before: [Phases.BUILD_TEMP_DIR],
  hasSideEffects: true,

  shouldRun: (ctx) => ctx.changesets?.length > 0,

  async execute(ctx): Promise<void> {
    for (const cs of ctx.changesets) {
      const filePath = join(ctx.rootDir, '.changeset', `${cs.id}.md`);
      if (existsSync(filePath)) {
        unlinkSync(filePath);
      }
    }
  },
};
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm test -- test/steps/read-changesets.spec.ts`
Expected: all tests pass

- [ ] **Step 7: Commit**

```bash
git add src/steps/read-changesets.ts src/steps/consume-changesets.ts test/steps/ test/fixtures/changesets/
git commit -m "feat: add read-changesets and consume-changesets steps"
```

---

## Task 15: Pipeline Steps — Publish NPM

**Files:**
- Create: `src/steps/publish-npm.ts`
- Create: `test/steps/publish-npm.spec.ts`

- [ ] **Step 1: Write failing test**

`test/steps/publish-npm.spec.ts`:

```ts
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
```

Note: actual publish execution calls the package manager adapter — that is tested via integration/E2E, not unit tests. The step itself is thin — it iterates packages, calls `adapter.publish()`, and collects `PublishResult`s.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- test/steps/publish-npm.spec.ts`
Expected: FAIL

- [ ] **Step 3: Implement publish-npm step**

`src/steps/publish-npm.ts`:

```ts
import { Phases } from '../pipeline/phases.js';
import type { PipelineStep } from '../pipeline/step.js';
import type { TempDirContext, VersionContext, PublishContext } from '../pipeline/context.js';
import type { PublishResult } from '../types/package-info.js';
import { createAdapter } from '../services/package-manager.js';

export const publishNpmStep: PipelineStep<TempDirContext & VersionContext, PublishContext> = {
  name: 'publish-npm',
  phase: Phases.PUBLISH_NPM,
  after: [Phases.MODIFY_PACKAGE_JSON],
  before: [Phases.GITHUB_RELEASE],
  hasSideEffects: true,

  shouldRun: () => true,

  async execute(ctx): Promise<PublishContext> {
    const adapter = createAdapter(ctx.config.packageManager);
    const results = new Map<string, PublishResult>();

    for (const pkg of ctx.packages) {
      const tempDir = ctx.tempDirs.get(pkg.name);
      if (!tempDir) continue;

      const bump = ctx.versionBumps.get(pkg.name);
      const version = bump?.to ?? pkg.version;
      const tag = (ctx as any).cliArgs?.tag as string | undefined;

      try {
        await adapter.publish(tempDir, tag);
        results.set(pkg.name, {
          packageName: pkg.name,
          version,
          registry: 'https://registry.npmjs.org',
          status: 'published',
        });
      } catch (error: any) {
        const msg = error?.message ?? String(error);
        if (msg.includes('403') || msg.includes('409') || msg.includes('previously published')) {
          results.set(pkg.name, {
            packageName: pkg.name,
            version,
            registry: 'https://registry.npmjs.org',
            status: 'skipped-already-exists',
          });
        } else {
          throw error;
        }
      }
    }

    return { publishResults: results };
  },
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- test/steps/publish-npm.spec.ts`
Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
git add src/steps/publish-npm.ts test/steps/publish-npm.spec.ts
git commit -m "feat: add publish-npm pipeline step"
```

---

## Task 16: Pipeline Steps — Cleanup

**Files:**
- Create: `src/steps/cleanup.ts`

- [ ] **Step 1: Implement cleanup step**

`src/steps/cleanup.ts`:

```ts
import { rmSync } from 'node:fs';
import { Phases } from '../pipeline/phases.js';
import type { PipelineStep } from '../pipeline/step.js';
import type { TempDirContext } from '../pipeline/context.js';

export const cleanupStep: PipelineStep<Partial<TempDirContext>> = {
  name: 'cleanup',
  phase: Phases.CLEANUP,
  after: [Phases.PUBLISH_NPM, Phases.GITHUB_RELEASE, Phases.AI_NOTES_PUBLISH],
  before: [],

  shouldRun: (ctx) => ctx.tempDirs != null && ctx.tempDirs.size > 0,

  async execute(ctx): Promise<void> {
    if (!ctx.tempDirs) return;
    for (const [, dir] of ctx.tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
  },
};
```

- [ ] **Step 2: Commit**

```bash
git add src/steps/cleanup.ts
git commit -m "feat: add cleanup step for temp directory removal"
```

---

## Task 17: GitHub Service & Release Step

**Files:**
- Create: `src/services/github.ts`
- Create: `src/steps/create-github-release.ts`
- Create: `test/services/github.spec.ts`

- [ ] **Step 1: Write failing tests for GitHub service**

`test/services/github.spec.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitHubService } from '../../src/services/github.js';

describe('GitHubService', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let service: GitHubService;

  beforeEach(() => {
    fetchMock = vi.fn();
    service = new GitHubService('owner', 'repo', 'test-token', fetchMock as any);
  });

  it('creates a release', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 123 }),
    });

    const result = await service.createRelease('v1.0.0', 'Release notes');
    expect(result.id).toBe(123);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/repos/owner/repo/releases',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-token',
        }),
      }),
    );
  });

  it('updates a release', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({}) });

    await service.updateRelease(123, 'Updated notes');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/repos/owner/repo/releases/123',
      expect.objectContaining({ method: 'PATCH' }),
    );
  });

  it('throws on non-ok response', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: async () => 'Bad credentials',
    });

    await expect(service.createRelease('v1.0.0')).rejects.toThrow(/401/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- test/services/github.spec.ts`
Expected: FAIL

- [ ] **Step 3: Implement GitHub service**

`src/services/github.ts`:

```ts
export class GitHubService {
  private readonly baseUrl: string;

  constructor(
    private readonly owner: string,
    private readonly repo: string,
    private readonly token: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {
    this.baseUrl = `https://api.github.com/repos/${owner}/${repo}`;
  }

  async createRelease(tag: string, body?: string): Promise<{ id: number }> {
    const response = await this.fetchFn(`${this.baseUrl}/releases`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        tag_name: tag,
        name: tag,
        body: body ?? '',
        draft: false,
        prerelease: false,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`GitHub API error ${response.status}: ${text}`);
    }

    return response.json() as Promise<{ id: number }>;
  }

  async updateRelease(releaseId: number, body: string): Promise<void> {
    const response = await this.fetchFn(`${this.baseUrl}/releases/${releaseId}`, {
      method: 'PATCH',
      headers: this.headers(),
      body: JSON.stringify({ body }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`GitHub API error ${response.status}: ${text}`);
    }
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }
}
```

- [ ] **Step 4: Implement create-github-release step**

`src/steps/create-github-release.ts`:

```ts
import { Phases } from '../pipeline/phases.js';
import type { PipelineStep } from '../pipeline/step.js';
import type { PublishContext, VersionContext, GithubReleaseContext } from '../pipeline/context.js';
import { GitHubService } from '../services/github.js';
import { GitService } from '../services/git.js';

export const createGithubReleaseStep: PipelineStep<PublishContext & VersionContext & { rootDir: string }, GithubReleaseContext> = {
  name: 'github-release',
  phase: Phases.GITHUB_RELEASE,
  after: [Phases.PUBLISH_NPM],
  before: [Phases.CLEANUP],
  hasSideEffects: true,

  shouldRun: (ctx) => ctx.config.github.releases.enabled,

  async execute(ctx): Promise<GithubReleaseContext> {
    const token = process.env.GITHUB_TOKEN;
    if (!token) throw new Error('GITHUB_TOKEN environment variable is required for GitHub releases');

    const { owner, repo } = await getRepoInfo(ctx.rootDir);
    const git = new GitService(ctx.rootDir);
    const github = new GitHubService(owner, repo, token);

    const releaseIds = new Map<string, number>();

    if (ctx.config.github.releases.mode === 'combined') {
      const body = buildCombinedReleaseBody(ctx);
      const tag = `release-${new Date().toISOString().slice(0, 10)}`;
      const { id } = await github.createRelease(tag, body);
      releaseIds.set('combined', id);
    } else {
      for (const pkg of ctx.packages) {
        const bump = ctx.versionBumps.get(pkg.name);
        if (!bump) continue;
        const tag = `${pkg.name}@${bump.to}`;
        const latestTag = await git.getLatestTag(pkg.name);
        const body = latestTag
          ? (await git.getCommitsSinceTag(latestTag)).map(c => `- ${c.message}`).join('\n')
          : '';
        const { id } = await github.createRelease(tag, body);
        releaseIds.set(pkg.name, id);
      }
    }

    return { releaseIds };
  },
};

function buildCombinedReleaseBody(ctx: PublishContext & VersionContext): string {
  const lines: string[] = ['## Published packages\n'];
  for (const [name, result] of ctx.publishResults) {
    const bump = ctx.versionBumps.get(name);
    if (bump) lines.push(`- **${name}**: ${bump.from} → ${bump.to}`);
  }
  return lines.join('\n');
}

async function getRepoInfo(cwd: string): Promise<{ owner: string; repo: string }> {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const exec = promisify(execFile);
  const { stdout } = await exec('git', ['remote', 'get-url', 'origin'], { cwd });
  const match = stdout.trim().match(/[:/]([^/]+)\/([^/.]+?)(?:\.git)?$/);
  if (!match) throw new Error('Could not parse GitHub owner/repo from git remote');
  return { owner: match[1], repo: match[2] };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test -- test/services/github.spec.ts`
Expected: all tests pass

- [ ] **Step 6: Commit**

```bash
git add src/services/github.ts src/steps/create-github-release.ts test/services/github.spec.ts
git commit -m "feat: add GitHub service and create-github-release step"
```

---

## Task 18: AI Provider Service & Release Notes Step

**Files:**
- Create: `src/services/ai/provider.ts`
- Create: `src/services/ai/anthropic.ts`
- Create: `src/services/ai/openai-compat.ts`
- Create: `src/services/ai/factory.ts`
- Create: `src/steps/generate-ai-notes.ts`
- Create: `test/services/ai/factory.spec.ts`

- [ ] **Step 1: Create AI provider interface**

`src/services/ai/provider.ts`:

```ts
export interface AiProvider {
  generateText(prompt: string): Promise<string>;
}
```

- [ ] **Step 2: Implement Anthropic provider**

`src/services/ai/anthropic.ts`:

```ts
import type { AiProvider } from './provider.js';

export class AnthropicProvider implements AiProvider {
  constructor(
    private readonly model: string,
    private readonly apiKey: string,
  ) {}

  async generateText(prompt: string): Promise<string> {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const client = new Anthropic({ apiKey: this.apiKey });
    const response = await client.messages.create({
      model: this.model,
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
    });
    const textBlock = response.content.find(b => b.type === 'text');
    return textBlock?.text ?? '';
  }
}
```

- [ ] **Step 3: Implement OpenAI-compatible provider**

`src/services/ai/openai-compat.ts`:

```ts
import type { AiProvider } from './provider.js';

export class OpenAiCompatProvider implements AiProvider {
  constructor(
    private readonly model: string,
    private readonly apiKey: string,
    private readonly baseUrl: string,
  ) {}

  async generateText(prompt: string): Promise<string> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`AI API error ${response.status}: ${text}`);
    }

    const data = await response.json() as { choices: { message: { content: string } }[] };
    return data.choices[0]?.message?.content ?? '';
  }
}
```

- [ ] **Step 4: Implement factory**

`src/services/ai/factory.ts`:

```ts
import type { AiProvider } from './provider.js';
import type { ResolvedConfig } from '../../types/config.js';
import { AnthropicProvider } from './anthropic.js';
import { OpenAiCompatProvider } from './openai-compat.js';

export function createAiProvider(config: ResolvedConfig): AiProvider {
  if (!config.aiProvider) {
    throw new Error('AI provider not configured');
  }

  const apiKey = process.env.AWESOME_PUBLISH_AI_KEY;
  if (!apiKey) {
    throw new Error('AWESOME_PUBLISH_AI_KEY environment variable is required');
  }

  switch (config.aiProvider.provider) {
    case 'anthropic':
      return new AnthropicProvider(config.aiProvider.model, apiKey);
    case 'openai-compatible':
      if (!config.aiProvider.baseUrl) {
        throw new Error('baseUrl is required for openai-compatible provider');
      }
      return new OpenAiCompatProvider(config.aiProvider.model, apiKey, config.aiProvider.baseUrl);
  }
}
```

- [ ] **Step 5: Implement generate-ai-notes step**

`src/steps/generate-ai-notes.ts`:

```ts
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Phases } from '../pipeline/phases.js';
import type { PipelineStep } from '../pipeline/step.js';
import type { VersionContext, AiNotesContext } from '../pipeline/context.js';
import { createAiProvider } from '../services/ai/factory.js';
import { GitService } from '../services/git.js';

export const generateAiNotesStep: PipelineStep<VersionContext & { rootDir: string }, AiNotesContext> = {
  name: 'ai-notes-generate',
  phase: Phases.AI_NOTES_GENERATE,
  after: [Phases.DETERMINE_VERSION],
  before: [Phases.PUBLISH_NPM],
  hasSideEffects: false,

  shouldRun: (ctx) => ctx.config.aiReleaseNotes.enabled,

  async execute(ctx): Promise<AiNotesContext> {
    const provider = createAiProvider(ctx.config);
    const git = new GitService(ctx.rootDir);
    const releaseNotes = new Map<string, string>();

    let customPrompt = '';
    if (ctx.config.aiReleaseNotes.customPromptFile) {
      const promptPath = resolve(ctx.rootDir, ctx.config.aiReleaseNotes.customPromptFile);
      if (existsSync(promptPath)) {
        customPrompt = readFileSync(promptPath, 'utf-8');
      }
    }

    for (const pkg of ctx.packages) {
      const bump = ctx.versionBumps.get(pkg.name);
      if (!bump) continue;

      const latestTag = await git.getLatestTag(pkg.name);
      const commits = latestTag
        ? await git.getCommitsSinceTag(latestTag)
        : [];

      const commitList = commits.map(c => `- ${c.message}`).join('\n');

      const prompt = customPrompt
        ? `${customPrompt}\n\nPackage: ${pkg.name}\nVersion: ${bump.from} → ${bump.to}\nCommits:\n${commitList}`
        : `Generate concise release notes for package "${pkg.name}" version ${bump.to} (from ${bump.from}).\n\nCommits:\n${commitList}\n\nWrite in markdown. Focus on user-facing changes. Be concise.`;

      const notes = await provider.generateText(prompt);
      releaseNotes.set(pkg.name, notes);
    }

    return { releaseNotes };
  },
};
```

- [ ] **Step 6: Write factory test**

`test/services/ai/factory.spec.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createAiProvider } from '../../../src/services/ai/factory.js';
import type { ResolvedConfig } from '../../../src/types/config.js';

describe('createAiProvider', () => {
  const origEnv = process.env.AWESOME_PUBLISH_AI_KEY;

  beforeEach(() => { process.env.AWESOME_PUBLISH_AI_KEY = 'test-key'; });
  afterEach(() => {
    if (origEnv) process.env.AWESOME_PUBLISH_AI_KEY = origEnv;
    else delete process.env.AWESOME_PUBLISH_AI_KEY;
  });

  it('creates Anthropic provider', () => {
    const config = {
      aiProvider: { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
    } as ResolvedConfig;
    const provider = createAiProvider(config);
    expect(provider).toBeDefined();
  });

  it('throws without aiProvider config', () => {
    const config = {} as ResolvedConfig;
    expect(() => createAiProvider(config)).toThrow(/not configured/);
  });

  it('throws without API key env var', () => {
    delete process.env.AWESOME_PUBLISH_AI_KEY;
    const config = {
      aiProvider: { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
    } as ResolvedConfig;
    expect(() => createAiProvider(config)).toThrow(/AWESOME_PUBLISH_AI_KEY/);
  });
});
```

- [ ] **Step 7: Run tests**

Run: `pnpm test -- test/services/ai/factory.spec.ts`
Expected: all tests pass

- [ ] **Step 8: Commit**

```bash
git add src/services/ai/ src/steps/generate-ai-notes.ts test/services/ai/
git commit -m "feat: add AI provider service and generate-ai-notes step"
```

---

## Task 19: Pipeline Steps — AI Notes Publish

**Files:**
- Create: `src/steps/ai-notes-publish.ts`

- [ ] **Step 1: Implement ai-notes-publish step**

This step runs after `github-release`, updates existing GitHub releases with AI-generated notes.

`src/steps/ai-notes-publish.ts`:

```ts
import { Phases } from '../pipeline/phases.js';
import type { PipelineStep } from '../pipeline/step.js';
import type { AiNotesContext, GithubReleaseContext } from '../pipeline/context.js';
import { GitHubService } from '../services/github.js';

export const aiNotesPublishStep: PipelineStep<AiNotesContext & GithubReleaseContext & { rootDir: string }> = {
  name: 'ai-notes-publish',
  phase: Phases.AI_NOTES_PUBLISH,
  after: [Phases.GITHUB_RELEASE],
  before: [Phases.CLEANUP],
  hasSideEffects: true,

  shouldRun: (ctx) => ctx.config.github.releases.enabled && ctx.releaseNotes?.size > 0 && ctx.releaseIds?.size > 0,

  async execute(ctx): Promise<void> {
    const token = process.env.GITHUB_TOKEN;
    if (!token) return;

    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const exec = promisify(execFile);
    const { stdout } = await exec('git', ['remote', 'get-url', 'origin'], { cwd: ctx.rootDir });
    const match = stdout.trim().match(/[:/]([^/]+)\/([^/.]+?)(?:\.git)?$/);
    if (!match) return;

    const github = new GitHubService(match[1], match[2], token);

    if (ctx.config.github.releases.mode === 'combined') {
      const releaseId = ctx.releaseIds.get('combined');
      if (!releaseId) return;
      const allNotes = Array.from(ctx.releaseNotes.entries())
        .map(([name, notes]) => `## ${name}\n\n${notes}`)
        .join('\n\n---\n\n');
      await github.updateRelease(releaseId, allNotes);
    } else {
      for (const [name, notes] of ctx.releaseNotes) {
        const releaseId = ctx.releaseIds.get(name);
        if (releaseId) {
          await github.updateRelease(releaseId, notes);
        }
      }
    }
  },
};
```

- [ ] **Step 2: Commit**

```bash
git add src/steps/ai-notes-publish.ts
git commit -m "feat: add ai-notes-publish step to update GitHub releases with AI notes"
```

---

## Task 20: Pipeline Steps — Pack Local

**Files:**
- Create: `src/steps/pack-local.ts`
- Create: `test/steps/pack-local.spec.ts`

- [ ] **Step 1: Write failing test**

`test/steps/pack-local.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { packLocalStep } from '../../src/steps/pack-local.js';
import { Phases } from '../../src/pipeline/phases.js';

describe('packLocalStep', () => {
  it('has correct phase and constraints', () => {
    expect(packLocalStep.phase).toBe(Phases.PUBLISH_NPM);
    expect(packLocalStep.hasSideEffects).toBe(true);
    expect(packLocalStep.after).toContain(Phases.MODIFY_PACKAGE_JSON);
  });
});
```

Note: `packLocalStep` reuses `Phases.PUBLISH_NPM` as its phase since it replaces publish in the pack pipeline. Alternatively, add a `PACK_LOCAL` phase — decide during implementation.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- test/steps/pack-local.spec.ts`
Expected: FAIL

- [ ] **Step 3: Implement pack-local step**

`src/steps/pack-local.ts`:

```ts
import { mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Phases } from '../pipeline/phases.js';
import type { PipelineStep } from '../pipeline/step.js';
import type { TempDirContext } from '../pipeline/context.js';
import { createAdapter } from '../services/package-manager.js';

export const packLocalStep: PipelineStep<TempDirContext & { cliArgs?: { out?: string } }> = {
  name: 'pack-local',
  phase: Phases.PUBLISH_NPM,
  after: [Phases.MODIFY_PACKAGE_JSON],
  before: [Phases.CLEANUP],
  hasSideEffects: true,

  shouldRun: () => true,

  async execute(ctx): Promise<void> {
    const outDir = resolve(ctx.cliArgs?.out ?? './awesome-publish-pack');
    if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

    const adapter = createAdapter(ctx.config.packageManager);

    for (const pkg of ctx.packages) {
      const tempDir = ctx.tempDirs.get(pkg.name);
      if (!tempDir) continue;
      const tarball = await adapter.pack(tempDir, outDir);
      console.log(`Packed: ${tarball}`);
    }
  },
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- test/steps/pack-local.spec.ts`
Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
git add src/steps/pack-local.ts test/steps/pack-local.spec.ts
git commit -m "feat: add pack-local step for local tarball creation"
```

---

## Task 21: Pipeline Steps — Write Versions to Disk

**Files:**
- Create: `src/steps/write-versions.ts`
- Create: `test/steps/write-versions.spec.ts`

The `version` and `publish` commands need to write bumped versions back to the source `package.json` files on disk (not just in temp dirs).

- [ ] **Step 1: Write failing test**

`test/steps/write-versions.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { writeVersionsStep } from '../../src/steps/write-versions.js';

describe('writeVersionsStep', () => {
  it('writes bumped version to source package.json', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ap-write-ver-'));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'test', version: '1.0.0' }, null, 2));

    const ctx = {
      config: { packageManager: 'pnpm', publishFiles: ['lib'], stripScripts: true, requireCleanGit: true, changesets: { enabled: false, enforceInPR: false }, github: { releases: { enabled: false, mode: 'per-package' } }, aiReleaseNotes: { enabled: false } },
      packages: [{ name: 'test', version: '1.0.0', dir, packageJson: { name: 'test', version: '1.0.0' }, config: {} }],
      mode: 'interactive' as const,
      dryRun: false,
      versionBumps: new Map([['test', { packageName: 'test', from: '1.0.0', to: '1.1.0', type: 'minor' as const }]]),
    };

    await writeVersionsStep.execute(ctx as any);
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8'));
    expect(pkg.version).toBe('1.1.0');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- test/steps/write-versions.spec.ts`
Expected: FAIL

- [ ] **Step 3: Implement write-versions step**

`src/steps/write-versions.ts`:

```ts
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Phases } from '../pipeline/phases.js';
import type { PipelineStep } from '../pipeline/step.js';
import type { VersionContext } from '../pipeline/context.js';

export const writeVersionsStep: PipelineStep<VersionContext> = {
  name: 'write-versions',
  phase: Phases.DETERMINE_VERSION,
  after: [Phases.CONSUME_CHANGESETS],
  before: [Phases.BUILD_TEMP_DIR],
  hasSideEffects: true,

  shouldRun: (ctx) => ctx.versionBumps?.size > 0,

  async execute(ctx): Promise<void> {
    for (const pkg of ctx.packages) {
      const bump = ctx.versionBumps.get(pkg.name);
      if (!bump) continue;

      const pkgJsonPath = join(pkg.dir, 'package.json');
      const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
      pkgJson.version = bump.to;
      writeFileSync(pkgJsonPath, JSON.stringify(pkgJson, null, 2) + '\n');
    }
  },
};
```

Note: `write-versions` shares phase `DETERMINE_VERSION` but must run after it. Since they can't share the same phase, add a `WRITE_VERSIONS` phase to `phases.ts` during implementation. The step runs after version determination and changeset consumption, before building temp dirs.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- test/steps/write-versions.spec.ts`
Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
git add src/steps/write-versions.ts test/steps/write-versions.spec.ts
git commit -m "feat: add write-versions step to update source package.json files"
```

---

## Task 22: CLI — Entry Point & Publish Command

**Files:**
- Create: `src/cli/index.ts`
- Create: `src/cli/commands/publish.ts`
- Create: `src/cli/shared-args.ts`
- Create: `src/pipeline/build-pipeline.ts`

- [ ] **Step 1: Create shared CLI args**

`src/cli/shared-args.ts`:

```ts
export const sharedArgs = {
  ci: { type: 'boolean' as const, description: 'Run in CI mode (non-interactive)' },
  'dry-run': { type: 'boolean' as const, description: 'Preview without side effects' },
  filter: { type: 'string' as const, description: 'Process specific packages only (glob on package names)' },
  'ignore-git': { type: 'boolean' as const, description: 'Skip clean git working tree check' },
};
```

- [ ] **Step 2: Create pipeline builder**

`src/pipeline/build-pipeline.ts`:

```ts
import type { ResolvedConfig } from '../types/config.js';
import type { PipelineStep } from './step.js';
import type { Feature } from './step.js';
import { determineVersionStep } from '../steps/determine-version.js';
import { writeVersionsStep } from '../steps/write-versions.js';
import { buildTempDirStep } from '../steps/build-temp-dir.js';
import { modifyPackageJsonStep } from '../steps/modify-package-json.js';
import { publishNpmStep } from '../steps/publish-npm.js';
import { packLocalStep } from '../steps/pack-local.js';
import { cleanupStep } from '../steps/cleanup.js';
import { readChangesetsStep } from '../steps/read-changesets.js';
import { consumeChangesetsStep } from '../steps/consume-changesets.js';
import { generateAiNotesStep } from '../steps/generate-ai-notes.js';
import { aiNotesPublishStep } from '../steps/ai-notes-publish.js';
import { createGithubReleaseStep } from '../steps/create-github-release.js';

export type Command = 'publish' | 'pack' | 'version';

function getCoreFeaturesForCommand(command: Command): PipelineStep<any, any>[] {
  switch (command) {
    case 'publish':
      return [determineVersionStep, writeVersionsStep, buildTempDirStep, modifyPackageJsonStep, publishNpmStep, cleanupStep];
    case 'pack':
      return [determineVersionStep, writeVersionsStep, buildTempDirStep, modifyPackageJsonStep, packLocalStep, cleanupStep];
    case 'version':
      return [determineVersionStep, writeVersionsStep, cleanupStep];
  }
}

export function buildPipeline(command: Command, config: ResolvedConfig): PipelineStep<any, any>[] {
  const steps = getCoreFeaturesForCommand(command);

  if (config.changesets.enabled) {
    steps.push(readChangesetsStep);
    if (command === 'publish' || command === 'version') {
      steps.push(consumeChangesetsStep);
    }
  }

  if (command === 'publish') {
    if (config.aiReleaseNotes.enabled) steps.push(generateAiNotesStep);
    if (config.github.releases.enabled) steps.push(createGithubReleaseStep);
    if (config.aiReleaseNotes.enabled && config.github.releases.enabled) steps.push(aiNotesPublishStep);
  }

  return steps;
}
```

- [ ] **Step 3: Create publish command**

`src/cli/commands/publish.ts`:

```ts
import { defineCommand } from 'citty';
import { sharedArgs } from '../shared-args.js';
import { loadConfigFromDir } from '../../config/load-config.js';
import { validateConfig } from '../../config/schema.js';
import { detectPackageManager } from '../../services/package-manager.js';
import { resolvePackages } from '../../services/workspace.js';
import { buildPipeline } from '../../pipeline/build-pipeline.js';
import { runPipeline } from '../../pipeline/pipeline.js';
import { GitService } from '../../services/git.js';

export const publishCommand = defineCommand({
  meta: { name: 'publish', description: 'Publish packages to npm' },
  args: {
    ...sharedArgs,
    bump: { type: 'string', description: 'Version bump type (patch|minor|major)' },
    tag: { type: 'string', description: 'npm dist-tag (e.g., next, beta)' },
  },
  async run({ args }) {
    const rootDir = process.cwd();
    const isCi = args.ci || !!process.env.CI || !!process.env.GITHUB_ACTIONS;
    const dryRun = args['dry-run'] ?? false;

    // Load and validate config
    const pm = detectPackageManager(rootDir);
    const rawConfig = await loadConfigFromDir(rootDir);
    const config = rawConfig ? validateConfig(rawConfig, pm) : validateConfig({ publishFiles: ['lib'], stripScripts: true }, pm);

    // Check git clean
    if (config.requireCleanGit && !args['ignore-git']) {
      const git = new GitService(rootDir);
      if (!await git.isWorkingTreeClean()) {
        throw new Error('Working tree is not clean. Commit or stash changes, or use --ignore-git');
      }
    }

    // Resolve packages
    const packages = await resolvePackages(rootDir, config, args.filter);
    if (packages.length === 0) {
      throw new Error('No packages found to publish');
    }

    // Build and run pipeline
    const steps = buildPipeline('publish', config);
    const ctx = {
      config,
      packages,
      mode: isCi ? 'ci' as const : 'interactive' as const,
      dryRun,
      rootDir,
      cliArgs: { bump: args.bump, tag: args.tag },
    };

    const result = await runPipeline(steps, ctx as any);

    if (result.status === 'failed') {
      console.error(`\nFailed at step: ${result.failed}`);
      if (result.error) console.error(result.error.message);
      console.log(`Completed: ${result.completed.join(', ') || 'none'}`);
      console.log(`Skipped: ${result.skipped.join(', ') || 'none'}`);
      process.exit(1);
    }

    console.log('\nPublish complete!');
  },
});
```

- [ ] **Step 4: Create CLI entry point**

`src/cli/index.ts`:

```ts
#!/usr/bin/env node
import { defineCommand, runMain } from 'citty';
import { publishCommand } from './commands/publish.js';

const main = defineCommand({
  meta: {
    name: 'awesome-publish',
    description: 'Effortless npm package publishing',
    version: '0.0.1',
  },
  subCommands: {
    publish: publishCommand,
  },
});

runMain(main);
```

- [ ] **Step 5: Verify build compiles**

Run: `pnpm build`
Expected: compiles successfully

- [ ] **Step 6: Commit**

```bash
git add src/cli/ src/pipeline/build-pipeline.ts
git commit -m "feat: add CLI entry point and publish command"
```

---

## Task 23: CLI — Pack & Version Commands

**Files:**
- Create: `src/cli/commands/pack.ts`
- Create: `src/cli/commands/version.ts`
- Modify: `src/cli/index.ts`

- [ ] **Step 1: Create pack command**

`src/cli/commands/pack.ts`:

```ts
import { defineCommand } from 'citty';
import { sharedArgs } from '../shared-args.js';
import { loadConfigFromDir } from '../../config/load-config.js';
import { validateConfig } from '../../config/schema.js';
import { detectPackageManager } from '../../services/package-manager.js';
import { resolvePackages } from '../../services/workspace.js';
import { buildPipeline } from '../../pipeline/build-pipeline.js';
import { runPipeline } from '../../pipeline/pipeline.js';

export const packCommand = defineCommand({
  meta: { name: 'pack', description: 'Pack packages locally without publishing' },
  args: {
    ...sharedArgs,
    bump: { type: 'string', description: 'Version bump type (patch|minor|major)' },
    out: { type: 'string', description: 'Output directory', default: './awesome-publish-pack' },
  },
  async run({ args }) {
    const rootDir = process.cwd();
    const isCi = args.ci || !!process.env.CI || !!process.env.GITHUB_ACTIONS;
    const pm = detectPackageManager(rootDir);
    const rawConfig = await loadConfigFromDir(rootDir);
    const config = rawConfig ? validateConfig(rawConfig, pm) : validateConfig({ publishFiles: ['lib'], stripScripts: true }, pm);
    const packages = await resolvePackages(rootDir, config, args.filter);

    const steps = buildPipeline('pack', config);
    const ctx = {
      config,
      packages,
      mode: isCi ? 'ci' as const : 'interactive' as const,
      dryRun: args['dry-run'] ?? false,
      rootDir,
      cliArgs: { bump: args.bump, out: args.out },
    };

    const result = await runPipeline(steps, ctx as any);
    if (result.status === 'failed') {
      console.error(`Pack failed at: ${result.failed}`);
      process.exit(1);
    }
    console.log(`\nPacked to: ${args.out}`);
  },
});
```

- [ ] **Step 2: Create version command**

`src/cli/commands/version.ts`:

```ts
import { defineCommand } from 'citty';
import { sharedArgs } from '../shared-args.js';
import { loadConfigFromDir } from '../../config/load-config.js';
import { validateConfig } from '../../config/schema.js';
import { detectPackageManager } from '../../services/package-manager.js';
import { resolvePackages } from '../../services/workspace.js';
import { buildPipeline } from '../../pipeline/build-pipeline.js';
import { runPipeline } from '../../pipeline/pipeline.js';

export const versionCommand = defineCommand({
  meta: { name: 'version', description: 'Bump package versions without publishing' },
  args: {
    ...sharedArgs,
    bump: { type: 'string', description: 'Version bump type (patch|minor|major)' },
  },
  async run({ args }) {
    const rootDir = process.cwd();
    const isCi = args.ci || !!process.env.CI || !!process.env.GITHUB_ACTIONS;
    const pm = detectPackageManager(rootDir);
    const rawConfig = await loadConfigFromDir(rootDir);
    const config = rawConfig ? validateConfig(rawConfig, pm) : validateConfig({ publishFiles: ['lib'], stripScripts: true }, pm);
    const packages = await resolvePackages(rootDir, config, args.filter);

    const steps = buildPipeline('version', config);
    const ctx = {
      config,
      packages,
      mode: isCi ? 'ci' as const : 'interactive' as const,
      dryRun: args['dry-run'] ?? false,
      rootDir,
      cliArgs: { bump: args.bump },
    };

    const result = await runPipeline(steps, ctx as any);
    if (result.status === 'failed') {
      console.error(`Version failed at: ${result.failed}`);
      process.exit(1);
    }
    console.log('\nVersion bump complete!');
  },
});
```

- [ ] **Step 3: Register subcommands in CLI entry**

Update `src/cli/index.ts`:

```ts
#!/usr/bin/env node
import { defineCommand, runMain } from 'citty';
import { publishCommand } from './commands/publish.js';
import { packCommand } from './commands/pack.js';
import { versionCommand } from './commands/version.js';

const main = defineCommand({
  meta: {
    name: 'awesome-publish',
    description: 'Effortless npm package publishing',
    version: '0.0.1',
  },
  subCommands: {
    publish: publishCommand,
    pack: packCommand,
    version: versionCommand,
  },
});

runMain(main);
```

- [ ] **Step 4: Verify build**

Run: `pnpm build`
Expected: compiles

- [ ] **Step 5: Commit**

```bash
git add src/cli/
git commit -m "feat: add pack and version CLI commands"
```

---

## Task 24: CLI — Init Command & Templates

**Files:**
- Create: `src/cli/commands/init.ts`
- Create: `src/templates/config-template.ts`
- Create: `src/templates/github-actions.ts`
- Create: `src/templates/changeset-check.ts`
- Modify: `src/cli/index.ts`

- [ ] **Step 1: Create config template**

`src/templates/config-template.ts`:

```ts
import type { ResolvedConfig } from '../types/config.js';

export function generateConfigFile(config: Partial<ResolvedConfig>): string {
  const lines = [
    `import { defineConfig } from 'awesome-publish';`,
    ``,
    `export default defineConfig({`,
    `  publishFiles: ${JSON.stringify(config.publishFiles ?? ['lib'])},`,
    `  stripScripts: true,`,
  ];

  if (config.packageManager) {
    lines.push(`  packageManager: '${config.packageManager}',`);
  }

  if (config.changesets?.enabled) {
    lines.push(`  changesets: {`);
    lines.push(`    enabled: true,`);
    if (config.changesets.enforceInPR) {
      lines.push(`    enforceInPR: true,`);
    }
    lines.push(`  },`);
  }

  if (config.github?.releases?.enabled) {
    lines.push(`  github: {`);
    lines.push(`    releases: {`);
    lines.push(`      enabled: true,`);
    lines.push(`      mode: '${config.github.releases.mode}',`);
    lines.push(`    },`);
    lines.push(`  },`);
  }

  if (config.aiProvider) {
    lines.push(`  aiProvider: {`);
    lines.push(`    provider: '${config.aiProvider.provider}',`);
    lines.push(`    model: '${config.aiProvider.model}',`);
    if (config.aiProvider.baseUrl) {
      lines.push(`    baseUrl: '${config.aiProvider.baseUrl}',`);
    }
    lines.push(`  },`);
    lines.push(`  aiReleaseNotes: true,`);
  }

  lines.push(`});`);
  lines.push(``);
  return lines.join('\n');
}
```

- [ ] **Step 2: Create GitHub Actions workflow template**

`src/templates/github-actions.ts`:

```ts
export function generatePublishWorkflow(pm: string): string {
  return `name: Publish
on:
  push:
    branches: [main]

jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          registry-url: https://registry.npmjs.org
      - run: ${pm} install
      - run: npx awesome-publish publish --ci
        env:
          NODE_AUTH_TOKEN: \${{ secrets.NPM_TOKEN }}
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
`;
}
```

- [ ] **Step 3: Create changeset check template**

`src/templates/changeset-check.ts`:

```ts
export function generateChangesetCheckWorkflow(): string {
  return `name: Changeset Check
on:
  pull_request:
    branches: [main]

jobs:
  changeset-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - name: Check for changeset
        run: |
          if git diff --name-only origin/main...HEAD | grep -q "^.changeset/.*\\.md$"; then
            echo "Changeset found"
          else
            echo "::error::No changeset found. Please add a changeset with: npx changeset"
            exit 1
          fi
`;
}
```

- [ ] **Step 4: Create init command**

`src/cli/commands/init.ts` — uses awesome-logging for interactive prompts. Implement the wizard flow:

```ts
import { defineCommand } from 'citty';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { generateConfigFile } from '../../templates/config-template.js';
import { generatePublishWorkflow } from '../../templates/github-actions.js';
import { generateChangesetCheckWorkflow } from '../../templates/changeset-check.js';
import { detectPackageManager } from '../../services/package-manager.js';

export const initCommand = defineCommand({
  meta: { name: 'init', description: 'Initialize awesome-publish configuration' },
  args: {},
  async run() {
    const rootDir = process.cwd();
    const pm = detectPackageManager(rootDir);

    // Import awesome-logging dynamically for prompts
    const { InteractivePrompt } = await import('awesome-logging');

    console.log('Setting up awesome-publish...\n');
    console.log(`Detected package manager: ${pm}\n`);

    // Note: awesome-logging prompt API may differ — adapt during implementation.
    // The wizard should prompt for:
    // 1. publishFiles (default: ['lib'])
    // 2. changesets enabled + enforceInPR
    // 3. GitHub releases enabled + mode
    // 4. AI release notes + provider config
    // Then write files.

    // For now, generate with sensible defaults — full interactive prompts
    // will be wired up when awesome-logging's prompt API is confirmed.

    const config: Record<string, unknown> = {
      publishFiles: ['lib'],
      packageManager: pm,
    };

    // Write config
    const configContent = generateConfigFile(config as any);
    writeFileSync(join(rootDir, 'awesome-publish.config.ts'), configContent);
    console.log('Created awesome-publish.config.ts');

    // Offer CI workflow
    const workflowDir = join(rootDir, '.github', 'workflows');
    if (!existsSync(workflowDir)) {
      mkdirSync(workflowDir, { recursive: true });
    }
    writeFileSync(join(workflowDir, 'publish.yml'), generatePublishWorkflow(pm));
    console.log('Created .github/workflows/publish.yml');

    console.log('\nDone! Edit awesome-publish.config.ts to customize.');
  },
});
```

- [ ] **Step 5: Register init in CLI entry**

Add `import { initCommand }` and `init: initCommand` to `src/cli/index.ts` subCommands.

- [ ] **Step 6: Verify build**

Run: `pnpm build`
Expected: compiles

- [ ] **Step 7: Commit**

```bash
git add src/cli/commands/init.ts src/templates/ src/cli/index.ts
git commit -m "feat: add init command with config wizard and CI templates"
```

---

## Task 25: Process Signal Handling & Final Integration

**Files:**
- Modify: `src/cli/commands/publish.ts`
- Modify: `src/pipeline/pipeline.ts`

- [ ] **Step 1: Add process signal handlers for cleanup**

Add to `src/pipeline/pipeline.ts` — track temp dirs for cleanup on SIGINT:

```ts
let activeTempDirs: string[] = [];

function registerCleanupHandler() {
  const cleanup = () => {
    for (const dir of activeTempDirs) {
      try { rmSync(dir, { recursive: true, force: true }); } catch {}
    }
  };
  process.on('SIGINT', () => { cleanup(); process.exit(130); });
  process.on('exit', cleanup);
}
```

Call `registerCleanupHandler()` at pipeline start. Update `activeTempDirs` when `TempDirContext` is merged.

- [ ] **Step 2: Run full test suite**

Run: `pnpm test`
Expected: all tests pass

- [ ] **Step 3: Verify full build**

Run: `pnpm build`
Expected: no errors

- [ ] **Step 4: Smoke test the CLI**

Run: `node lib/cli/index.js --help`
Expected: shows help with publish, pack, version, init subcommands

Run: `node lib/cli/index.js publish --dry-run`
Expected: runs in dry-run mode (may fail on config — that's fine, confirms CLI wiring works)

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/pipeline.ts
git commit -m "feat: add process signal handling for temp dir cleanup"
```

---

## Task 26: Final — Run All Tests & Verify

- [ ] **Step 1: Run full test suite**

Run: `pnpm test`
Expected: all tests pass

- [ ] **Step 2: Run linter**

Run: `pnpm lint`
Expected: no errors (fix any that appear)

- [ ] **Step 3: Run build**

Run: `pnpm build`
Expected: clean build

- [ ] **Step 4: Final commit if any fixes needed**

```bash
git add -A
git commit -m "chore: fix lint and test issues"
```
