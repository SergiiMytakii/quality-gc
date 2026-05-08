import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileExists, readText } from '../util/fs.js';
import { CONFIG_FILE, NO_NEW_ANY_BASELINE_FILE, PACKAGE_VERSION, defaultConfig, renderConfig } from '../config/schema.js';
import type { PlannedTextFile } from '../files/managed-block.js';
import { planManagedTextFile, planOwnedTextFile } from '../files/managed-block.js';
import { planPackageJsonUpdate } from '../files/package-json.js';
import { createNoNewAnyBaseline } from '../guards/no-new-any.js';
import { architectureWorkflow, cleanupScanWorkflow, docsContent } from '../workflows/templates.js';

export interface SetupPlan {
  root: string;
  packageSource: string;
  changes: PlannedTextFile[];
}

export function defaultPackageSource(): string {
  return `^${PACKAGE_VERSION}`;
}

export function createSetupPlan(root: string, options: { packageSource?: string } = {}): SetupPlan {
  const packageSource = options.packageSource ?? defaultPackageSource();
  const config = defaultConfig();
  const baseline = createNoNewAnyBaseline(root);
  const changes: PlannedTextFile[] = [
    planOwnedTextFile(root, CONFIG_FILE, renderConfig(config), 'create Quality GC source-of-truth config'),
    planOwnedTextFile(root, NO_NEW_ANY_BASELINE_FILE, `${JSON.stringify(baseline, null, 2)}\n`, 'create accepted no-new-any baseline'),
    planPackageJsonUpdate(root, packageSource),
    planManagedTextFile(root, '.github/workflows/quality-gc-architecture.yml', architectureWorkflow(), {
      key: 'workflow:architecture',
      syntax: 'yaml',
      reason: 'install Quality GC architecture workflow',
    }),
    planManagedTextFile(root, '.github/workflows/quality-gc-cleanup-scan.yml', cleanupScanWorkflow(), {
      key: 'workflow:cleanup-scan',
      syntax: 'yaml',
      reason: 'install Quality GC cleanup scan workflow',
    }),
    planManagedTextFile(root, 'docs/quality-gc.md', docsContent(), {
      key: 'docs:quality-gc',
      syntax: 'markdown',
      reason: 'document installed Quality GC workflow',
    }),
  ];

  return {
    root: path.resolve(root),
    packageSource,
    changes,
  };
}

export async function createMigrationPlan(root: string, options: { packageSource?: string } = {}): Promise<SetupPlan> {
  const packageSource = options.packageSource ?? defaultPackageSource();
  const configPath = path.join(root, CONFIG_FILE);
  const configChange: PlannedTextFile = fileExists(configPath)
    ? {
        path: CONFIG_FILE,
        action: 'update',
        reason: `update Quality GC installedVersion to ${PACKAGE_VERSION}`,
        content: await renderMigratedConfig(configPath),
      }
    : planOwnedTextFile(root, CONFIG_FILE, renderConfig(defaultConfig()), 'create Quality GC source-of-truth config');

  const baselinePath = path.join(root, NO_NEW_ANY_BASELINE_FILE);
  const baseline = createNoNewAnyBaseline(root);
  const baselineChange: PlannedTextFile = fileExists(baselinePath)
    ? {
        path: NO_NEW_ANY_BASELINE_FILE,
        action: 'noop',
        reason: 'preserve existing accepted no-new-any baseline',
        content: readText(baselinePath),
      }
    : planOwnedTextFile(root, NO_NEW_ANY_BASELINE_FILE, `${JSON.stringify(baseline, null, 2)}\n`, 'create accepted no-new-any baseline');

  return {
    root: path.resolve(root),
    packageSource,
    changes: [
      configChange,
      baselineChange,
      planPackageJsonUpdate(root, packageSource, { allowDependencyUpdate: true }),
      planManagedTextFile(root, '.github/workflows/quality-gc-architecture.yml', architectureWorkflow(), {
        key: 'workflow:architecture',
        syntax: 'yaml',
        reason: 'update Quality GC architecture workflow',
      }),
      planManagedTextFile(root, '.github/workflows/quality-gc-cleanup-scan.yml', cleanupScanWorkflow(), {
        key: 'workflow:cleanup-scan',
        syntax: 'yaml',
        reason: 'update Quality GC cleanup scan workflow',
      }),
      planManagedTextFile(root, 'docs/quality-gc.md', docsContent(), {
        key: 'docs:quality-gc',
        syntax: 'markdown',
        reason: 'update installed Quality GC docs',
      }),
    ],
  };
}

async function renderMigratedConfig(configPath: string): Promise<string> {
  const moduleUrl = pathToFileURL(configPath);
  moduleUrl.search = `mtime=${Date.now()}`;
  const loaded = (await import(moduleUrl.href)) as { default?: unknown };
  const current = loaded.default;
  if (!current || typeof current !== 'object' || (current as { schemaVersion?: unknown }).schemaVersion !== 1) {
    throw new Error('Cannot migrate Quality GC config without schemaVersion: 1.');
  }

  return renderConfig({
    ...(current as ReturnType<typeof defaultConfig>),
    installedVersion: PACKAGE_VERSION,
  });
}

export function summarizePlan(plan: SetupPlan): string {
  const lines = [`Quality GC setup plan for ${plan.root}`, `Package source: ${plan.packageSource}`, ''];
  for (const change of plan.changes) {
    lines.push(`- ${change.action}: ${change.path} (${change.reason})`);
  }

  const conflicts = plan.changes.filter(change => change.action === 'conflict');
  if (conflicts.length > 0) {
    lines.push('', 'Conflicts:', ...conflicts.map(change => `- ${change.path}: ${change.reason}`));
  }

  return `${lines.join('\n')}\n`;
}
