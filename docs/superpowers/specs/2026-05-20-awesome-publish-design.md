# awesome-publish — Design Specification

A CLI tool for effortless npm package publishing with quality-of-life features: config wizards, CI mode, interactive mode, GitHub releases, AI release notes, changeset support, monorepo support, and safe publishing via temp directories.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| CLI parser | citty | ESM-native, built-in subcommands, TypeScript-first, UnJS ecosystem |
| Changeset format | @changesets/cli compatible | Zero migration for existing users |
| AI providers | Anthropic + OpenAI-compatible | Config-driven provider, both supported |
| Publish mechanism | Temp directory | Original files never touched, cleanest isolation |
| Init wizard scope | Config + CI workflow + changeset PR enforcement | Full setup in one command |
| Monorepo support | From v1, auto-detect workspaces | pnpm-workspace.yaml / package.json workspaces |
| JSR | Skipped for v1 | npm only |
| GitHub releases | Configurable per-package or combined | User chooses in config |
| Architecture | Pipeline with dependency-based step ordering | Features register steps with before/after constraints |
| Pipeline execution | Single run, steps loop over packages internally | Enables cross-package operations like combined releases |
| Error strategy | Fail fast, report state | Log succeeded/failed/skipped packages |
| TS config loading | jiti | UnJS ecosystem, zero-config, handles ESM |
| GitHub API | Plain fetch | Minimal deps, REST API is simple enough |
| Pack output | Default `./awesome-publish-pack/` with `--out` override | Simple default, flexible when needed |
| Git clean check | Configurable in config, `--ignore-git` CLI override | Default requires clean tree |

## 1. Project Structure

```
src/
├── cli/
│   ├── index.ts                  # main entry, runMain()
│   └── commands/
│       ├── init.ts               # config wizard + CI templates
│       ├── publish.ts            # interactive/CI publish pipeline
│       ├── pack.ts               # local packing (no publish)
│       └── version.ts            # version bump only
│
├── config/
│   ├── load-config.ts            # find & import via jiti
│   ├── schema.ts                 # config type definitions & validation
│   └── defaults.ts               # default values
│
├── pipeline/
│   ├── pipeline.ts               # topological sort & step runner
│   ├── context.ts                # core context type
│   ├── step.ts                   # step interface
│   └── phases.ts                 # typed phase ID registry
│
├── steps/
│   ├── resolve-packages.ts
│   ├── read-changesets.ts
│   ├── determine-version.ts
│   ├── build-temp-dir.ts
│   ├── modify-package-json.ts
│   ├── publish-npm.ts
│   ├── create-github-release.ts
│   └── generate-ai-notes.ts
│
├── services/
│   ├── git.ts
│   ├── package-manager.ts
│   ├── workspace.ts
│   ├── github.ts
│   └── ai/
│       ├── provider.ts           # AiProvider interface
│       ├── anthropic.ts
│       └── openai-compat.ts
│
├── templates/
│   ├── config-template.ts
│   ├── github-actions.ts
│   └── changeset-check.ts
│
└── types/
    ├── config.ts
    ├── package-info.ts
    └── changeset.ts
```

## 2. Configuration

### Config file

Loaded from `awesome-publish.config.{ts,mts,js,mjs}`. For each package in a monorepo, the tool searches the package directory first, then falls back to the workspace root. TS files loaded at runtime via jiti.

`defineConfig()` is an identity function exported by the library for type inference only.

### Monorepo config inheritance

No built-in `extends` mechanism. Users compose via JavaScript:

```ts
// packages/my-pkg/awesome-publish.config.ts
import rootConfig from '../../awesome-publish.config.ts';
import { defineConfig } from 'awesome-publish';

export default defineConfig({
  ...rootConfig,
  publishFiles: ['dist', 'README.md'],
});
```

### Config shape

