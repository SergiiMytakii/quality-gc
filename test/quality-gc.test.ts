import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { loadConfig, validateConfig } from '../src/config/load.js';
import { defaultConfig, PACKAGE_VERSION, renderConfig } from '../src/config/schema.js';
import { main } from '../src/cli.js';
import { collectCleanupFindings } from '../src/commands/cleanup-scan.js';
import { runArchitectureDriftCommand } from '../src/commands/architecture-drift.js';
import { runGuardrailsCommand } from '../src/commands/run.js';
import { evaluateArchitecture } from '../src/guards/architecture.js';
import { issueMarker, planIssueActions } from '../src/github/issues.js';
import { planLabelActions } from '../src/github/labels.js';
import { createMigrationPlan, createSetupPlan } from '../src/setup/plan.js';
import { applySetupPlan } from '../src/setup/apply.js';
import { writeNoNewAnyBaseline, evaluateNoNewAny, countExplicitAny } from '../src/guards/no-new-any.js';
import { cleanupScanWorkflow } from '../src/workflows/templates.js';
import {
  createSkillInstallPlan,
  applySkillInstallPlan,
  createSkillUpdateReport,
  writeSkillUpdateReport,
} from '../src/skills/install.js';
import {
  defaultPostinstallChoice,
  normalizePostinstallChoice,
  normalizeSkillUpdateChoice,
  shouldPromptForSkillInstall,
  targetsForChoice,
} from '../src/postinstall.js';
import { fileExists, readJson, readText, writeText } from '../src/util/fs.js';
import { requireSuccessfulCommand } from '../src/util/exec.js';

function tempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function createNpmRepo(): string {
  const root = tempDir('quality-gc-fixture-');
  writeText(
    path.join(root, 'package.json'),
    `${JSON.stringify({ name: 'fixture', version: '1.0.0', type: 'module' }, null, 2)}\n`,
  );
  writeText(path.join(root, 'src/index.ts'), 'export const value: string = "ok";\n');
  requireSuccessfulCommand('git', ['init'], { cwd: root });
  requireSuccessfulCommand('git', ['config', 'user.email', 'quality-gc@example.com'], { cwd: root });
  requireSuccessfulCommand('git', ['config', 'user.name', 'Quality GC'], { cwd: root });
  return root;
}

function createNpmRepoWithoutSource(): string {
  const root = tempDir('quality-gc-fixture-');
  writeText(
    path.join(root, 'package.json'),
    `${JSON.stringify({ name: 'fixture', version: '1.0.0', type: 'module' }, null, 2)}\n`,
  );
  requireSuccessfulCommand('git', ['init'], { cwd: root });
  requireSuccessfulCommand('git', ['config', 'user.email', 'quality-gc@example.com'], { cwd: root });
  requireSuccessfulCommand('git', ['config', 'user.name', 'Quality GC'], { cwd: root });
  return root;
}

