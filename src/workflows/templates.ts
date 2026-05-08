export function architectureWorkflow(): string {
  return `name: Quality GC Architecture

on:
  pull_request:
  push:
    branches:
      - main
  workflow_dispatch:

jobs:
  architecture:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    permissions:
      contents: read
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Run Quality GC architecture
        run: npm run quality:gc:architecture
`;
}

export function cleanupScanWorkflow(): string {
  return `name: Quality GC Cleanup Scan

on:
  schedule:
    - cron: '0 3 * * 1'
  workflow_dispatch:
    inputs:
      dry_run:
        description: 'Run without creating or updating GitHub Issues'
        required: true
        default: true
        type: boolean

jobs:
  cleanup-scan:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    permissions:
      contents: read
      issues: write
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Plan Cleanup Scan issues
        run: npm run quality:gc:cleanup-scan:dry-run

      - name: Create or update Cleanup Scan issues
        if: \${{ github.event_name == 'schedule' || (github.event_name == 'workflow_dispatch' && inputs.dry_run == false) }}
        env:
          GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}
        run: npm run quality:gc:cleanup-scan:write -- --repo "$GITHUB_REPOSITORY"
`;
}

export function docsContent(): string {
  return `# Quality GC

Quality GC runs deterministic repository guardrails and non-blocking cleanup scans.

Architecture runs as a blocking workflow on pull requests and pushes. Cleanup Scan runs weekly from the default branch and can also be dispatched manually. Manual dispatch defaults to dry-run; issue writes happen only on schedule or when manual dispatch sets \`dry_run=false\`.

Recurring checks do not use AI. Setup-agent prompts only orchestrate preview, apply, PR creation, workflow dispatch, and verification.
`;
}
