# awesome-publish — Documentation

- [Configuration](#configuration)
- [CLI reference](#cli-reference)
- [Versioning strategies](#versioning-strategies)
- [Monorepos](#monorepos)
- [GitHub releases](#github-releases)
- [AI release notes](#ai-release-notes)
- [Prereleases](#prereleases)
- [CI setup](#ci-setup)

## Configuration

Create `awesome-publish.config.{ts,mts,js,mjs}` at your repo root (or per
package in a monorepo). TypeScript configs are loaded at runtime — no build
step needed. Use `defineConfig` for type inference:

```typescript
import { defineConfig } from 'awesome-publish';

export default defineConfig({
  publishFiles: ['lib', 'README.md'],
  stripScripts: true,
});
```

### Options

| Option                | Type                                        | Default                                   | Description                                                                                                                                                                                                                                                                       |
| --------------------- | ------------------------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `publishFiles`        | `string[]` (required unless `publishDir`)   | —                                         | Files/globs to include in the published package (also written to `files`). In `publishDir` mode it is an optional copy filter (default `['**/*']`) and `files` is left as the built manifest declares it.                                                                         |
| `publishDir`          | `string`                                    | —                                         | Publish from a built subdirectory (e.g. `'dist'`) using its **generated** `package.json` instead of the source one. For build tools that emit a ready-to-publish dir (ng-packagr, a tsc post-build). See [Publishing from a built directory](#publishing-from-a-built-directory). |
| `stripScripts`        | `boolean \| string[]` **(required)**        | —                                         | Strip all (`true`) or specific scripts from the published `package.json`.                                                                                                                                                                                                         |
| `buildCommand`        | `string`                                    | —                                         | Command run in the repo before packing (e.g. `pnpm run build`). Needed for compiled packages, since `publishFiles` are copied as-is and scripts are stripped.                                                                                                                     |
| `packageManager`      | `'npm' \| 'yarn' \| 'pnpm'`                 | auto-detected from lockfile               | Override the detected package manager.                                                                                                                                                                                                                                            |
| `registry`            | `string`                                    | `https://registry.npmjs.org`              | Target registry.                                                                                                                                                                                                                                                                  |
| `access`              | `'public' \| 'restricted'`                  | `'public'`                                | npm access for **scoped** packages on first publish.                                                                                                                                                                                                                              |
| `provenance`          | `boolean`                                   | `false`                                   | Publish with npm provenance (requires OIDC, e.g. GitHub Actions id-token).                                                                                                                                                                                                        |
| `requireCleanGit`     | `boolean`                                   | `true`                                    | Refuse to publish with a dirty working tree (override with `--ignore-git`).                                                                                                                                                                                                       |
| `gitTag`              | `boolean \| { enabled; prefix? }`           | `{ enabled: true, prefix: '' }`           | Create and push git tags after a release.                                                                                                                                                                                                                                         |
| `changelog`           | `boolean \| { enabled; file? }`             | `{ enabled: true, file: 'CHANGELOG.md' }` | Generate a changelog file.                                                                                                                                                                                                                                                        |
| `conventionalCommits` | `boolean`                                   | `false`                                   | Auto-detect the bump type from Conventional Commit messages.                                                                                                                                                                                                                      |
| `confirmPublish`      | `boolean`                                   | `true`                                    | Prompt for confirmation before publishing (interactive mode).                                                                                                                                                                                                                     |
| `syncDependencies`    | `boolean`                                   | `false`                                   | Rewrite internal dependency ranges to the newly bumped versions.                                                                                                                                                                                                                  |
| `changesets`          | `{ enabled; enforceInPR? }`                 | `{ enabled: false }`                      | Use changeset files for version management.                                                                                                                                                                                                                                       |
| `github.releases`     | `{ enabled; mode; draft? }`                 | `{ enabled: false }`                      | Create GitHub releases; `mode` is `'per-package'` or `'combined'`.                                                                                                                                                                                                                |
| `aiProvider`          | `{ provider; model; baseUrl? }`             | —                                         | AI provider config (required when AI features are enabled).                                                                                                                                                                                                                       |
| `aiReleaseNotes`      | `boolean \| { enabled; customPromptFile? }` | `false`                                   | Generate AI release notes.                                                                                                                                                                                                                                                        |

`workspace:` protocol ranges (pnpm) are resolved to concrete versions in the
published `package.json` automatically.

## CLI reference

### Shared flags

Available on `publish`, `pack`, and `version`:

| Flag           | Description                                             |
| -------------- | ------------------------------------------------------- |
| `--ci`         | Non-interactive mode (also auto-detected via `CI` env). |
| `--dry-run`    | Run the pipeline but skip every side effect.            |
| `--filter`     | Only process matching package names (`*` wildcards).    |
| `--ignore-git` | Skip the clean-working-tree check.                      |
| `--registry`   | Override the configured registry (publish only).        |
| `--otp`        | npm 2FA one-time password (publish only).               |
| `--debug`      | Verbose debug logging.                                  |

`--debug` is accepted by every command (including `init`, `changeset`, and
`status`). `--otp` and `--registry` only affect `publish` — they are no-ops on
`pack`/`version`.

### `publish`

Runs the full pipeline: determine version → (confirm) → preflight → write
versions → changelog → (build) → build temp dir → publish → commit → tag →
GitHub release → cleanup. Preflight validates `GITHUB_TOKEN` and the git remote
before anything is published (when GitHub releases are enabled); `build` runs
`buildCommand` if configured.

| Flag           | Description                                            |
| -------------- | ------------------------------------------------------ |
| `--bump`       | `patch \| minor \| major` (when not using changesets). |
| `--tag`        | npm dist-tag (e.g. `next`, `beta`).                    |
| `--pre`        | Publish as a prerelease (e.g. `--pre beta`).           |
| `--provenance` | Publish with npm provenance (OIDC).                    |
| `--resume`     | Finish a release that failed partway (see below).      |

#### Resuming a failed release

A publish writes to three places — the npm registry, a git tag, a GitHub release
— and a crash between them leaves a version that exists in some and not others.
There is no state file to keep: those three places _are_ the state, so
awesome-publish reads them back.

Every `publish` run checks whether the version currently in `package.json` is
fully released, and warns if it isn't:

```
⚠ my-pkg@0.0.3 looks half-released (no GitHub release).
    Run `awesome-publish publish --resume` to finish it instead of starting a new version.
```

`--resume` then completes **that** version rather than bumping to a new one: it
publishes to npm only what the registry is missing, tags only what is untagged,
and creates only the release that does not exist. Changesets are ignored while
resuming — they describe the _next_ release. Works the same locally and in CI
(re-run the workflow with `--resume`); a fresh checkout is fine, since nothing
depends on the failed run's machine.

Notes:

- `--resume` refuses to run when nothing is in flight, and aborts rather than
  guessing if the registry or GitHub can't be reached.
- It skips the clean-working-tree check: a local run that died before committing
  leaves the bumped `package.json` uncommitted, and that dirty tree _is_ the
  unfinished release.
- Without `--resume`, a run whose `package.json` was bumped but never published
  computes its next version from the last version that actually shipped — so a
  retry lands on the version it was aiming at instead of skipping one.
- The build re-runs on a resume. Rebuilding is cheap insurance compared with
  publishing a tarball assembled from a half-known state.

### `pack`

Builds the publishable package(s) into tarballs without publishing. `pack` does
**not** modify your working tree — the tarball carries the bumped version, but
your `package.json`/`CHANGELOG` are left untouched (unlike `version`/`publish`).

| Flag     | Description                                          |
| -------- | ---------------------------------------------------- |
| `--bump` | Version bump type.                                   |
| `--out`  | Output directory (default `./awesome-publish-pack`). |

### `version`

Bumps versions (and changelog / tag / commit) without publishing.

| Flag     | Description        |
| -------- | ------------------ |
| `--bump` | Version bump type. |

### `changeset`

Create a changeset for changed packages.

| Flag         | Description                                                        |
| ------------ | ------------------------------------------------------------------ |
| `--branch`   | Base branch to diff against (default `main`).                      |
| `--all`      | Offer all packages instead of only git-changed ones.               |
| `--ci`       | Non-interactive: build the changeset from the flags below.         |
| `--type`     | `patch \| minor \| major` (required with `--ci`).                  |
| `--summary`  | Changeset summary (required with `--ci`).                          |
| `--packages` | Comma-separated package names (with `--ci`; default: all changed). |

### `init`

Scaffold config and optional workflows.

| Flag           | Description                                                          |
| -------------- | -------------------------------------------------------------------- |
| `--yes`        | Non-interactive: accept sensible defaults.                           |
| `--force`      | Overwrite existing files instead of skipping them.                   |
| `--files`      | `publishFiles` for `--yes` mode (default `lib`).                     |
| `--dir`        | Publish from a built subdirectory (e.g. `dist`) — sets `publishDir`. |
| `--build`      | Build command to run before packing (e.g. `"npm run build"`).        |
| `--provenance` | Enable npm provenance in the generated workflow.                     |

### `status`

Show pending changesets and what would be published. No side effects.

## Versioning strategies

The bump is resolved in this priority order:

1. **Changesets** (if `changesets.enabled`) — reads `.changeset/*.md`.
2. **`--bump`** — explicit bump type.
3. **Conventional Commits** (if `conventionalCommits`) — inferred from commits
   since the last tag: `feat!`/`BREAKING CHANGE:` → major, `feat` → minor,
   `fix` → patch. Other types (`chore`, `docs`, `style`, `test`, `ci`, `build`,
   `refactor`, `perf`) do **not** trigger a release. On a package's first
   release (no prior tag) the whole history is scanned.
4. **Interactive prompt** — asks per package (non-CI only).

In CI with none of the above, the run is a clean no-op (nothing to release).

The bump type is one of `patch`, `minor`, `major`, or `next` — valid anywhere a
bump type is accepted: `--bump`, `changeset --type`, changeset files
(`"pkg": next`), and the interactive prompts.

### The `next` bump — continuous prereleases

`next` advances the prerelease line under the `next` identifier instead of a
graduating semver bump, so a package keeps shipping prereleases (typically under
the `next` dist-tag) without ever reaching a stable version:

- `0.0.1-pre7` → `0.0.1-next.0` (switches the prerelease line)
- `0.0.1-next.0` → `0.0.1-next.1` (increments)
- `0.0.1` → `0.0.2-next.0` (stable → next patch prerelease)

`next` is the weakest bump: if a package has both a `next` and a
`patch`/`minor`/`major` bump in one release, the graduating bump wins (and the
release leaves the prerelease line). Switching an existing prerelease identifier
to `next` is semver-lower (`next` < `pre` alphabetically); that's intentional
churn, so the downgrade guard is skipped for `next` bumps. Pair it with
`--tag next` on publish to keep `latest` clean.

### Pre-1.0 (0.x) versions

For automatic bumps (changesets and conventional commits) a package on `0.x` is
treated changesets-style: a breaking change bumps the **minor** (`0.3.2` →
`0.4.0`) and a feature bumps the **patch**, so it never silently graduates to
`1.0.0`. Use an explicit `--bump major` when you deliberately want to release
`1.0.0`. A computed version that would be a downgrade aborts the run.

## Monorepos

Workspaces are auto-detected from `pnpm-workspace.yaml` or the `workspaces`
field (array or yarn's `{ packages: [...] }` object form). Packages are
published in **dependency order** (a dependency before its dependents), and
`workspace:*` / `workspace:^` / `workspace:~` ranges are rewritten to real
versions in the published manifest.

Per-package configs are supported: a package-level `awesome-publish.config.ts`
overrides the root. Compose with plain JS:

```typescript
import root from '../../awesome-publish.config.ts';
import { defineConfig } from 'awesome-publish';

export default defineConfig({ ...root, publishFiles: ['dist'] });
```

## Publishing from a built directory

Some build tools don't just compile into a subfolder — they emit a **complete,
ready-to-publish package** into `dist/`, including a freshly generated
`package.json` with resolved `exports`, `module`, and stripped dev fields.
ng-packagr does this; so does a common tsc "post-build" script. For those
packages the source `package.json` is _not_ the manifest you want to publish.

`publishDir` tells awesome-publish to pack from that built directory using its
generated manifest:

```typescript
// packages/my-lib/awesome-publish.config.ts
import { defineConfig } from 'awesome-publish';

export default defineConfig({
  publishDir: 'dist', // pack packages/my-lib/dist and its generated package.json
  stripScripts: true,
  // buildCommand lives at the workspace root and must produce dist/ first.
});
```

What changes in `publishDir` mode:

- The manifest, `README`/`LICENSE`, and `publishFiles` are resolved **inside**
  `<packageDir>/<publishDir>`, not the package root.
- `publishFiles` becomes optional (default `['**/*']`) and acts as a **copy
  filter**. The built manifest's own `files` is left untouched — the build tool
  already declared what ships.
- Version bumping and `workspace:` range resolution still apply to the built
  manifest, so `dist/package.json` publishes with the correct version and
  concrete dependency ranges.
- Package **discovery**, version detection, and dependency ordering still read
  the source `package.json` — only packing switches to the built dir.

The build must run before packing (via a root `buildCommand` or a CI build
step) so `<publishDir>/package.json` exists; otherwise the run fails fast with a
clear "publishDir not found" error rather than publishing something broken.

## GitHub releases

Set `github.releases.enabled` and a `mode`:

- `per-package` — one release per package, tagged `pkg@1.2.3` (or `v1.2.3` for
  a single-package repo).
- `combined` — one release listing all published packages, titled with the
  release date (`Release 2026-08-17 20:07`) and tagged
  `release-<short-commit-sha>`. The tag is the sha because it has to be stable
  across retries; the title is the date because a sha reads poorly, and GitHub
  shows the tag and target commit on the release page regardless.

Requires a `GITHUB_TOKEN`. Releases are only created after a successful publish,
and are pinned to the commit the release was cut from (resolved via the package's
git tag), not to whatever `HEAD` happens to be — so a `--resume` days later still
attributes the release correctly.

The combined tag is derived from that commit rather than from the time of the
run: a timestamp would make every retry produce a new tag, and therefore a
duplicate release for a release that already exists.

> **Breaking:** combined releases were previously tagged `release-<date>-<time>`.
> Existing releases keep their old tags; only new ones use the commit-derived
> form.

`draft: true` is not resumable: a draft has no tag on GitHub until it is
published, so awesome-publish cannot tell whether the draft for a version
already exists and will create a second one on a resume.

## AI release notes

Enable `aiReleaseNotes` and configure `aiProvider`:

```typescript
export default defineConfig({
  publishFiles: ['lib'],
  stripScripts: true,
  aiProvider: { provider: 'anthropic', model: 'claude-sonnet-5' },
  aiReleaseNotes: true,
});
```

For OpenAI-compatible endpoints, set `provider: 'openai-compatible'` and a
`baseUrl` (must be https, except localhost). The API key comes from
`AWESOME_PUBLISH_AI_KEY`. Provide a `customPromptFile` to override the prompt;
`{{package}}`, `{{version}}`, `{{from}}`, `{{type}}`, `{{commits}}` and
`{{changesets}}` are interpolated. Commit messages and changeset summaries are
treated as untrusted input. If an AI call fails, the release continues without
notes.

Changeset summaries drive the notes when there are any, with commits as
supporting detail — the same precedence the changelog uses.

Commit ranges start at the previous release _of the same kind_: a stable release
diffs against the last stable tag, skipping any prereleases published in between,
while a prerelease diffs against the previous prerelease. Without that, promoting
`0.0.3-next.0` to `0.0.3` would diff against the prerelease, find nothing, and
describe the release as empty.

Notes are generated before the release commit (so they summarise the release,
not the `chore: release` commit) and written as the GitHub release body in the
same request that creates it — the release is never briefly visible with a raw
commit list. Notes require `github.releases.enabled`; without a release to
attach them to, generation is skipped rather than paid for.

## Prereleases

```console
npx awesome-publish publish --pre beta
```

The next prerelease number is resolved by querying the registry (e.g.
`1.3.0-beta.0`, `1.3.0-beta.1`, …). Use `--tag next` to control the dist-tag.

## CI setup

`awesome-publish init` can generate `.github/workflows/publish.yml`. It sets up
the detected package manager (including `pnpm/action-setup` for pnpm, pinned to a
major version — adjust it to match your pnpm), installs with a frozen lockfile,
runs your `buildCommand` if configured, and then `awesome-publish publish --ci`.
Provide `NPM_TOKEN` and `GITHUB_TOKEN` as repository secrets. Enable
`--provenance` (and the generated `id-token: write` permission) for provenance
attestation.

If `github.releases` is enabled, a preflight check verifies `GITHUB_TOKEN` and
that the git remote is parseable **before** anything is published, so a
misconfiguration fails the run early rather than after packages are live on npm.