function createPnpmRepo(): string {
  const root = createNpmRepo();
  writeText(
    path.join(root, 'package.json'),
    `${JSON.stringify(
      {
        name: 'fixture',
        version: '1.0.0',
        type: 'module',
        packageManager: 'pnpm@10.17.1',
      },
      null,
      2,
    )}\n`,
  );
  writeText(path.join(root, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n");
  return root;
}

function createYarnRepo(): string {
  const root = createNpmRepo();
  writeText(
    path.join(root, 'package.json'),
    `${JSON.stringify(
      {
        name: 'fixture',
        version: '1.0.0',
        type: 'module',
        packageManager: 'yarn@1.22.22',
      },
      null,
      2,
    )}\n`,
  );
  writeText(path.join(root, 'yarn.lock'), '# yarn lockfile v1\n');
  return root;
}

async function captureStdout(run: () => Promise<number>): Promise<{ exitCode: number; stdout: string }> {
  const lines: string[] = [];
  const logSpy = vi.spyOn(console, 'log').mockImplementation((message?: unknown, ...optionalParams: unknown[]) => {
    lines.push([message, ...optionalParams].map(value => String(value)).join(' '));
  });
  try {
    return {
      exitCode: await run(),
      stdout: lines.join('\n'),
    };
  } finally {
    logSpy.mockRestore();
  }
}

describe('setup and migrate safety', () => {
  it('previews setup without writing files', () => {
    const root = createNpmRepo();
    const plan = createSetupPlan(root, { packageSource: 'github:SergiiMytakii/quality-gc#main' });

    expect(plan.changes.map(change => change.path)).toContain('.quality-gc/quality-gc.config.mjs');
    expect(fileExists(path.join(root, '.quality-gc/quality-gc.config.mjs'))).toBe(false);
    expect(plan.changes.every(change => change.action !== 'conflict')).toBe(true);
  });

  it('applies setup with a pre-publish package source', () => {
    const root = createNpmRepo();
    const plan = createSetupPlan(root, { packageSource: 'github:SergiiMytakii/quality-gc#main' });
    const written = applySetupPlan(plan);
    const packageJson = readJson<{ devDependencies: Record<string, string>; scripts: Record<string, string> }>(
      path.join(root, 'package.json'),
    );

    expect(written).toContain('.github/workflows/quality-gc-cleanup-scan.yml');
    expect(packageJson.devDependencies['quality-gc']).toBe('github:SergiiMytakii/quality-gc#main');
    expect(packageJson.scripts['quality:gc']).toBe('quality-gc run --root .');
  });

  it('updates an already installed npm quality-gc version during setup', () => {
    const root = createNpmRepo();
    const packageJsonPath = path.join(root, 'package.json');
    const packageJson = readJson<Record<string, unknown>>(packageJsonPath);
    writeText(
      packageJsonPath,
      `${JSON.stringify(
        {
          ...packageJson,
          devDependencies: {
            'quality-gc': '^0.1.1',
          },
        },
        null,
        2,
      )}\n`,
    );

    const targetSource = `^${PACKAGE_VERSION}`;
    const plan = createSetupPlan(root, { packageSource: targetSource });
    const packageChange = plan.changes.find(change => change.path === 'package.json');

    expect(packageChange?.action).toBe('update');
    expect(packageChange?.reason).not.toContain(`not ${targetSource}`);
    expect(JSON.parse(packageChange?.content ?? '{}').devDependencies['quality-gc']).toBe(targetSource);
  });

  it('does not replace a custom quality-gc package source during setup', () => {
    const root = createNpmRepo();
    const packageJsonPath = path.join(root, 'package.json');
    const packageJson = readJson<Record<string, unknown>>(packageJsonPath);
    writeText(
      packageJsonPath,
      `${JSON.stringify(
        {
          ...packageJson,
          devDependencies: {
            'quality-gc': 'github:SergiiMytakii/quality-gc#main',
          },
        },
        null,
        2,
      )}\n`,
    );

    const plan = createSetupPlan(root, { packageSource: `^${PACKAGE_VERSION}` });
    const packageChange = plan.changes.find(change => change.path === 'package.json');

    expect(packageChange?.action).toBe('conflict');
  });

  it('generates pnpm GitHub workflows for pnpm repositories', () => {
    const root = createPnpmRepo();
    const plan = createSetupPlan(root);
    const architecture = plan.changes.find(change => change.path === '.github/workflows/quality-gc-architecture.yml');
    const cleanupScan = plan.changes.find(change => change.path === '.github/workflows/quality-gc-cleanup-scan.yml');
    const docs = plan.changes.find(change => change.path === 'docs/quality-gc.md');

    expect(architecture?.content).toContain('cache: pnpm');
    expect(architecture?.content).toContain('uses: pnpm/action-setup@v4');
    expect(architecture?.content).toContain('run_install: false');
    expect(architecture?.content).toContain('run: pnpm install --frozen-lockfile');
    expect(architecture?.content).toContain('run: pnpm run quality:gc:architecture');
    expect(architecture?.content).toContain('run: pnpm run quality:gc:architecture-drift');
    expect(architecture?.content).not.toContain('npm ci');
    expect(architecture?.content.indexOf('uses: pnpm/action-setup@v4')).toBeLessThan(
      architecture?.content.indexOf('uses: actions/setup-node@v4') ?? -1,
    );
    expect(cleanupScan?.content).toContain('pnpm run quality:gc:cleanup-scan:write -- --repo "$GITHUB_REPOSITORY"');
    expect(docs?.content).toContain('detected pnpm');
  });

  it('generates yarn GitHub workflows for yarn repositories', () => {
    const root = createYarnRepo();
    const plan = createSetupPlan(root);
    const architecture = plan.changes.find(change => change.path === '.github/workflows/quality-gc-architecture.yml');
    const cleanupScan = plan.changes.find(change => change.path === '.github/workflows/quality-gc-cleanup-scan.yml');
    const docs = plan.changes.find(change => change.path === 'docs/quality-gc.md');

    expect(architecture?.content).toContain('cache: yarn');
    expect(architecture?.content).toContain('run: corepack enable');
    expect(architecture?.content).toContain('run: yarn install --frozen-lockfile');
    expect(architecture?.content).toContain('run: yarn run quality:gc:architecture');
    expect(architecture?.content).toContain('run: yarn run quality:gc:architecture-drift');
    expect(architecture?.content).not.toContain('npm ci');
    expect(cleanupScan?.content).toContain('yarn run quality:gc:cleanup-scan:write -- --repo "$GITHUB_REPOSITORY"');
    expect(docs?.content).toContain('detected yarn');
    expect(docs?.content).toContain('yarn run quality:gc');
  });

  it('detects TypeScript source roots for repositories without root src', () => {
    const root = createNpmRepoWithoutSource();
    writeText(path.join(root, 'apps/web/src/index.ts'), 'export const value: any = "covered";\n');
    writeText(path.join(root, 'packages/core/src/index.ts'), 'export const value: string = "covered";\n');

    const plan = createSetupPlan(root);
    const configChange = plan.changes.find(change => change.path === '.quality-gc/quality-gc.config.mjs');
    const baselineChange = plan.changes.find(change => change.path === '.quality-gc/no-new-any-baseline.json');
    const configText = configChange?.content ?? '';
    const baseline = JSON.parse(baselineChange?.content ?? '{}') as { files: Record<string, number> };

    expect(configText).toContain('"apps/**/*.{ts,tsx}"');
    expect(configText).toContain('"packages/**/*.{ts,tsx}"');
    expect(configText).not.toContain('"src/**/*.{ts,tsx}"');
    expect(baseline.files).toEqual({ 'apps/web/src/index.ts': 1 });
  });

  it('detects service-level TypeScript roots in package-based monorepos', () => {
    const root = createNpmRepoWithoutSource();
    writeText(path.join(root, 'apps/frontend/package.json'), '{"name":"frontend"}\n');
    writeText(path.join(root, 'apps/frontend/src/index.tsx'), 'export const value: any = "frontend";\n');
    writeText(path.join(root, 'apps/backend/package.json'), '{"name":"backend"}\n');
    writeText(path.join(root, 'apps/backend/src/index.ts'), 'export const value: string = "backend";\n');
    writeText(path.join(root, 'services/worker/package.json'), '{"name":"worker"}\n');
    writeText(path.join(root, 'services/worker/src/index.ts'), 'export const value: any = "worker";\n');
    writeText(path.join(root, 'packages/shared/package.json'), '{"name":"shared"}\n');
    writeText(path.join(root, 'packages/shared/src/index.ts'), 'export const value: string = "shared";\n');

    const plan = createSetupPlan(root);
    const configChange = plan.changes.find(change => change.path === '.quality-gc/quality-gc.config.mjs');
    const baselineChange = plan.changes.find(change => change.path === '.quality-gc/no-new-any-baseline.json');
    const configText = configChange?.content ?? '';
    const baseline = JSON.parse(baselineChange?.content ?? '{}') as { files: Record<string, number> };

    expect(configText).toContain('"apps/backend/**/*.{ts,tsx}"');
    expect(configText).toContain('"apps/frontend/**/*.{ts,tsx}"');
    expect(configText).toContain('"packages/shared/**/*.{ts,tsx}"');
    expect(configText).toContain('"services/worker/**/*.{ts,tsx}"');
    expect(configText).not.toContain('"apps/**/*.{ts,tsx}"');
    expect(configText).not.toContain('"services/**/*.{ts,tsx}"');
    expect(baseline.files).toEqual({
      'apps/frontend/src/index.tsx': 1,
      'services/worker/src/index.ts': 1,
    });
  });

  it('adds architecture drift scripts during setup', () => {
    const root = createNpmRepo();
    const plan = createSetupPlan(root);
    const packageChange = plan.changes.find(change => change.path === 'package.json');
    const packageJson = JSON.parse(packageChange?.content ?? '{}') as { scripts: Record<string, string> };

    expect(packageJson.scripts['quality:gc:architecture-drift']).toBe('quality-gc architecture-drift --root .');
  });

  it('refuses unmanaged generated files', () => {
    const root = createNpmRepo();
    writeText(path.join(root, 'docs/quality-gc.md'), '# local docs\n');

    const plan = createSetupPlan(root);
    const conflict = plan.changes.find(change => change.path === 'docs/quality-gc.md');

    expect(conflict?.action).toBe('conflict');
    expect(() => applySetupPlan(plan)).toThrow(/Refusing to apply/);
  });

  it('rejects invalid config without schemaVersion', () => {
    expect(() => validateConfig({ installedVersion: '0.1.0', rules: {} })).toThrow(/schemaVersion/);
  });

  it('migrates old owned config and package source without blind overwrite conflicts', async () => {
    const root = createNpmRepo();
    applySetupPlan(createSetupPlan(root, { packageSource: '^0.0.1' }));
    writeText(path.join(root, '.quality-gc/quality-gc.config.mjs'), renderConfig(defaultConfig('0.0.1')));

    const plan = await createMigrationPlan(root, { packageSource: `^${PACKAGE_VERSION}` });
    expect(plan.changes.every(change => change.action !== 'conflict')).toBe(true);

    applySetupPlan(plan);
    const packageJson = readJson<{ devDependencies: Record<string, string> }>(path.join(root, 'package.json'));
    const configText = readText(path.join(root, '.quality-gc/quality-gc.config.mjs'));

    expect(packageJson.devDependencies['quality-gc']).toBe(`^${PACKAGE_VERSION}`);
    expect(configText).toContain(`"installedVersion": "${PACKAGE_VERSION}"`);
  });

  it('routes setup through migration and updates legacy src-only no-new-any config', async () => {
    const root = createNpmRepoWithoutSource();
    writeText(path.join(root, 'apps/web/src/index.ts'), 'export const value: any = "covered";\n');
    writeText(path.join(root, 'packages/core/src/index.ts'), 'export const value: string = "covered";\n');
    const legacyConfig = defaultConfig('0.1.2');
    legacyConfig.rules.noNewAny.include = ['src/**/*.{ts,tsx}'];
    legacyConfig.rules.noNewAny.exclude = [
      'src/**/__tests__/**',
      'src/**/*.spec.ts',
      'src/**/*.spec.tsx',
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
      'src/**/scripts/**',
    ];
    writeText(path.join(root, '.quality-gc/quality-gc.config.mjs'), renderConfig(legacyConfig));

    const result = await captureStdout(() => main(['setup', '--root', root, '--json']));
    const payload = JSON.parse(result.stdout) as { plan: { changes: Array<{ path: string; content: string }> } };
    const configChange = payload.plan.changes.find(change => change.path === '.quality-gc/quality-gc.config.mjs');
    const baselineChange = payload.plan.changes.find(change => change.path === '.quality-gc/no-new-any-baseline.json');
    const baseline = JSON.parse(baselineChange?.content ?? '{}') as { files: Record<string, number> };

    expect(result.exitCode).toBe(0);
    expect(configChange?.content).toContain('"apps/**/*.{ts,tsx}"');
    expect(configChange?.content).toContain('"packages/**/*.{ts,tsx}"');
    expect(configChange?.content).not.toContain('"src/**/*.{ts,tsx}"');
    expect(baseline.files).toEqual({ 'apps/web/src/index.ts': 1 });
  });

  it('adds baseline counts for newly scanned files during migration', async () => {
    const root = createNpmRepoWithoutSource();
    writeText(path.join(root, 'apps/web/src/index.ts'), 'export const value: any = "legacy";\n');
    const legacyConfig = defaultConfig('0.1.2');
    legacyConfig.rules.noNewAny.include = ['src/**/*.{ts,tsx}'];
    legacyConfig.rules.noNewAny.exclude = [
      'src/**/__tests__/**',
      'src/**/*.spec.ts',
      'src/**/*.spec.tsx',
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
      'src/**/scripts/**',
    ];
    writeText(path.join(root, '.quality-gc/quality-gc.config.mjs'), renderConfig(legacyConfig));
    writeText(
      path.join(root, '.quality-gc/no-new-any-baseline.json'),
      `${JSON.stringify({ schemaVersion: 1, description: 'old baseline', files: {} }, null, 2)}\n`,
    );

    const plan = await createMigrationPlan(root);
    const baselineChange = plan.changes.find(change => change.path === '.quality-gc/no-new-any-baseline.json');
    const baseline = JSON.parse(baselineChange?.content ?? '{}') as { files: Record<string, number> };

    expect(baselineChange?.action).toBe('update');
    expect(baseline.files).toEqual({ 'apps/web/src/index.ts': 1 });

    applySetupPlan(plan);
    await expect(loadConfig(root).then(config => evaluateNoNewAny(root, config))).resolves.toEqual([]);
  });
});

describe('CLI output contracts', () => {
  it('emits parseable JSON without trailing status prose', async () => {
    const root = createNpmRepo();
    const result = await captureStdout(() => main(['run', '--root', root, '--json']));

    expect(result.exitCode).toBe(0);
    expect(() => JSON.parse(result.stdout)).not.toThrow();
    expect(result.stdout).not.toContain('Quality GC blocking guardrails passed');
  });
});

describe('guardrail adoption model', () => {
  it('detects explicit any above baseline', () => {
    const root = createNpmRepo();
    writeNoNewAnyBaseline(root, '.quality-gc/no-new-any-baseline.json');
    writeText(path.join(root, 'src/index.ts'), 'export const value: any = "bad";\n');
    const config = defaultConfig();

    expect(evaluateNoNewAny(root, config)).toHaveLength(1);
  });

  it('counts real TypeScript any nodes without counting comments or strings', () => {
    const content = [
      '// TODO: remove as any from this note',
      'const label = "value: any";',
      'const value: Record<string, any> = {};',
      'const items: Promise<any[]> = Promise.resolve([]);',
      'const cast = value as any;',
      'const legacyCast = <any>value;',
    ].join('\n');

    expect(countExplicitAny(content)).toBe(4);
  });

  it('honors no-new-any include and exclude config', () => {
    const root = createNpmRepo();
    writeText(path.join(root, 'src/index.ts'), 'export const value: any = "covered";\n');
    writeText(path.join(root, 'tools/script.ts'), 'export const value: any = "ignored";\n');
    const config = defaultConfig();
    config.rules.noNewAny.include = ['src/**/*.ts', 'tools/**/*.ts'];
    config.rules.noNewAny.exclude = ['tools/**/*.ts'];

    const violations = evaluateNoNewAny(root, config);

    expect(violations).toEqual([expect.objectContaining({ path: 'src/index.ts' })]);
  });

  it('detects architecture violations in multiline imports', () => {
    const root = createNpmRepo();
    writeText(
      path.join(root, 'src/index.ts'),
      [
        'import {',
        '  forbidden',
        "} from './infra/forbidden';",
        'export const value = forbidden;',
      ].join('\n'),
    );
    writeText(path.join(root, 'src/infra/forbidden.ts'), 'export const forbidden = "bad";\n');
    const config = defaultConfig();
    config.rules.architecture.boundaries = [
      {
        from: ['src'],
        disallowImportsFrom: ['src/infra'],
        message: 'src must not import infra',
      },
    ];

    expect(evaluateArchitecture(root, config)).toEqual([
      expect.objectContaining({
        path: 'src/index.ts',
        line: 1,
        detail: 'src must not import infra',
      }),
    ]);
  });

  it('detects architecture layer violations from application and domain code into persistence', () => {
    const root = createNpmRepo();
    writeText(
      path.join(root, 'src/render-snapshot/domain/render-snapshot.entity.ts'),
      [
        "import type { RenderSnapshotRecord } from '../persistence/render-snapshot.record';",
        'export interface RenderSnapshot {',
        '  record?: RenderSnapshotRecord;',
        '}',
      ].join('\n'),
    );
    writeText(
      path.join(root, 'src/render-snapshot/persistence/render-snapshot.record.ts'),
      'export interface RenderSnapshotRecord { id: string; }\n',
    );
    const config = defaultConfig();
    config.rules.architecture.layerBoundaries = [
      {
        id: 'render-snapshot',
        layers: [
          {
            id: 'domain',
            paths: ['src/render-snapshot/domain', 'src/render-snapshot/application'],
          },
          {
            id: 'persistence',
            paths: ['src/render-snapshot/persistence'],
          },
        ],
        rules: [
          {
            from: 'domain',
            disallow: ['persistence'],
            message: 'application/domain must not import persistence',
          },
        ],
      },
    ];

    expect(evaluateArchitecture(root, config)).toEqual([
      expect.objectContaining({
        rule: 'architecture:layer-boundary:render-snapshot',
        path: 'src/render-snapshot/domain/render-snapshot.entity.ts',
        line: 1,
        detail: 'application/domain must not import persistence',
      }),
    ]);
  });

  it('keeps candidate architecture boundary violations out of blocking run and in cleanup findings', async () => {
    const root = createNpmRepo();
    writeText(
      path.join(root, 'src/projects/domain/render-snapshot.entity.ts'),
      [
        "import type { RenderSnapshotRecord } from '../infrastructure/persistence/render-snapshot.record';",
        'export interface RenderSnapshot {',
        '  record?: RenderSnapshotRecord;',
        '}',
      ].join('\n'),
    );
    writeText(
      path.join(root, 'src/projects/infrastructure/persistence/render-snapshot.record.ts'),
      'export interface RenderSnapshotRecord { id: string; }\n',
    );
    const config = defaultConfig();
    config.rules.architecture.layerBoundaries = [
      {
        id: 'projects',
        layers: [
          { id: 'domain', paths: ['src/projects/domain'] },
          { id: 'infrastructure', paths: ['src/projects/infrastructure'] },
        ],
        rules: [
          {
            status: 'candidate',
            from: 'domain',
            disallow: ['infrastructure'],
            message: 'Projects domain must not import infrastructure directly.',
          },
        ],
      },
    ];
    writeText(path.join(root, '.quality-gc/quality-gc.config.mjs'), renderConfig(config));

    await expect(runGuardrailsCommand({ root, json: true })).resolves.toBe(0);

    const findings = await collectCleanupFindings(root);
    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'candidate-architecture-layer-boundary-projects',
          category: 'candidate-rule',
          evidence: expect.arrayContaining([
            expect.objectContaining({
              path: 'src/projects/domain/render-snapshot.entity.ts',
              detail: 'Projects domain must not import infrastructure directly.',
            }),
          ]),
        }),
      ]),
    );
    const actions = planIssueActions(findings);
    expect(actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'create',
          title: expect.stringContaining('[candidate-architecture-layer-boundary-projects]'),
          labels: expect.arrayContaining(['quality-gc:candidate-rule']),
        }),
      ]),
    );
  });

  it('detects architecture path, external import, and syntax boundaries', () => {
    const root = createNpmRepo();
    writeText(
      path.join(root, 'src/frontend/page.tsx'),
      [
        "import { schema } from '../shared/schemas/user.schema';",
        "import mongoose from 'mongoose';",
        'export const env = process.env.NODE_ENV;',
        'export const value = schema + mongoose.version + env;',
      ].join('\n'),
    );
    writeText(path.join(root, 'src/shared/schemas/user.schema.ts'), 'export const schema = "user";\n');
    const config = defaultConfig();
    config.rules.architecture.pathImportBoundaries = [
      {
        id: 'frontend-no-schemas',
        fromPaths: ['src/frontend'],
        targetPaths: ['src/shared/schemas'],
        message: 'frontend must not import shared schemas',
      },
    ];
    config.rules.architecture.externalImportBoundaries = [
      {
        id: 'frontend-no-mongoose',
        sourcePaths: ['src/frontend'],
        forbiddenImportSpecifiers: ['mongoose'],
        message: 'frontend must not import mongoose',
      },
    ];
    config.rules.architecture.syntaxBoundaries = [
      {
        id: 'frontend-no-process-env',
        sourcePaths: ['src/frontend'],
        forbiddenSyntax: ['process.env'],
        message: 'frontend must not read process.env',
      },
    ];

    expect(evaluateArchitecture(root, config)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule: 'architecture:path-import-boundary:frontend-no-schemas',
          path: 'src/frontend/page.tsx',
          line: 1,
          detail: 'frontend must not import shared schemas',
        }),
        expect.objectContaining({
          rule: 'architecture:external-import-boundary:frontend-no-mongoose',
          path: 'src/frontend/page.tsx',
          line: 2,
          detail: 'frontend must not import mongoose',
        }),
        expect.objectContaining({
          rule: 'architecture:syntax-boundary:frontend-no-process-env',
          path: 'src/frontend/page.tsx',
          line: 3,
          detail: 'frontend must not read process.env',
        }),
      ]),
    );
  });

  it('detects service-root internals and domain public-entrypoint violations', () => {
    const root = createNpmRepo();
    writeText(
      path.join(root, 'src/api/page.ts'),
      [
        "import { internalSearch } from 'search-service/internal/search';",
        "import { ownedInternal } from '../billing/internal/owned';",
        'export const value = internalSearch + ownedInternal;',
      ].join('\n'),
    );
    writeText(path.join(root, 'src/search/internal/search.ts'), 'export const internalSearch = "search";\n');
    writeText(path.join(root, 'src/billing/index.ts'), 'export const billing = "public";\n');
    writeText(path.join(root, 'src/billing/internal/owned.ts'), 'export const ownedInternal = "billing";\n');
    const config = defaultConfig();
    config.rules.architecture.serviceRoots = [
      { id: 'api', path: 'src/api', packageName: 'api-service' },
      { id: 'search', path: 'src/search', packageName: 'search-service' },
      { id: 'billing', path: 'src/billing', packageName: 'billing-service', public: true },
    ];
    config.rules.architecture.domains = [
      {
        id: 'billing',
        root: 'src/billing',
        publicEntryPoints: ['src/billing/index.ts'],
        message: 'billing internals must stay behind the public entrypoint',
      },
    ];

    expect(evaluateArchitecture(root, config)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule: 'architecture:service-root-boundary',
          path: 'src/api/page.ts',
          line: 1,
          detail: 'api must not import search internals directly',
        }),
        expect.objectContaining({
          rule: 'architecture:domain-public-entrypoint:billing',
          path: 'src/api/page.ts',
          line: 2,
          detail: 'billing internals must stay behind the public entrypoint',
        }),
      ]),
    );
  });

  it('validates architecture boundary config shape', () => {
    const config = defaultConfig();
    config.rules.architecture.serviceRoots = [{ id: 'api', path: 'src/api', packageName: 'api-service', status: 'candidate' }];
    config.rules.architecture.domains = [{ id: 'api', root: 'src/api', publicEntryPoints: ['src/api/index.ts'], status: 'candidate' }];
    config.rules.architecture.pathImportBoundaries = [
      { id: 'api-no-db', fromPaths: ['src/api/domain'], targetPaths: ['src/api/db'], status: 'candidate' },
    ];
    config.rules.architecture.externalImportBoundaries = [
      { id: 'domain-no-mongoose', sourcePaths: ['src/api/domain'], forbiddenImportSpecifiers: ['mongoose'], status: 'candidate' },
    ];
    config.rules.architecture.syntaxBoundaries = [
      { id: 'domain-no-env', sourcePaths: ['src/api/domain'], forbiddenSyntax: ['process.env'], status: 'candidate' },
    ];
    config.rules.architecture.layerBoundaries = [
      {
        id: 'api',
        status: 'candidate',
        layers: [
          { id: 'domain', paths: ['src/api/domain'] },
          { id: 'persistence', paths: ['src/api/persistence'] },
        ],
        rules: [{ from: 'domain', disallow: ['persistence'], status: 'blocking' }],
      },
    ];

    expect(validateConfig(config)).toBe(config);
  });

  it('rejects invalid architecture boundary configs', () => {
    const invalidLayerConfig = defaultConfig();
    invalidLayerConfig.rules.architecture.layerBoundaries = [
      {
        id: 'api',
        layers: [{ id: 'domain', paths: ['src/api/domain'] }],
        rules: [{ from: 'domain', disallow: ['persistence'] }],
      },
    ];

    expect(() => validateConfig(invalidLayerConfig)).toThrow(/unknown disallowed layer persistence/);

    const invalidSyntaxConfig = defaultConfig();
    invalidSyntaxConfig.rules.architecture.syntaxBoundaries = [
      { id: 'domain-no-debugger', sourcePaths: ['src/api/domain'], forbiddenSyntax: ['debugger'] },
    ];

    expect(() => validateConfig(invalidSyntaxConfig)).toThrow(/unsupported forbidden syntax debugger/);

    const invalidStatusConfig = defaultConfig();
    invalidStatusConfig.rules.architecture.layerBoundaries = [
      {
        id: 'api',
        layers: [
          { id: 'domain', paths: ['src/api/domain'] },
          { id: 'persistence', paths: ['src/api/persistence'] },
        ],
        rules: [{ from: 'domain', disallow: ['persistence'], status: 'preview' as 'candidate' }],
      },
    ];

    expect(() => validateConfig(invalidStatusConfig)).toThrow(/rules\.architecture\.layerBoundaries\[0\]\.rules\[0\]\.status/);
  });

  it('keeps candidate violations advisory for quality-gc run', async () => {
    const root = createNpmRepo();
    const config = defaultConfig();
    config.rules.noNewAny.status = 'disabled';
    config.rules.staleLivePath.status = 'candidate';
    config.rules.staleLivePath.retiredPaths = ['src/old-live-path'];
    writeText(path.join(root, '.quality-gc/quality-gc.config.mjs'), renderConfig(config));
    writeText(path.join(root, '.github/workflows/test.yml'), 'run: node src/old-live-path/index.js\n');

    await expect(runGuardrailsCommand({ root, json: true })).resolves.toBe(0);
    const findings = await collectCleanupFindings(root);

    expect(findings.some(finding => finding.key === 'candidate-stale-live-path')).toBe(true);
  });

  it('creates promotion findings for clean candidate rules', async () => {
    const root = createNpmRepo();
    const config = defaultConfig();
    config.rules.noNewAny.status = 'disabled';
    config.rules.staleLivePath.status = 'candidate';
    config.rules.staleLivePath.retiredPaths = ['src/old-live-path'];
    writeText(path.join(root, '.quality-gc/quality-gc.config.mjs'), renderConfig(config));

    const findings = await collectCleanupFindings(root);

    expect(findings.some(finding => finding.key === 'promote-stale-live-path')).toBe(true);
  });

  it('does not promote unconfigured candidate rules', async () => {
    const root = createNpmRepo();
    const config = defaultConfig();
    config.rules.noNewAny.status = 'disabled';
    config.rules.staleLivePath.status = 'candidate';
    config.rules.staleLivePath.retiredPaths = [];
    writeText(path.join(root, '.quality-gc/quality-gc.config.mjs'), renderConfig(config));

    const findings = await collectCleanupFindings(root);

    expect(findings.some(finding => finding.key === 'promote-stale-live-path')).toBe(false);
  });

  it('creates architecture drift findings for uncovered source modules', async () => {
    const root = createNpmRepo();
    const config = defaultConfig();
    config.rules.noNewAny.status = 'disabled';
    config.rules.staleLivePath.status = 'disabled';
    config.rules.architecture.layerBoundaries = [
      {
        id: 'billing',
        layers: [{ id: 'domain', paths: ['src/billing/domain'] }],
        rules: [],
      },
    ];
    writeText(path.join(root, '.quality-gc/quality-gc.config.mjs'), renderConfig(config));
    writeText(path.join(root, 'src/billing/domain/model.ts'), 'export const billing = "covered";\n');
    writeText(path.join(root, 'src/reports/domain/model.ts'), 'export const reports = "uncovered";\n');

    const findings = await collectCleanupFindings(root);
    const drift = findings.find(finding => finding.key === 'architecture-config-drift');

    expect(drift).toMatchObject({
      category: 'architecture-drift',
      title: 'Refresh architecture boundary config',
      deterministicAutofixSafe: false,
    });
    expect(drift?.evidence).toEqual([
      expect.objectContaining({
        path: 'src/reports',
        detail: 'source-module is not covered by current architecture boundary config',
      }),
    ]);
  });

  it('does not create architecture drift findings for covered source modules', async () => {
    const root = createNpmRepo();
    const config = defaultConfig();
    config.rules.noNewAny.status = 'disabled';
    config.rules.staleLivePath.status = 'disabled';
    config.rules.architecture.layerBoundaries = [
      {
        id: 'billing',
        layers: [{ id: 'domain', paths: ['src/billing/domain'] }],
        rules: [],
      },
    ];
    writeText(path.join(root, '.quality-gc/quality-gc.config.mjs'), renderConfig(config));
    writeText(path.join(root, 'src/billing/domain/model.ts'), 'export const billing = "covered";\n');

    const findings = await collectCleanupFindings(root);

    expect(findings.some(finding => finding.key === 'architecture-config-drift')).toBe(false);
  });

  it('does not create tracked artifact findings for reviewed local artifact paths', async () => {
    const root = createNpmRepo();
    const config = defaultConfig();
    config.rules.architecture.status = 'disabled';
    config.rules.noNewAny.status = 'disabled';
    config.rules.staleLivePath.status = 'disabled';
    config.cleanupScan.reviewedLocalArtifactPaths = ['tmp/watchdog/telegram-credentials.json'];
    writeText(path.join(root, '.quality-gc/quality-gc.config.mjs'), renderConfig(config));
    writeText(path.join(root, 'tmp/watchdog/telegram-credentials.json'), 'TOKEN=super-secret\n');
    writeText(path.join(root, 'tmp/watchdog/other-token.json'), 'TOKEN=also-secret\n');
    requireSuccessfulCommand('git', ['add', 'tmp/watchdog/telegram-credentials.json', 'tmp/watchdog/other-token.json'], {
      cwd: root,
    });

    const findings = await collectCleanupFindings(root);
    const evidencePaths = findings.flatMap(finding => finding.evidence.map(evidence => evidence.path));
    const body = JSON.stringify(findings);

    expect(evidencePaths).not.toContain('tmp/watchdog/telegram-credentials.json');
    expect(evidencePaths).toContain('tmp/watchdog/other-token.json');
    expect(body).not.toContain('super-secret');
    expect(body).not.toContain('also-secret');
  });

  it('runs architecture drift command as advisory by default', async () => {
    const root = createNpmRepo();
    const config = defaultConfig();
    config.rules.architecture.layerBoundaries = [
      {
        id: 'billing',
        layers: [{ id: 'domain', paths: ['src/billing/domain'] }],
        rules: [],
      },
    ];
    writeText(path.join(root, '.quality-gc/quality-gc.config.mjs'), renderConfig(config));
    writeText(path.join(root, 'src/reports/domain/model.ts'), 'export const reports = "uncovered";\n');

    await expect(runArchitectureDriftCommand({ root, json: true, failOnFindings: false })).resolves.toBe(0);
    await expect(runArchitectureDriftCommand({ root, json: true, failOnFindings: true })).resolves.toBe(1);
  });
});

