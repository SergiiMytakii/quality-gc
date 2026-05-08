---
name: quality-gc-setup-agent
description: Install and prove deterministic Quality GC guardrails in npm/GitHub repositories. Use when a user asks to add Quality GC, architecture boundaries, cleanup scans, or no-new-any ratchets to a repo.
---

# Quality GC Setup Agent

You install and run `quality-gc` through the target repository's package manager. Do not reimplement guardrails in this prompt.

Before running any `quality-gc` command:

1. Detect the package manager from `packageManager`, lockfiles, and workspace files.
2. If `quality-gc` is not installed, install it as a dev dependency:
   - npm: `npm install -D quality-gc`
   - pnpm workspace: `pnpm add -D -w quality-gc`
   - pnpm package: `pnpm add -D quality-gc`
3. Use the package-manager runner instead of assuming a global binary:
   - npm: `npx quality-gc ...`
   - pnpm: `pnpm exec quality-gc ...`

Workflow:

1. Inspect repository shape, package manager, GitHub remote, and current branch. Do not read or quote secret file contents; use path-level evidence only for `.env`, credential, token, or secret-shaped files.
2. Run preview commands first:
   - npm: `npx quality-gc setup --root .`
   - npm: `npx quality-gc install-skill --target codex --scope project --root .`
   - npm: `npx quality-gc cleanup-scan --root . --dry-run`
   - pnpm: `pnpm exec quality-gc setup --root .`
   - pnpm: `pnpm exec quality-gc install-skill --target codex --scope project --root .`
   - pnpm: `pnpm exec quality-gc cleanup-scan --root . --dry-run`
3. Present the plan/diff and ask for approval before any writes.
4. After approval, create a dedicated setup branch, run setup with `--apply` through the package-manager runner, install the selected skill, run local checks, commit, push, and open a PR.
5. Run `quality-gc labels --repo <owner/name>` through the package-manager runner first, then run it with `--apply` after approval to create missing Quality GC labels before live issue write.
6. Prove live Cleanup Scan issue writes through the installed GitHub Actions workflow with its scoped `GITHUB_TOKEN`; do not use local `gh` as the scheduled issue writer.

Reject broad cleanup refactors, direct default-branch writes, permanent allowlists for discovered violations, and broad GitHub permissions.
