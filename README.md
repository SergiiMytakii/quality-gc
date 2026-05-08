# quality-gc

`quality-gc` installs deterministic guardrails and cleanup scans for TypeScript/JavaScript repositories.

It is designed for npm/pnpm projects that use GitHub Actions and GitHub Issues. The package provides the deterministic engine; optional Codex and Claude Code setup-agent prompts can orchestrate installation, but recurring checks never depend on AI.

## What Problem It Solves

Long-lived codebases collect drift. That drift is especially easy to introduce when multiple humans and agents edit the same repository over time.

Common examples:

- old workflows or docs still point to retired live paths;
- architecture boundaries are documented but not enforced;
- new `any` types slowly bypass TypeScript safety;
- local runtime artifacts such as `.tmp`, `tmp`, `logs`, or credential-shaped files accidentally become tracked;
- cleanup work is noticed during review, then forgotten because it is not turned into a focused issue;
- setup scripts overwrite local files or create broad, hard-to-review changes;
- “cleanup bots” try to fix too much at once instead of creating narrow, reviewable work.

`quality-gc` splits this into two deterministic paths:

- **Blocking guardrails**: cheap checks that must pass before a change is accepted.
- **Cleanup Scan**: non-blocking drift detection that creates or updates targeted GitHub Issues.

This keeps normal development protected without turning every cleanup signal into a failed CI run.

## How It Works

The package installs:

- `.quality-gc/quality-gc.config.mjs` as the project-owned Quality GC config;
- `.quality-gc/no-new-any-baseline.json` as the accepted explicit `any` baseline;
- package scripts such as `quality:gc`, `quality:gc:architecture`, and `quality:gc:cleanup-scan:dry-run`;
- GitHub Actions workflows for architecture checks and weekly Cleanup Scan;
- optional local setup-agent skills for Codex or Claude Code.

All mutating commands default to preview mode. Existing unmanaged files are not overwritten.

When a repository has an `origin/HEAD`, apply mode refuses to write on the default branch unless `--allow-default-branch` is explicitly passed for a controlled fixture. Normal setup should happen on a branch and go through a PR.

## Quick Start

### 1. Install The Package

For npm projects:

```sh
npm install -D quality-gc
```

For pnpm workspaces:

```sh
pnpm add -D -w quality-gc
```

Do not use `npm install` inside a pnpm workspace with an existing pnpm-managed `node_modules`; npm can fail while trying to read pnpm symlinks.

### 2. Install A Setup Agent Skill

For Codex:

```sh
npx quality-gc install-skill --target codex --scope project --root . --apply
```

With pnpm:

```sh
pnpm exec quality-gc install-skill --target codex --scope project --root . --apply
```

For Claude Code:

```sh
npx quality-gc install-skill --target claude-code --scope project --root . --apply
```

With pnpm:

```sh
pnpm exec quality-gc install-skill --target claude-code --scope project --root . --apply
```

### 3. Run The Setup Agent

In Codex, call:

```text
$quality-gc-setup-agent
```

Ask it to install Quality GC for the repository:

```text
Install Quality GC production-ready for this repo. Start with preview mode and do not write files until I approve.
```

The expected flow is:

1. The agent inspects the repository.
2. The agent runs preview commands.
3. You review the plan.
4. You approve apply.
5. The agent creates a setup branch.
6. The agent applies setup, runs checks, commits, pushes, and opens a PR.
7. After merge, you approve a live Cleanup Scan issue-write proof.

## Manual Setup Without An Agent

You can run the same flow directly.

### Preview

```sh
npx quality-gc setup --root .
```

For pnpm:

```sh
pnpm exec quality-gc setup --root .
```

This prints the files and package scripts that would be created or updated. It should not write files.

### Apply On A Setup Branch

```sh
git checkout -b codex/quality-gc-setup
npx quality-gc setup --root . --apply
```

For pnpm:

```sh
git checkout -b codex/quality-gc-setup
pnpm exec quality-gc setup --root . --apply
```

### Run Local Checks

```sh
npm run quality:gc
npm run quality:gc:architecture
npm run quality:gc:cleanup-scan:dry-run
```

For pnpm:

```sh
pnpm run quality:gc
pnpm run quality:gc:architecture
pnpm run quality:gc:cleanup-scan:dry-run
```

### Commit And Open A PR

```sh
git add .
git commit -m "chore: install quality gc"
git push -u origin codex/quality-gc-setup
gh pr create --fill --draft
```

Merge the PR only after the generated checks pass and the generated files look correct.

## GitHub Issue Setup

Cleanup Scan issues use stable labels and stable body markers so later scans can update existing issues instead of creating duplicates.

Create the labels before the first live issue write:

```sh
npx quality-gc labels --repo owner/repo
npx quality-gc labels --repo owner/repo --apply
```

For pnpm:

```sh
pnpm exec quality-gc labels --repo owner/repo
pnpm exec quality-gc labels --repo owner/repo --apply
```

Minimum labels:

- `quality-gc`
- `cleanup`
- `quality-gc:candidate-rule`
- `quality-gc:tracked-artifact`
- `quality-gc:promotion`

## Live Cleanup Scan Proof

After the setup PR is merged into the default branch, dispatch the generated workflow with live writes enabled:

```sh
gh workflow run quality-gc-cleanup-scan.yml \
  --repo owner/repo \
  --ref main \
  -f dry_run=false
```

Then verify:

```sh
gh run list --repo owner/repo --workflow quality-gc-cleanup-scan.yml --limit 5
gh issue list --repo owner/repo --label quality-gc --state open
```

The issue body should include a marker like:

```html
<!-- quality-gc-cleanup:tracked-artifact-tmp-log -->
```

Scheduled Cleanup Scans use GitHub Actions `GITHUB_TOKEN` with scoped permissions. Local `gh` credentials are for setup orchestration only.

## Commands

- `quality-gc setup` previews generated config, scripts, docs, and workflows. Add `--apply` to write approved changes from a setup branch.
- `quality-gc run` runs blocking guardrails only.
- `quality-gc architecture` runs architecture boundary rules.
- `quality-gc cleanup-scan` generates non-blocking cleanup findings and issue plans.
- `quality-gc labels --repo owner/name` previews or creates the minimum Quality GC labels for setup-time issue writes.
- `quality-gc migrate` previews managed upgrades for existing installations.
- `quality-gc install-skill --target codex|claude-code` installs or previews setup-agent prompts.

## Safety Model

`quality-gc` intentionally does not:

- embed AI inside recurring checks;
- write directly to the default branch during normal setup;
- preserve discovered architecture violations as permanent allowlists;
- read or print secret file contents;
- use broad GitHub permissions;
- use local `gh` as the scheduled issue writer;
- overwrite unmanaged user files without stopping.

The setup agent may help orchestrate installation, but the installed checks remain deterministic and reviewable.
