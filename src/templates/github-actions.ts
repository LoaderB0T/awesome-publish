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
