export interface PublishWorkflowOptions {
  registry?: string;
  provenance?: boolean;
}

export function generatePublishWorkflow(pm: string, options: PublishWorkflowOptions = {}): string {
  const registry = options.registry ?? 'https://registry.npmjs.org';
  const provenance = options.provenance ?? false;

  // pnpm is not preinstalled on GitHub runners — set it up before setup-node so
  // node's cache/install steps can find it. npm and yarn ship with the runner.
  const pnpmSetup = pm === 'pnpm' ? '      - uses: pnpm/action-setup@v4\n' : '';

  const install =
    pm === 'npm'
      ? 'npm ci'
      : pm === 'pnpm'
        ? 'pnpm install --frozen-lockfile'
        : 'yarn install --frozen-lockfile';

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
      - run: ${publishCmd}
        env:
          NODE_AUTH_TOKEN: \${{ secrets.NPM_TOKEN }}
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
`;
}
