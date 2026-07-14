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

| Option                | Type                                        | Default                                   | Description                                                                 |
| --------------------- | ------------------------------------------- | ----------------------------------------- | --------------------------------------------------------------------------- |
| `publishFiles`        | `string[]` **(required)**                   | —                                         | Files/globs to include in the published package (also written to `files`).  |
| `stripScripts`        | `boolean \| string[]` **(required)**        | —                                         | Strip all (`true`) or specific scripts from the published `package.json`.   |
| `packageManager`      | `'npm' \| 'yarn' \| 'pnpm'`                 | auto-detected from lockfile               | Override the detected package manager.                                      |
| `registry`            | `string`                                    | `https://registry.npmjs.org`              | Target registry.                                                            |
| `access`              | `'public' \| 'restricted'`                  | `'public'`                                | npm access for **scoped** packages on first publish.                        |
| `provenance`          | `boolean`                                   | `false`                                   | Publish with npm provenance (requires OIDC, e.g. GitHub Actions id-token).  |
| `requireCleanGit`     | `boolean`                                   | `true`                                    | Refuse to publish with a dirty working tree (override with `--ignore-git`). |
| `gitTag`              | `boolean \| { enabled; prefix? }`           | `{ enabled: true, prefix: '' }`           | Create and push git tags after a release.                                   |
| `changelog`           | `boolean \| { enabled; file? }`             | `{ enabled: true, file: 'CHANGELOG.md' }` | Generate a changelog file.                                                  |
| `conventionalCommits` | `boolean`                                   | `false`                                   | Auto-detect the bump type from Conventional Commit messages.                |
| `confirmPublish`      | `boolean`                                   | `true`                                    | Prompt for confirmation before publishing (interactive mode).               |
| `syncDependencies`    | `boolean`                                   | `false`                                   | Rewrite internal dependency ranges to the newly bumped versions.            |
| `changesets`          | `{ enabled; enforceInPR? }`                 | `{ enabled: false }`                      | Use changeset files for version management.                                 |
| `github.releases`     | `{ enabled; mode; draft? }`                 | `{ enabled: false }`                      | Create GitHub releases; `mode` is `'per-package'` or `'combined'`.          |
| `aiProvider`          | `{ provider; model; baseUrl? }`             | —                                         | AI provider config (required when AI features are enabled).                 |
| `aiReleaseNotes`      | `boolean \| { enabled; customPromptFile? }` | `false`                                   | Generate AI release notes.                                                  |

`workspace:` protocol ranges (pnpm) are resolved to concrete versions in the
published `package.json` automatically.

## CLI reference

### Shared flags

Available on `publish`, `pack`, and `version`:

| Flag           | Description                                             |
| -------------- | ------------------------------------------------------- |
| `--ci`         | Non-interactive mode (also auto-detected via `CI` env). |
| `--dry-run`    | Run the pipeline but skip every side effect.            |
| `--filter`     | Only process matching package names (glob supported).   |
| `--ignore-git` | Skip the clean-working-tree check.                      |
| `--registry`   | Override the configured registry.                       |
| `--otp`        | npm 2FA one-time password (interactive mode prompts).   |
| `--debug`      | Verbose debug logging.                                  |

### `publish`

Runs the full pipeline: determine version → (confirm) → write versions →
changelog → build temp dir → publish → commit → tag → GitHub release → cleanup.

| Flag           | Description                                            |
| -------------- | ------------------------------------------------------ |
| `--bump`       | `patch \| minor \| major` (when not using changesets). |
| `--tag`        | npm dist-tag (e.g. `next`, `beta`).                    |
| `--pre`        | Publish as a prerelease (e.g. `--pre beta`).           |
| `--provenance` | Publish with npm provenance (OIDC).                    |

### `pack`

Builds the publishable package(s) into tarballs without publishing.

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

| Flag           | Description                                                        |
| -------------- | ------------------------------------------------------------------ |
| `--branch`     | Base branch to diff against (default `main`).                      |
| `--ignore-git` | Offer all packages instead of only git-changed ones.               |
| `--ci`         | Non-interactive: build the changeset from the flags below.         |
| `--type`       | `patch \| minor \| major` (required with `--ci`).                  |
| `--summary`    | Changeset summary (required with `--ci`).                          |
| `--packages`   | Comma-separated package names (with `--ci`; default: all changed). |

### `init`

Scaffold config and optional workflows.

| Flag           | Description                                        |
| -------------- | -------------------------------------------------- |
| `--yes`        | Non-interactive: accept sensible defaults.         |
| `--force`      | Overwrite existing files instead of skipping them. |
| `--files`      | `publishFiles` for `--yes` mode (default `lib`).   |
| `--provenance` | Enable npm provenance in the generated workflow.   |

### `status`

Show pending changesets and what would be published. No side effects.

## Versioning strategies

The bump is resolved in this priority order:

1. **Changesets** (if `changesets.enabled`) — reads `.changeset/*.md`.
2. **`--bump`** — explicit bump type.
3. **Conventional Commits** (if `conventionalCommits`) — inferred from commits
   since the last tag; `feat!`/`BREAKING CHANGE:` → major, `feat` → minor,
   everything else → patch.
4. **Interactive prompt** — asks per package (non-CI only).

In CI with none of the above, the run is a clean no-op (nothing to release).

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

## GitHub releases

Set `github.releases.enabled` and a `mode`:

- `per-package` — one release per package, tagged `pkg@1.2.3` (or `v1.2.3` for
  a single-package repo).
- `combined` — one release listing all published packages.

Requires a `GITHUB_TOKEN`. Releases are only created after a successful publish.

## AI release notes

Enable `aiReleaseNotes` and configure `aiProvider`:

```typescript
export default defineConfig({
  publishFiles: ['lib'],
  stripScripts: true,
  aiProvider: { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
  aiReleaseNotes: true,
});
```

For OpenAI-compatible endpoints, set `provider: 'openai-compatible'` and a
`baseUrl` (must be https, except localhost). The API key comes from
`AWESOME_PUBLISH_AI_KEY`. Provide a `customPromptFile` to override the prompt;
`{{package}}`, `{{version}}`, `{{from}}`, `{{type}}`, and `{{commits}}` are
interpolated. Commit messages are treated as untrusted input. If an AI call
fails, the release continues without notes.

## Prereleases

```console
npx awesome-publish publish --pre beta
```

The next prerelease number is resolved by querying the registry (e.g.
`1.3.0-beta.0`, `1.3.0-beta.1`, …). Use `--tag next` to control the dist-tag.

## CI setup

`awesome-publish init` can generate `.github/workflows/publish.yml`. It sets up
the detected package manager (including `pnpm/action-setup` for pnpm), installs
with a frozen lockfile, and runs `awesome-publish publish --ci`. Provide
`NPM_TOKEN` and `GITHUB_TOKEN` as repository secrets. Enable `--provenance` (and
the generated `id-token: write` permission) for provenance attestation.