describe('cleanup issue lifecycle', () => {
  it('dedupes by stable marker before title fallback', () => {
    const finding = {
      key: 'candidate-stale-live-path',
      title: 'Resolve candidate rule violations for stale-live-path',
      category: 'candidate-rule' as const,
      severity: 'medium' as const,
      scope: 'stale-live-path',
      suggestedVerification: 'rerun',
      deterministicAutofixSafe: false,
      evidence: [{ path: '.github/workflows/test.yml', detail: 'path-level evidence' }],
    };
    const actions = planIssueActions([finding], [
      { number: 12, title: 'old title', body: `${issueMarker(finding)}\nold body` },
    ]);

    expect(actions[0]).toMatchObject({ action: 'update', issueNumber: 12 });
    expect(actions[0].labels).toContain('quality-gc:candidate-rule');
  });

  it('plans close actions for stale cleanup issues whose findings disappeared', () => {
    const actions = planIssueActions([], [
      {
        number: 99,
        title: '[Quality GC Cleanup][tracked-artifact-tmp-old-log] Remove tracked local artifact',
        body: '<!-- quality-gc-cleanup:tracked-artifact-tmp-old-log -->\nold finding',
      },
    ]);

    expect(actions).toEqual([
      expect.objectContaining({
        action: 'close',
        issueNumber: 99,
      }),
    ]);
  });

  it('plans minimum Quality GC labels', () => {
    const actions = planLabelActions(['cleanup']);

    expect(actions.filter(action => action.action === 'create').map(action => action.name)).toEqual([
      'quality-gc',
      'quality-gc:candidate-rule',
      'quality-gc:architecture-drift',
      'quality-gc:tracked-artifact',
      'quality-gc:promotion',
    ]);
  });

  it('validates reviewed local artifact paths as strings', () => {
    const config = defaultConfig();
    config.cleanupScan.reviewedLocalArtifactPaths = [123 as unknown as string];

    expect(() => validateConfig(config)).toThrow(/cleanupScan\.reviewedLocalArtifactPaths\[0\]/);
  });

  it('uses path-level evidence for credential-shaped tracked artifacts', async () => {
    const root = createNpmRepo();
    writeText(path.join(root, 'tmp/.env.local'), 'TOKEN=super-secret\n');
    requireSuccessfulCommand('git', ['add', 'tmp/.env.local'], { cwd: root });
    const findings = await collectCleanupFindings(root);
    const body = JSON.stringify(findings);

    expect(body).toContain('tmp/.env.local');
    expect(body).not.toContain('super-secret');
    expect(body).toContain('contents were not read');
  });
});

