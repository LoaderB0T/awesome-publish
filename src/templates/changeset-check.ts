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
          if git diff --name-only origin/main...HEAD | grep -q "^\\.changeset/.*\\.md$"; then
            echo "Changeset found"
          else
            echo "::error::No changeset found. Please add a changeset with: npx awesome-publish changeset"
            exit 1
          fi
`;
}
