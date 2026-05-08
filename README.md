# quality-gc

`quality-gc` adds practical guardrails for JavaScript and TypeScript repositories.

It is built for teams that use humans and coding agents in the same codebase. The setup can be helped by Codex or Claude Code, but the checks themselves are deterministic: CI does not depend on AI.

## What It Helps With

Codebases drift over time. This gets worse when coding agents make lots of changes quickly.

Common problems:

- an agent imports from another module's internals because that was the fastest way to make code compile;
- new code breaks the intended architecture, for example domain or app code starts depending on persistence or infrastructure code;
- a new package, app, service, or module is added, but architecture rules are not updated;
- new `any` types slowly bypass TypeScript safety;
- old workflows or docs keep pointing to removed paths;
- local artifacts like `.tmp`, `tmp`, `logs`, or credential-shaped files accidentally get committed;
- cleanup concerns are noticed in review, but never become clear follow-up work.

`quality-gc` turns those problems into either:

- blocking guardrails that should fail CI, or
- cleanup findings that can become focused GitHub Issues.

## What Gets Installed

Setup adds:

- `.quality-gc/quality-gc.config.mjs`
- `.quality-gc/no-new-any-baseline.json`
- package scripts such as `quality:gc`, `quality:gc:architecture`, and `quality:gc:cleanup-scan:dry-run`
- GitHub Actions workflows for architecture checks and cleanup scans
- optional Codex or Claude Code setup skills

Mutating commands preview changes first. Apply mode refuses to overwrite unmanaged files and should normally run on a setup branch.

## Quick Start

### npm + Codex

```sh
QUALITY_GC_INSTALL_SKILL=codex npm install -D quality-gc --foreground-scripts
```

### npm + Claude Code

```sh
QUALITY_GC_INSTALL_SKILL=claude-code npm install -D quality-gc --foreground-scripts
```

### pnpm workspace + Codex

```sh
QUALITY_GC_INSTALL_SKILL=codex pnpm add -D -w quality-gc
```

### pnpm workspace + Claude Code

```sh
QUALITY_GC_INSTALL_SKILL=claude-code pnpm add -D -w quality-gc
```

To skip skill installation:

```sh
QUALITY_GC_INSTALL_SKILL=skip npm install -D quality-gc
```

For pnpm:

```sh
QUALITY_GC_INSTALL_SKILL=skip pnpm add -D -w quality-gc
```

## Recommended Setup With An Agent

In Codex, run:

```text
$quality-gc-setup-agent
```

Ask:

```text
Install Quality GC production-ready for this repo. Start with preview mode and do not write files until I approve.
```

The agent should:

1. inspect the repo;
2. preview the setup;
3. analyze the codebase and draft architecture boundaries;
4. show you the plan;
5. wait for approval;
6. apply changes on a setup branch;
7. run checks;
8. open a PR.

The agent should not invent architecture rules blindly. It should detect the project shape first: single package, monorepo, frontend app, backend service, fullstack app, library, CLI package, or custom layout.

## Manual Setup

Preview:

```sh
npx quality-gc setup --root .
```

Apply on a branch:

```sh
git checkout -b codex/quality-gc-setup
npx quality-gc setup --root . --apply
```

For pnpm, use:

```sh
pnpm exec quality-gc setup --root .
pnpm exec quality-gc setup --root . --apply
```

After setup, run:

```sh
npm run quality:gc
npm run quality:gc:architecture
npm run quality:gc:architecture-drift
npm run quality:gc:cleanup-scan:dry-run
```

For pnpm:

```sh
pnpm run quality:gc
pnpm run quality:gc:architecture
pnpm run quality:gc:architecture-drift
pnpm run quality:gc:cleanup-scan:dry-run
```

## Architecture Rules

Architecture rules are project-specific. The default config starts empty because `quality-gc` cannot safely guess your intended architecture without inspecting the repo.

The setup agent can generate an initial architecture config by looking at:

- package or workspace roots;
- apps, services, packages, and modules;
- public entrypoints;
- existing import direction;
- frontend/backend/shared splits;
- runtime-only and pure type/contract areas.

When new modules or packages are added, the config may need a refresh.

`quality-gc architecture-drift` checks for source roots that are not covered by the current architecture config. It is advisory by default: it warns that the config may need updating, but it does not rewrite the config automatically.

The weekly cleanup scan can also create a GitHub Issue for architecture config drift.

Technical rule format is documented in [`docs/architecture-boundaries.md`](docs/architecture-boundaries.md).

## Cleanup Scan Issues

Cleanup Scan can create or update GitHub Issues for non-blocking cleanup work.

Create labels before the first live issue write:

```sh
npx quality-gc labels --repo owner/repo
npx quality-gc labels --repo owner/repo --apply
```

For pnpm:

```sh
pnpm exec quality-gc labels --repo owner/repo
pnpm exec quality-gc labels --repo owner/repo --apply
```

Labels used by Quality GC:

- `quality-gc`
- `cleanup`
- `quality-gc:candidate-rule`
- `quality-gc:architecture-drift`
- `quality-gc:tracked-artifact`
- `quality-gc:promotion`

After the setup PR is merged, you can run the generated cleanup workflow with live issue writes enabled:

```sh
gh workflow run quality-gc-cleanup-scan.yml \
  --repo owner/repo \
  --ref main \
  -f dry_run=false
```

Scheduled cleanup scans use the GitHub Actions `GITHUB_TOKEN` with scoped permissions.

## Commands

- `quality-gc setup` previews or applies config, scripts, docs, and workflows.
- `quality-gc run` runs blocking guardrails.
- `quality-gc architecture` runs configured architecture rules.
- `quality-gc architecture-drift` checks whether architecture rules may need a refresh.
- `quality-gc cleanup-scan` finds cleanup work and plans GitHub Issue updates.
- `quality-gc labels --repo owner/repo` previews or creates labels.
- `quality-gc migrate` updates an existing installation.
- `quality-gc install-skill --target codex|claude-code` installs setup-agent skills.

## Safety

`quality-gc` intentionally does not:

- run AI inside recurring CI checks;
- auto-rewrite architecture rules in CI;
- write directly to the default branch during normal setup;
- keep permanent allowlists for discovered architecture violations;
- read or print secret file contents;
- use broad GitHub permissions;
- use local `gh` as the scheduled issue writer;
- overwrite unmanaged files without stopping.

The goal is simple: keep guardrails deterministic, keep cleanup work focused, and keep architecture decisions reviewable.