describe('workflow and skill installer contracts', () => {
  it('keeps cleanup workflow dry-run by default and scopes write permissions', () => {
    const workflow = cleanupScanWorkflow();

    expect(workflow).toContain('default: true');
    expect(workflow).toContain('cache: npm');
    expect(workflow).toContain('run: npm ci');
    expect(workflow).toContain('contents: read');
    expect(workflow).toContain('issues: write');
    expect(workflow).toContain(
      "github.event_name == 'schedule' || (github.event_name == 'workflow_dispatch' && inputs.dry_run == false)",
    );
    expect(workflow).not.toContain('write-all');
  });

  it('installs Codex and Claude Code skills into temp homes only with apply', () => {
    const root = createNpmRepo();
    const home = tempDir('quality-gc-home-');
    const codexPlan = createSkillInstallPlan({ target: 'codex', scope: 'user', root, home });
    const claudePlan = createSkillInstallPlan({ target: 'claude-code', scope: 'project', root, home });

    expect(fileExists(codexPlan.files[0].destination)).toBe(false);
    expect(fileExists(claudePlan.files[0].destination)).toBe(false);

    applySkillInstallPlan(codexPlan);
    applySkillInstallPlan(claudePlan);

    expect(readText(codexPlan.files[0].destination)).toContain('quality-gc');
    expect(readText(codexPlan.files[1].destination)).toContain('Architecture Boundary Synthesis');
    expect(readText(claudePlan.files[0].destination)).toContain('quality-gc');
    expect(readText(claudePlan.files[2].destination)).toContain('Architecture Boundary Synthesis');
  });

  it('instructs setup agents to synthesize architecture boundaries from code evidence', () => {
    const root = createNpmRepo();
    const home = tempDir('quality-gc-home-');
    const codexPlan = createSkillInstallPlan({ target: 'codex', scope: 'user', root, home });
    const claudePlan = createSkillInstallPlan({ target: 'claude-code', scope: 'project', root, home });

    applySkillInstallPlan(codexPlan);
    applySkillInstallPlan(claudePlan);

    expect(readText(codexPlan.files[0].destination)).toContain(
      'Do not leave architecture boundaries empty just because the CLI default is empty.',
    );
    expect(readText(codexPlan.files[0].destination)).toContain('classify the project shape from local evidence');
    expect(readText(codexPlan.files[0].destination)).toContain('references/architecture-boundary-synthesis.md');
    expect(readText(codexPlan.files[1].destination)).toContain('Classify the project shape before choosing rule types.');
    expect(readText(codexPlan.files[1].destination)).toContain('Run the architecture command against the draft config.');
    expect(readText(codexPlan.files[1].destination)).toContain('architecture-config-drift');
    expect(readText(claudePlan.files[0].destination)).toContain(
      'Do not leave architecture boundaries empty just because the CLI default is empty.',
    );
    expect(readText(claudePlan.files[0].destination)).toContain('classify the project shape from local evidence');
    expect(readText(claudePlan.files[0].destination)).toContain('quality-gc-architecture-boundaries.md');
    expect(readText(claudePlan.files[2].destination)).toContain('Classify the project shape before choosing rule types.');
    expect(readText(claudePlan.files[2].destination)).toContain('Run the architecture command against the draft config.');
    expect(readText(claudePlan.files[2].destination)).toContain('architecture-config-drift');
  });

  it('installs Codex project-scoped skills into the target repository', () => {
    const root = createNpmRepo();
    const home = tempDir('quality-gc-home-');
    const plan = createSkillInstallPlan({ target: 'codex', scope: 'project', root, home });

    expect(plan.files[0].destination).toBe(path.join(root, '.codex/skills/quality-gc-setup-agent/SKILL.md'));
    expect(plan.files[0]).toMatchObject({ action: 'create', available: true });

    applySkillInstallPlan(plan);
    expect(fileExists(path.join(home, '.codex/skills/quality-gc-setup-agent/SKILL.md'))).toBe(false);
    expect(readText(plan.files[0].destination)).toContain('quality-gc');
  });

  it('refuses to overwrite existing skill files without explicit permission', () => {
    const root = createNpmRepo();
    const home = tempDir('quality-gc-home-');
    const plan = createSkillInstallPlan({ target: 'codex', scope: 'user', root, home });
    writeText(plan.files[0].destination, '# local custom skill\n');
    const conflictPlan = createSkillInstallPlan({ target: 'codex', scope: 'user', root, home });

    expect(conflictPlan.files[0]).toMatchObject({ action: 'conflict' });
    expect(() => applySkillInstallPlan(conflictPlan)).toThrow(/Refusing to overwrite/);

    applySkillInstallPlan(conflictPlan, { overwrite: true });
    expect(readText(conflictPlan.files[0].destination)).toContain('quality-gc');
  });

  it('writes a skill update report when an existing skill is not overwritten', () => {
    const root = createNpmRepo();
    const home = tempDir('quality-gc-home-');
    const plan = createSkillInstallPlan({ target: 'codex', scope: 'project', root, home });
    writeText(plan.files[0].destination, '# local custom skill\n');
    const conflictPlan = createSkillInstallPlan({ target: 'codex', scope: 'project', root, home });
    const report = createSkillUpdateReport(conflictPlan, root);

    expect(report?.path).toBe(path.join(root, '.quality-gc/skill-update-report.md'));
    expect(report?.content).toContain('Quality GC found an existing setup-agent skill');
    expect(report?.content).toContain('--- .codex/skills/quality-gc-setup-agent/SKILL.md');
    expect(report?.content).toContain('-# local custom skill');
    expect(report?.content).toContain('+name: quality-gc-setup-agent');

    const reportPath = writeSkillUpdateReport(conflictPlan, root);
    const written = applySkillInstallPlan(conflictPlan, { skipConflicts: true });

    expect(reportPath).toBe(report?.path);
    expect(readText(plan.files[0].destination)).toBe('# local custom skill\n');
    expect(written).toContain(path.join(root, '.codex/skills/quality-gc-setup-agent/references/architecture-boundary-synthesis.md'));
    expect(readText(reportPath ?? '')).toContain('packaged quality-gc skill');
  });

  it('keeps skill update reports short when installed skill files differ heavily', () => {
    const root = createNpmRepo();
    const home = tempDir('quality-gc-home-');
    const plan = createSkillInstallPlan({ target: 'codex', scope: 'project', root, home });
    writeText(
      plan.files[0].destination,
      Array.from({ length: 80 }, (_, index) => `local custom skill line ${index + 1}`).join('\n') + '\n',
    );
    const report = createSkillUpdateReport(createSkillInstallPlan({ target: 'codex', scope: 'project', root, home }), root);

    expect(report?.content).toContain('Nothing was overwritten.');
    expect(report?.content).toContain('Short change preview:');
    expect(report?.content).toContain('more changed lines hidden');
    expect(report?.content).toContain('-local custom skill line 1');
    expect(report?.content).not.toContain('local custom skill line 80');
  });

  it('keeps install-skill JSON output parseable when an update report is written', async () => {
    const root = createNpmRepo();
    writeText(path.join(root, '.codex/skills/quality-gc-setup-agent/SKILL.md'), '# local custom skill\n');

    const result = await captureStdout(() =>
      main(['install-skill', '--target', 'codex', '--scope', 'project', '--root', root, '--json', '--apply']),
    );

    expect(result.exitCode).toBe(0);
    expect(() => JSON.parse(result.stdout)).not.toThrow();
    expect(fileExists(path.join(root, '.quality-gc/skill-update-report.md'))).toBe(true);
    expect(readText(path.join(root, '.codex/skills/quality-gc-setup-agent/SKILL.md'))).toBe('# local custom skill\n');
  });

  it('appends multiple skill update reports instead of replacing the first diff', () => {
    const root = createNpmRepo();
    const home = tempDir('quality-gc-home-');
    const codexPlan = createSkillInstallPlan({ target: 'codex', scope: 'project', root, home });
    const claudePlan = createSkillInstallPlan({ target: 'claude-code', scope: 'project', root, home });
    writeText(codexPlan.files[0].destination, '# local codex skill\n');
    writeText(claudePlan.files[0].destination, '# local claude skill\n');

    writeSkillUpdateReport(createSkillInstallPlan({ target: 'codex', scope: 'project', root, home }), root);
    const reportPath = writeSkillUpdateReport(
      createSkillInstallPlan({ target: 'claude-code', scope: 'project', root, home }),
      root,
    );
    const reportText = readText(reportPath ?? '');

    expect(reportText).toContain('-# local codex skill');
    expect(reportText).toContain('-# local claude skill');
    expect(reportText).toContain('---\n\n# Quality GC Skill Update');
  });

  it('maps postinstall defaults and terminal choices', () => {
    expect(normalizePostinstallChoice('1')).toBe('codex');
    expect(normalizePostinstallChoice('2')).toBe('claude-code');
    expect(normalizePostinstallChoice('3')).toBe('both');
    expect(normalizePostinstallChoice('4')).toBe('skip');
    expect(normalizeSkillUpdateChoice('1')).toBe('update');
    expect(normalizeSkillUpdateChoice('yes')).toBe('update');
    expect(normalizeSkillUpdateChoice('2')).toBe('diff');
    expect(normalizeSkillUpdateChoice('')).toBe('diff');
    expect(targetsForChoice('both')).toEqual(['codex', 'claude-code']);
    expect(defaultPostinstallChoice({})).toBe('codex');
    expect(defaultPostinstallChoice({ CI: 'true' })).toBe('skip');
    expect(defaultPostinstallChoice({ QUALITY_GC_INSTALL_SKILL: 'skip' })).toBe('skip');
    expect(defaultPostinstallChoice({ QUALITY_GC_INSTALL_SKILL: 'claude-code' })).toBe('claude-code');
    expect(shouldPromptForSkillInstall({ CI: 'true' }, true, true)).toBe(false);
    expect(shouldPromptForSkillInstall({ QUALITY_GC_INSTALL_SKILL: 'skip' }, true, true)).toBe(false);
    expect(shouldPromptForSkillInstall({}, false, true)).toBe(false);
    expect(shouldPromptForSkillInstall({}, false, false, true)).toBe(true);
    expect(shouldPromptForSkillInstall({}, true, true)).toBe(true);
  });
});
