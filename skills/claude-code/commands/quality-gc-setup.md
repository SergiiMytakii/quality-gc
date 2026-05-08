---
description: Preview or run Quality GC setup through the installed setup-agent
argument-hint: [preview|apply]
---

Use the `quality-gc-setup-agent` subagent to run Quality GC setup for this repository.

Mode: $ARGUMENTS

The subagent must run preview commands before writes, avoid secret file contents, keep setup PR-first, and use the `quality-gc` CLI instead of duplicating deterministic checks.