```ts
interface AwesomePublishConfig {
  // Package manager (auto-detected from lockfile if omitted)
  packageManager?: 'npm' | 'yarn' | 'pnpm';

  // Whitelist of files/dirs to include in published package
  publishFiles: string[];

  // Strip scripts from published package.json (true = all, string[] = specific)
  stripScripts: boolean | string[];

  // Require clean git working tree before publish (default: true)
  requireCleanGit?: boolean;

  // Changeset configuration
  changesets?: {
    enabled: boolean;
    enforceInPR?: boolean;  // generate GH action for PR enforcement
  };

  // GitHub integration
  github?: {
    releases?: {
      enabled: boolean;
      mode: 'per-package' | 'combined';
    };
  };

  // AI provider configuration (shared by all AI features)
  aiProvider?: {
    provider: 'anthropic' | 'openai-compatible';
    model: string;
    baseUrl?: string;  // for openai-compatible
    // API key read from env: AWESOME_PUBLISH_AI_KEY
  };

  // AI features (each validates aiProvider is configured when enabled)
  aiReleaseNotes?: boolean | {
    enabled: boolean;
    customPromptFile?: string;  // path to custom prompt markdown
  };
  // Future: aiChangelog, aiPrDescription, etc.
}
```

### Normalization

During config loading, shorthand forms are normalized to their full object form:

- `aiReleaseNotes: true` becomes `{ enabled: true }`
- `stripScripts: true` stays as-is (handled at usage site)

Validation checks:
- If any AI feature is enabled, `aiProvider` must be present
- `publishFiles` must be non-empty
- `github.releases.mode` must be `'per-package'` or `'combined'`

## 3. Pipeline Engine

### Typed phases

Single source of truth for all phase identifiers. Compile-time checked — referencing a nonexistent phase is a type error.

```ts
// src/pipeline/phases.ts
export const Phases = {
  RESOLVE_PACKAGES: 'resolve-packages',
  READ_CHANGESETS: 'read-changesets',
  DETERMINE_VERSION: 'determine-version',
  AI_NOTES_GENERATE: 'ai-notes-generate',
  BUILD_TEMP_DIR: 'build-temp-dir',
  MODIFY_PACKAGE_JSON: 'modify-package-json',
  PUBLISH_NPM: 'publish-npm',
  AI_NOTES_PUBLISH: 'ai-notes-publish',
  GITHUB_RELEASE: 'github-release',
  CLEANUP: 'cleanup',
} as const;

export type Phase = typeof Phases[keyof typeof Phases];
```

### Step interface

Each step declares what context it reads and what it contributes. Steps declare ordering via `after`/`before` constraints on typed `Phase` values.

```ts
interface PipelineStep<TRead, TWrite> {
  name: string;
  phase: Phase;
  after: Phase[];
  before: Phase[];
  hasSideEffects?: boolean;  // skipped in dry run
  shouldRun(ctx: CoreContext & TRead): boolean | Promise<boolean>;
  execute(ctx: CoreContext & TRead): Promise<TWrite>;
}
```

### Context

Core context is always present. Each feature extends it with its own slice. Context builds up as steps execute — each step's `execute` return value is merged in.

```ts
interface CoreContext {
  config: ResolvedConfig;
  packages: PackageInfo[];
  mode: 'interactive' | 'ci';
  dryRun: boolean;
}

// Feature-specific slices
interface ChangesetContext { changesets: Changeset[]; }
interface VersionContext { versionBumps: Map<string, VersionBump>; }
interface TempDirContext { tempDirs: Map<string, string>; }
interface AiNotesContext { releaseNotes: Map<string, string>; }
interface PublishContext { publishResults: Map<string, PublishResult>; }
```

### Pipeline runner

1. Collect steps from all enabled features
2. Topological sort by `before`/`after` constraints
3. Validate no cycles (fail at startup with cycle path if detected)
4. Execute steps in order:
   - Check `shouldRun` — skip if false
   - Check `dryRun` + `hasSideEffects` — log what would happen, skip
   - Execute, merge returned context
   - On failure: stop immediately, report succeeded/failed/skipped

### Feature registration

Each feature is a module exporting its steps. Features register based on config:

```ts
function buildPipeline(config: ResolvedConfig): PipelineStep[] {
  const features = [
    resolvePackagesFeature,     // always
    determineVersionFeature,    // always
    buildTempDirFeature,        // always
    modifyPackageJsonFeature,   // always
    publishNpmFeature,          // always (for publish command)
    cleanupFeature,             // always
  ];

  if (config.changesets?.enabled) features.push(changesetsFeature);
  if (normalizeAiFeature(config.aiReleaseNotes)) features.push(aiNotesFeature);
  if (config.github?.releases?.enabled) features.push(githubReleaseFeature);

  const allSteps = features.flatMap(f => f.steps);
  return topologicalSort(allSteps);
}
```

### Multi-step features

A feature can register multiple steps at different points in the pipeline. Example — AI release notes:

- `ai-notes-generate` step: runs after `determine-version`, before `publish-npm`. In interactive mode, prompts user to review/approve generated notes.
- `ai-notes-publish` step: runs after `publish-npm`, before `cleanup`. Attaches approved notes to the GitHub release.

## 4. CLI Commands & Modes

### Commands

| Command | Purpose | Modes |
|---|---|---|
| `awesome-publish init` | Config wizard, CI templates, changeset enforcement | Interactive only |
| `awesome-publish publish` | Full publish pipeline | Interactive, CI |
| `awesome-publish pack` | Build temp dir, pack locally, no publish | Interactive, CI |
| `awesome-publish version` | Bump versions only, no publish | Interactive, CI |

### Mode detection

CI mode activates via `--ci` flag or auto-detection of CI environment variables (`CI=true`, `GITHUB_ACTIONS=true`, etc.).

In CI mode:
- No interactive prompts — all inputs via CLI args or changesets
- If changesets enabled: version bumps derived from changeset files
- If changesets disabled: `--bump=patch|minor|major` required, error if missing
- AI release notes generated without review prompt

### CLI args (publish command)

```
--ci             Run in CI mode (non-interactive)
--dry-run        Preview without side effects
--bump           Version bump type (CI, ignored if changesets enabled)
--tag            npm dist-tag (e.g., next, beta)
--filter         Publish specific packages only (glob pattern)
--ignore-git     Skip clean git working tree check
--out            Output directory for pack command
```

### Init wizard flow

1. Detect package manager from lockfile
2. Auto-detect monorepo (confirm with user)
3. Prompt: which files to publish
4. Prompt: strip scripts (default: yes)
5. Prompt: enable changesets → enforce in PRs?
6. Prompt: enable GitHub releases → per-package or combined?
7. Prompt: enable AI release notes → which provider?
8. Write `awesome-publish.config.ts`
9. Optionally write `.github/workflows/publish.yml`
10. Optionally write `.github/workflows/changeset-check.yml`

## 5. Services

### Git Service (`src/services/git.ts`)

- `getCommitsSinceTag(tag)` — commit list for changelogs
- `getLatestTag(packageName?)` — last version tag
- `createTag(tag)` — tag after version bump
- `getStagedFiles()` — for changeset PR enforcement
- `isWorkingTreeClean()` — pre-publish check

Uses `child_process.execFile` — no shell invocation, safe across platforms.

### Package Manager Service (`src/services/package-manager.ts`)

Auto-detect from lockfile: `pnpm-lock.yaml` → pnpm, `yarn.lock` → yarn, `package-lock.json` → npm. Config override takes precedence.

Uniform interface with per-PM adapters:
- `publish(dir, tag?)`
- `pack(dir, outDir)`

### Workspace Service (`src/services/workspace.ts`)

- Read `pnpm-workspace.yaml` or `package.json` workspaces field
- Resolve glob patterns to package directories
- Load each package's `package.json` + optional config file
- Single-package repos: returns array of one

### GitHub Service (`src/services/github.ts`)

- Plain `fetch` against GitHub REST API
- Create release with markdown body
- Per-package tags: `@scope/pkg@1.2.3`
- Combined tags: configurable format
- Auth via `GITHUB_TOKEN` env var

### AI Provider Service (`src/services/ai/`)

```ts
interface AiProvider {
  generateText(prompt: string): Promise<string>;
}
```

