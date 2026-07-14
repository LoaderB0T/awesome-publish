[![npm](https://img.shields.io/npm/v/awesome-publish?color=%2300d26a&style=for-the-badge)](https://www.npmjs.com/package/awesome-publish)
[![Build Status](https://img.shields.io/github/actions/workflow/status/LoaderB0T/awesome-publish/build.yml?branch=main&style=for-the-badge)](https://github.com/LoaderB0T/awesome-publish/actions/workflows/build.yml)
[![Sonar Quality Gate](https://img.shields.io/sonar/quality_gate/LoaderB0T_awesome-publish?server=https%3A%2F%2Fsonarcloud.io&style=for-the-badge)](https://sonarcloud.io/summary/new_code?id=LoaderB0T_awesome-publish)
[![bundle size](https://img.shields.io/bundlephobia/minzip/awesome-publish?color=%23FF006F&label=Bundle%20Size&style=for-the-badge)](https://bundlephobia.com/package/awesome-publish)

# awesome-publish

Effortless npm package publishing, built as a small pipeline. One command takes
you from a version bump to a published package, git tag, and GitHub release —
for single packages and monorepos alike.

## Motivation 💥

Publishing to npm properly means juggling a lot of steps: bumping versions,
updating a changelog, building a clean package, tagging, pushing, cutting a
GitHub release. **awesome-publish** wires those steps into one configurable
pipeline so a release is a single command — locally or in CI.

## Features 🔥

✅ **Safe publishing** — packs from an isolated temp directory, so your source
tree and `package.json` are never mutated by a publish

✅ **Monorepo aware** — auto-detects pnpm / yarn / npm workspaces and publishes
packages in dependency (topological) order, resolving `workspace:` ranges to
real versions

✅ **Version how you like** — [changesets](https://github.com/changesets/changesets)-compatible
files, Conventional Commits auto-detection (incl. `BREAKING CHANGE:` footers),
or an explicit `--bump`

✅ **Changelog & GitHub releases** — generate a changelog and per-package or
combined GitHub releases

✅ **AI release notes** — optional, via Anthropic or any OpenAI-compatible
endpoint (never blocks a release if the AI call fails)

✅ **Prereleases, dist-tags, provenance** — `--pre beta`, `--tag next`, and npm
provenance (OIDC) support out of the box

✅ **Interactive & CI modes** — friendly prompts locally, fully non-interactive
in CI, with a `--dry-run` that skips every side effect

## Built With 🔧

- [TypeScript](https://www.typescriptlang.org/) (ESM)
- [citty](https://github.com/unjs/citty) for the CLI
- [jiti](https://github.com/unjs/jiti) for zero-build TypeScript config loading

## Installation 📦

```console
pnpm add -D awesome-publish
# or
npm i -D awesome-publish
# or
yarn add -D awesome-publish
```

Requires Node.js 20+ (ESM only).

## Quick start 🚀

Scaffold a config (and optionally a CI workflow) interactively:

```console
npx awesome-publish init
```

That writes an `awesome-publish.config.ts`:

```typescript
import { defineConfig } from 'awesome-publish';

export default defineConfig({
  publishFiles: ['lib', 'README.md'],
  stripScripts: true,
  changesets: { enabled: true, enforceInPR: true },
  github: { releases: { enabled: true, mode: 'per-package' } },
});
```

Then publish:

```console
npx awesome-publish publish            # interactive
npx awesome-publish publish --ci       # non-interactive (CI)
npx awesome-publish publish --dry-run  # preview, no side effects
```

## Commands

| Command     | Purpose                                                    |
| ----------- | ---------------------------------------------------------- |
| `init`      | Scaffold config + optional GitHub Actions workflows        |
| `publish`   | Run the full pipeline and publish to npm                   |
| `pack`      | Build the publishable package(s) into tarballs, no publish |
| `version`   | Bump versions (+ changelog, tag, commit), no publish       |
| `changeset` | Create a changeset for changed packages                    |
| `status`    | Show pending changesets and what would be published        |

Run any command with `--help` for its flags.

## Environment variables

| Variable                 | Used for                                                      |
| ------------------------ | ------------------------------------------------------------- |
| `NODE_AUTH_TOKEN`        | npm auth (or a project/CI `.npmrc`) when publishing           |
| `GITHUB_TOKEN`           | Creating GitHub releases                                      |
| `AWESOME_PUBLISH_AI_KEY` | AI release-notes provider key (when enabled)                  |
| `NPM_TOKEN`              | Querying a private registry for prerelease version resolution |

## Docs 📃

See [DOCS.md](https://github.com/LoaderB0T/awesome-publish/blob/main/DOCS.md)
for the full configuration reference and CLI flags.

## Contributing 🧑🏻‍💻

Contributions are welcome. Fork the repo, create a feature branch, and open a
pull request. Bug reports and feature requests via issues are appreciated too —
and a ⭐ never hurts!

## License 🔑

Distributed under the MIT License. See `LICENSE` for more information.

## Contact 📧

Janik Schumacher - [@LoaderB0T](https://twitter.com/LoaderB0T) - [linkedin](https://www.linkedin.com/in/janikschumacher/)

Project Link: [https://github.com/LoaderB0T/awesome-publish](https://github.com/LoaderB0T/awesome-publish)
