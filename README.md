# quality-gc

`quality-gc` installs deterministic guardrails for TypeScript/JavaScript repositories that use npm, GitHub Actions, and GitHub Issues.

The package is the engine. It does not embed AI in recurring checks. The optional setup-agent skills for Codex and Claude Code orchestrate the CLI: they inspect the repository, run preview commands, ask for approval before writes, create PR-first setup branches, and prove the live Cleanup Scan path.

## Commands

- `quality-gc setup` previews generated config, scripts, docs, and workflows. Add `--apply` to write approved changes from a setup branch.
- `quality-gc run` runs blocking guardrails only.
- `quality-gc architecture` runs architecture boundary rules.
- `quality-gc cleanup-scan` generates non-blocking cleanup findings and issue plans.
- `quality-gc labels --repo owner/name` previews or creates the minimum Quality GC labels for setup-time issue writes.
- `quality-gc migrate` previews managed upgrades for existing installations.
- `quality-gc install-skill --target codex|claude-code` installs or previews setup-agent prompts.

All mutating commands default to preview mode. Existing unmanaged files are not overwritten.
When a repository has an `origin/HEAD`, apply mode refuses to write on the default branch unless `--allow-default-branch` is explicitly passed for a controlled fixture.

## Pre-publish setup

Before the npm package is published, setup can still be proven with a local tarball or GitHub dependency source:

```sh
npm pack
npx ./quality-gc-0.1.0.tgz setup --root ../target-repo --package-source "github:SergiiMytakii/quality-gc#main"
```

After publication, the default package source is the npm package `quality-gc`.
