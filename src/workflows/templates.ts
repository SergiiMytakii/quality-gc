export type WorkflowPackageManager = 'npm' | 'pnpm' | 'yarn';

function workflowRuntime(packageManager: WorkflowPackageManager): {
  cache: WorkflowPackageManager;
  packageManagerSetupStep: string;
  installCommand: string;
  runCommand: (script: string) => string;
} {
  if (packageManager === 'pnpm') {
    return {
      cache: 'pnpm',
      packageManagerSetupStep: `
      - name: Setup pnpm
        uses: pnpm/action-setup@v4
        with:
          run_install: false
`,
      installCommand: 'pnpm install --frozen-lockfile',
      runCommand: script => `pnpm run ${script}`,
    };
  }
  if (packageManager === 'yarn') {
    return {
      cache: 'yarn',
      packageManagerSetupStep: `
      - name: Enable Corepack
        run: corepack enable
`,
      installCommand: 'yarn install --frozen-lockfile',
      runCommand: script => `yarn run ${script}`,
    };
  }

  return {
    cache: 'npm',
    packageManagerSetupStep: '\n',
    installCommand: 'npm ci',
    runCommand: script => `npm run ${script}`,
  };
}

export function architectureWorkflow(packageManager: WorkflowPackageManager = 'npm'): string {
  const runtime = workflowRuntime(packageManager);

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
${runtime.packageManagerSetupStep}
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: ${runtime.cache}

      - name: Install dependencies
        run: ${runtime.installCommand}

      - name: Run Quality GC architecture
        run: ${runtime.runCommand('quality:gc:architecture')}

      - name: Check architecture config coverage drift
        run: ${runtime.runCommand('quality:gc:architecture-drift')}
`;
}

export function cleanupScanWorkflow(packageManager: WorkflowPackageManager = 'npm'): string {
  const runtime = workflowRuntime(packageManager);

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
${runtime.packageManagerSetupStep}
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: ${runtime.cache}

      - name: Install dependencies
        run: ${runtime.installCommand}

      - name: Plan Cleanup Scan issues
        run: ${runtime.runCommand('quality:gc:cleanup-scan:dry-run')}

      - name: Create or update Cleanup Scan issues
        if: \${{ github.event_name == 'schedule' || (github.event_name == 'workflow_dispatch' && inputs.dry_run == false) }}
        env:
          GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}
        run: ${runtime.runCommand('quality:gc:cleanup-scan:write')} -- --repo "$GITHUB_REPOSITORY"
`;
}

export function docsContent(packageManager: WorkflowPackageManager = 'npm'): string {
  const runPrefix = packageManager === 'pnpm' ? 'pnpm run' : packageManager === 'yarn' ? 'yarn run' : 'npm run';

  return `# Quality GC

Quality GC runs deterministic repository guardrails and non-blocking cleanup scans.

Architecture runs as a blocking workflow on pull requests and pushes. Cleanup Scan runs weekly from the default branch and can also be dispatched manually. Manual dispatch defaults to dry-run; issue writes happen only on schedule or when manual dispatch sets \`dry_run=false\`.

This installation detected ${packageManager} for GitHub Actions dependency installation. Local scripts use \`${runPrefix} quality:gc\`, \`${runPrefix} quality:gc:architecture\`, \`${runPrefix} quality:gc:architecture-drift\`, and \`${runPrefix} quality:gc:cleanup-scan:dry-run\`.

Recurring checks do not use AI. Setup-agent prompts only orchestrate preview, apply, PR creation, workflow dispatch, and verification.
`;
}