Two implementations:
- `anthropic.ts` — uses `@anthropic-ai/sdk`
- `openai-compat.ts` — plain `fetch` to configurable `baseUrl`

Factory picks provider from config. Steps call `aiProvider.generateText()` without knowing the provider.

API key from `AWESOME_PUBLISH_AI_KEY` env var.

### Config Service (`src/config/`)

- Search for `awesome-publish.config.{ts,mts,js,mjs}`
- Per-package: search package dir first, fall back to workspace root
- Load TS via jiti (runtime import, no build step)
- Validate and normalize config
- Export `defineConfig()` identity function for type inference

## 6. Error Handling

### Error categories

| Category | Example | Behavior |
|---|---|---|
| Config error | Missing `aiProvider` with AI feature enabled | Fail before pipeline starts. Clear message with fix instructions. |
| Precondition error | Dirty git tree, missing auth token | Fail early in step. Name the precondition. |
| Partial publish | Package A published, package B fails | Stop immediately. Log succeeded/failed/skipped. Preserve temp dirs. |
| Network error | Registry down, GitHub API 500 | No retry. Fail with original error. |
| User abort | Ctrl+C during prompt | Cleanup temp dirs via process signal handlers. |

### Edge cases

1. **No changesets found** (changesets enabled): Interactive prompts "publish anyway with manual bump?". CI fails with clear message.
2. **Version already published**: Detect 403/409 from registry, report "version already exists", skip package.
3. **No config found**: Use built-in defaults, warn.
4. **Circular phase dependencies**: Topo sort detects cycle, fail at startup with cycle path.
5. **Git tag already exists**: Skip tagging, warn. Don't fail publish.
6. **Temp dir cleanup on crash**: `process.on('exit')` + `process.on('SIGINT')` handlers. Best-effort cleanup.
7. **Package manager mismatch**: Config says pnpm but only yarn.lock exists. Warn, respect config.

### Error output format

```
X [publish-npm] Failed to publish @scope/b@1.2.0
  > 403 Forbidden: Cannot publish over previously published version

  Completed: @scope/a@1.2.0
  Failed:    @scope/b@1.2.0
  Skipped:   @scope/c (not reached)

  Temp dirs preserved: /tmp/awesome-publish-xyz
```

## 7. Testing Strategy

### Structure

```
test/
├── pipeline/           # topo sort, step ordering, dry run, fail-fast
├── steps/              # each step unit tested with fixture context
├── services/           # against fixture data (temp git repos, fixture dirs)
├── config/             # real config files loaded via jiti
└── fixtures/
    ├── monorepo/       # fake workspace
    ├── single-package/
    ├── changesets/     # sample .changeset files
    └── configs/        # various config shapes
```

### Approach by layer

| Layer | Strategy |
|---|---|
| Pipeline engine | Unit test with fake steps. Verify ordering, dry run skip, fail-fast. |
| Steps | Unit test. Inject services via context. Assert context output from fixtures. |
| Services | Unit test against fixtures. Git service uses temp repos. Workspace uses fixture dirs. |
| GitHub / AI | Mock `fetch` at network boundary. Verify request shape, handle errors. |
| Config loading | Integration test with real config files in fixtures, loaded via jiti. |
| CLI commands | Minimal — verify arg parsing and pipeline assembly. |

### Principles

- Services injected via context, not global imports — no mocking framework needed
- No E2E publish tests — dry run covers full pipeline without side effects
- vitest as test runner

## 8. Dependencies

| Package | Purpose |
|---|---|
| citty | CLI framework, subcommands, arg parsing |
| awesome-logging | Logging, interactive prompts, spinners |
| jiti | Runtime TS/ESM config loading |
| @anthropic-ai/sdk | Anthropic AI provider |
| vitest | Test runner (devDependency) |

All other functionality (git, GitHub API, npm publish) uses Node.js built-ins (`child_process`, `fetch`, `fs`).

## 9. Platform Support

- Windows, macOS, Linux
- Node.js (ESM only, `"type": "module"`)
- npm, yarn, pnpm as package managers
- npm registry only (JSR deferred)
