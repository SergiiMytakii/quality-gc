# Architecture Boundaries

This document describes the technical architecture rule format used by `quality-gc`.

The CLI default config keeps architecture rules empty because each repository has its own layers, package roots, public entrypoints, and legacy violations. The setup-agent skill should inspect the target codebase and write a project-specific initial config instead of treating empty boundaries as a completed setup.

Architecture rules live under `rules.architecture` in `.quality-gc/quality-gc.config.mjs`.

`rules.architecture.status` is the default status for architecture rules. Individual architecture entries may override it with `status: 'blocking'`, `status: 'candidate'`, or `status: 'disabled'`.

- `blocking` rules fail `quality-gc run` and the architecture workflow when they have violations.
- `candidate` rules do not fail blocking checks. Cleanup Scan turns their current violations into GitHub Issues, so existing architecture debt can be tracked without breaking CI.
- `disabled` rules are ignored.

## Supported Rule Types

`boundaries` is the legacy path-to-path rule format:

```js
boundaries: [
  {
    from: ['src/domain', 'src/application'],
    disallowImportsFrom: ['src/infrastructure', 'src/persistence'],
    message: 'Domain/application code must not import infrastructure directly.',
  },
];
```

`serviceRoots` define package or service ownership. Imports from one non-public service root into another service root are reported.

```js
serviceRoots: [
  { id: 'api', path: 'src/api', packageName: 'api-service' },
  { id: 'billing', path: 'src/billing', packageName: 'billing-service', public: true },
];
```

`domains` protect internals behind explicit public entrypoints.

```js
domains: [
  {
    id: 'billing',
    root: 'src/billing',
    publicEntryPoints: ['src/billing/index.ts'],
    internalConsumerRoots: ['src/billing/scripts'],
    message: 'Billing internals must stay behind the public entrypoint.',
  },
];
```

`layerBoundaries` describe import direction inside a module or bounded context.

```js
layerBoundaries: [
  {
    id: 'render-snapshot',
    layers: [
      { id: 'domain', paths: ['src/render-snapshot/domain', 'src/render-snapshot/application'] },
      { id: 'persistence', paths: ['src/render-snapshot/persistence'] },
    ],
    rules: [
      {
        status: 'candidate',
        from: 'domain',
        disallow: ['persistence'],
        message: 'Application/domain code must not import persistence directly.',
      },
    ],
  },
];
```

`pathImportBoundaries` ban imports from one set of source paths into another set of target paths.

```js
pathImportBoundaries: [
  {
    id: 'frontend-no-shared-schemas',
    fromPaths: ['src/frontend'],
    targetPaths: ['src/shared/schemas'],
    message: 'Frontend code must not import shared database schemas.',
  },
];
```

`externalImportBoundaries` ban package imports from selected source paths.

```js
externalImportBoundaries: [
  {
    id: 'shared-contracts-no-runtime-packages',
    sourcePaths: ['src/shared/contracts', 'src/shared/types'],
    forbiddenImportSpecifiers: ['@nestjs/', 'mongoose', 'bullmq', 'ioredis', 'react', 'next'],
    message: 'Shared contracts must stay runtime-pure.',
  },
];
```

`syntaxBoundaries` ban supported syntax patterns from selected source paths. Currently supported: `process.env`.

```js
syntaxBoundaries: [
  {
    id: 'domain-no-process-env',
    sourcePaths: ['src/domain', 'src/application'],
    forbiddenSyntax: ['process.env'],
    includeTests: false,
    message: 'Domain/application code must receive typed config instead of reading process.env directly.',
  },
];
```

## Setup-Agent Expectations

The setup-agent skill should generate high-confidence initial rules from code evidence. It should not assume a specific architecture or force every repository into the same shape.

Before writing rules, the agent should classify the project shape from local evidence:

- single package;
- monorepo or workspace;
- library/package;
- CLI/tooling package;
- frontend app;
- backend app/service;
- fullstack app;
- mixed or custom layout.

Then it should choose only the rule types that fit the observed structure:

- repeated source layers or ownership folders, if the project actually has them;
- package or workspace boundaries visible in `package.json`, lockfiles, import aliases, and source roots;
- public module entrypoints such as `index.ts`, `*.module.ts`, or documented facade services;
- existing imports that already show intended direction and current violations.

Existing violations are not a reason to omit a rule. If the rule represents the intended architecture but the current code violates it, configure it as `candidate`. Cleanup Scan will create or update an issue for that debt. Promote it to `blocking` after violations reach zero.

Empty architecture rules are acceptable only when the repository has no stable ownership boundary to infer from, for example a package with only `src/index.ts` and no repeatable layers, public entrypoints, package roots, or runtime/pure split.

## Keeping Config Current

Quality GC does not auto-rewrite architecture rules in CI. Architecture boundaries are design decisions and should go through review.

The package provides two deterministic refresh signals:

- `quality-gc cleanup-scan` reports `architecture-config-drift` when it sees source/package/module roots that are not covered by the current architecture config.
- `quality-gc architecture-drift --root .` runs the same coverage check as an advisory command. The installed architecture workflow runs this on pull requests and prints GitHub warning annotations without failing the workflow by default.

When either signal appears, run the setup-agent architecture refresh workflow. The agent should inspect the current codebase, update `.quality-gc/quality-gc.config.mjs`, then run both `quality-gc architecture --root .` and `quality-gc architecture-drift --root .`.
