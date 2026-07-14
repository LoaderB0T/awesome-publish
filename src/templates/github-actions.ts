export interface PublishWorkflowOptions {
  registry?: string;
  provenance?: boolean;
  /** Build command run before publish (matches config.buildCommand). */
  buildCommand?: string;
}

export function generatePublishWorkflow(pm: string, options: PublishWorkflowOptions = {}): string {
  const registry = options.registry ?? 'https://registry.npmjs.org';
  const provenance = options.provenance ?? false;

  // pnpm is not preinstalled on GitHub runners — set it up before setup-node so
  // node's cache/install steps can find it. pnpm/action-setup@v4 needs an
  // explicit version (or a package.json `packageManager` field) or it errors;
  // pin a major here and adjust to match your pnpm. npm and yarn ship with the runner.
  const pnpmSetup =
    pm === 'pnpm'
      ? '      - uses: pnpm/action-setup@v4\n        with:\n          version: 10\n'
      : '';

  const install =
    pm === 'npm'
      ? 'npm ci'
      : pm === 'pnpm'
        ? 'pnpm install --frozen-lockfile'
        : 'yarn install --frozen-lockfile';

  // Build before publish. awesome-publish copies publishFiles as-is and strips
  // lifecycle scripts, so without an explicit build step a compiled (e.g. TS)
  // package would publish stale or empty artifacts.
  const buildStep = options.buildCommand ? `      - run: ${options.buildCommand}\n` : '';

  // id-token is required for npm provenance (OIDC trusted publishing).
  const permissions = provenance
    ? '      contents: write\n      id-token: write'
    : '      contents: write';

  const publishCmd = provenance
    ? 'npx awesome-publish publish --ci --provenance'
    : 'npx awesome-publish publish --ci';

  return `name: Publish
on:
  push:
    branches: [main]

jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
${permissions}
    steps:
      - uses: actions/checkout@v4
${pnpmSetup}      - uses: actions/setup-node@v4
        with:
          node-version: 22
          registry-url: ${registry}
      - run: ${install}
${buildStep}      - run: ${publishCmd}
        env:
          NODE_AUTH_TOKEN: \${{ secrets.NPM_TOKEN }}
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
`;
}
