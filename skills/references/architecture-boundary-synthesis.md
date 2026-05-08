# Architecture Boundary Synthesis

Use this reference when installing Quality GC or updating `.quality-gc/quality-gc.config.mjs`.

## Refresh Triggers

Refresh the architecture config when one of these happens:

- the user asks to refresh or update Quality GC architecture boundaries;
- Cleanup Scan reports `architecture-config-drift`;
- the PR workflow prints a Quality GC architecture drift warning;
- a PR adds a package root, app/service folder, source module, public entrypoint, or repeated ownership layer.

Refreshes must still go through review. Do not auto-commit generated architecture rules from CI.

## Workflow

1. Inspect the source tree, package/workspace metadata, import aliases, and existing imports.
2. Classify the project shape before choosing rule types.
3. Identify stable ownership boundaries from code evidence, not guesses.
4. Draft a minimal initial architecture config.
5. Run the architecture command against the draft config.
6. Run `quality-gc architecture-drift --root .` to confirm the refresh removed coverage drift or to explain remaining custom-layout gaps.
7. If the config is invalid, fix the config shape. If it reports violations, keep valid intended rules and report the violations as code work.

## Project Shape Classification

Do not assume a specific architecture. Classify the repository from evidence first:

- Single package: one `package.json`, one main source root, no workspace package graph.
- Monorepo: workspace config, multiple package roots, `apps/*`, `packages/*`, `services/*`, or equivalent repeated roots.
- Library/package: exported public API, `src/index.ts`, reusable modules, minimal runtime wiring.
- CLI/tooling package: command entrypoints, scripts, file-system/process boundaries, no app/service layering.
- Frontend app: UI routes/components, browser packages, client/server split, API client boundaries.
- Backend app/service: controllers/routes/jobs, framework/runtime wiring, persistence or infrastructure adapters.
- Fullstack app: frontend and server/runtime code in one repository, often with shared types/contracts.
- Mixed or custom layout: use the names and boundaries actually present in the codebase.

If none of these patterns fits cleanly, state that the layout is custom and generate only narrow path-based rules backed by direct evidence.

## Evidence To Look For

- Package roots: `package.json`, workspace packages, service folders, `apps/*`, `packages/*`, or repository-specific named source roots.
- Public entrypoints: `index.ts`, module/facade files, API clients, exported package files, or documented module exports.
- Repeated folders or module names that imply ownership. Common examples include `domain`, `application`, `use-cases`, `services`, `infrastructure`, `persistence`, `db`, `adapters`, `controllers`, `ui`, `app`, `shared`, `contracts`, and `types`, but these are examples only.
- Runtime dependencies in pure areas: framework packages, database clients, queue clients, Redis clients, browser/UI packages, or direct `process.env` reads.
- Existing imports that reveal intended direction and existing violations.

## Rule Selection

- Use `serviceRoots` only when the repository has multiple services/packages or package-like roots and imports can cross those roots.
- Use `domains` only when a module has clear public entrypoints and internal files that external modules should not import.
- Use `layerBoundaries` only when a bounded context has durable, repeated layer folders or equivalent repository-specific layers.
- Use `pathImportBoundaries` for concrete path-to-path bans that do not fit service, domain, or layer rules.
- Use `externalImportBoundaries` to keep packages out of source areas that are demonstrably pure or runtime-incompatible.
- Use `syntaxBoundaries` for supported syntax bans such as `process.env` only where direct environment access is structurally inappropriate.

## Common Pattern Candidates

These are candidates, not defaults. Apply them only when the project shape and code evidence support them:

- In layered backend or domain-oriented modules, inner layers usually should not import persistence, infrastructure, framework adapters, UI, or transport layers.
- In shared contracts/types packages, runtime frameworks, queues, databases, Redis, UI packages, and direct environment access are usually suspicious.
- In frontend/UI areas, backend runtime, database schemas, queues, and server-only packages are usually suspicious.
- In monorepos, service/package roots usually should not import another service's internals unless the target root is explicitly public/shared.
- In libraries, public API entrypoints should usually be explicit and consumers should not import deep internals.
- In CLI/tooling packages, reusable core logic should usually stay separate from process, filesystem, shell, and environment wiring when that split is visible in the codebase.

## Template

This template is illustrative. Remove sections that are not backed by the target repository's structure and rename ids/paths to match the actual codebase.

```js
rules: {
  architecture: {
    status: 'blocking',
    boundaries: [],
    serviceRoots: [
      { id: 'api', path: 'src/api', packageName: 'api-service' },
      { id: 'shared', path: 'src/shared', public: true },
    ],
    domains: [
      {
        id: 'billing',
        root: 'src/billing',
        publicEntryPoints: ['src/billing/index.ts'],
        internalConsumerRoots: ['src/billing/scripts'],
        message: 'Billing internals must stay behind the public entrypoint.',
      },
    ],
    layerBoundaries: [
      {
        id: 'render-snapshot',
        layers: [
          { id: 'domain', paths: ['src/render-snapshot/domain', 'src/render-snapshot/application'] },
          { id: 'persistence', paths: ['src/render-snapshot/persistence'] },
          { id: 'infrastructure', paths: ['src/render-snapshot/infrastructure'] },
        ],
        rules: [
          {
            from: 'domain',
            disallow: ['persistence', 'infrastructure'],
            message: 'Application/domain code must not import persistence or infrastructure directly.',
          },
        ],
      },
    ],
    pathImportBoundaries: [],
    externalImportBoundaries: [],
    syntaxBoundaries: [],
  },
}
```

## Validation Rules

- Every configured path must be repository-relative and non-empty.
- Every `layerBoundaries.rules[].from` value must reference a layer id from the same boundary.
- Every `layerBoundaries.rules[].disallow[]` value must reference layer ids from the same boundary.
- `syntaxBoundaries[].forbiddenSyntax` currently supports only `process.env`.
- Existing violations are not permanent allowlists. Configure the intended rule and report the violations.
- Leave architecture rules empty only when there is no stable ownership boundary to infer from. State exact evidence when this happens.
