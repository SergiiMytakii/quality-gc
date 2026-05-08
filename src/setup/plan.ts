import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileExists, listFiles, readText, relativePosix } from '../util/fs.js';
import {
  CONFIG_FILE,
  DEFAULT_NO_NEW_ANY_INCLUDE,
  DEFAULT_NO_NEW_ANY_EXCLUDE,
  NO_NEW_ANY_BASELINE_FILE,
  PACKAGE_VERSION,
  defaultConfig,
  renderConfig,
} from '../config/schema.js';
import type { PlannedTextFile } from '../files/managed-block.js';
import { planManagedTextFile, planOwnedTextFile } from '../files/managed-block.js';
import { planPackageJsonUpdate } from '../files/package-json.js';
import { createNoNewAnyBaseline } from '../guards/no-new-any.js';
import { architectureWorkflow, cleanupScanWorkflow, docsContent } from '../workflows/templates.js';
import type { WorkflowPackageManager } from '../workflows/templates.js';

export interface SetupPlan {
  root: string;
  packageSource: string;
  changes: PlannedTextFile[];
}

export function defaultPackageSource(): string {
  return `^${PACKAGE_VERSION}`;
}

interface PackageJson {
  packageManager?: unknown;
}

const LEGACY_SRC_ONLY_NO_NEW_ANY_EXCLUDE = [
  'src/**/__tests__/**',
  'src/**/*.spec.ts',
  'src/**/*.spec.tsx',
  'src/**/*.test.ts',
  'src/**/*.test.tsx',
  'src/**/scripts/**',
];

function sameStringArray(left: unknown, right: string[]): boolean {
  return (
    Array.isArray(left) &&
    left.length === right.length &&
    left.every((value, index) => typeof value === 'string' && value === right[index])
  );
}

function detectPackageManager(root: string): WorkflowPackageManager {
  const packageJsonPath = path.join(root, 'package.json');
  if (fileExists(packageJsonPath)) {
    const packageJson = JSON.parse(readText(packageJsonPath)) as PackageJson;
    if (typeof packageJson.packageManager === 'string' && packageJson.packageManager.startsWith('pnpm@')) {
      return 'pnpm';
    }
  }

  if (fileExists(path.join(root, 'pnpm-lock.yaml'))) {
    return 'pnpm';
  }

  return 'npm';
}

function createConfigForRoot(root: string): ReturnType<typeof defaultConfig> {
  const config = defaultConfig();
  config.rules.noNewAny.include = detectTypeScriptSourceIncludes(root);
  return config;
}

function detectTypeScriptSourceIncludes(root: string): string[] {
  const ignoredTopLevelDirs = new Set([
    'build',
    'coverage',
    'dist',
    'generated',
    'node_modules',
    'out',
    'storybook-static',
  ]);
  const sourceRoots = new Set<string>();
  let hasRootSourceFile = false;

  for (const filePath of listFiles(root, { extensions: ['.ts', '.tsx'] })) {
    const relativePath = relativePosix(root, filePath);
    const [topLevelDir] = relativePath.split('/');
    if (!topLevelDir || topLevelDir.startsWith('.') || ignoredTopLevelDirs.has(topLevelDir)) {
      continue;
    }
    if (relativePath === topLevelDir) {
      hasRootSourceFile = true;
      continue;
    }
    sourceRoots.add(topLevelDir);
  }

  const includes = [...sourceRoots].sort().map(sourceRoot => `${sourceRoot}/**/*.{ts,tsx}`);
  if (hasRootSourceFile) {
    includes.unshift('*.{ts,tsx}');
  }

  return includes.length > 0 ? includes : [...DEFAULT_NO_NEW_ANY_INCLUDE];
}

export function createSetupPlan(root: string, options: { packageSource?: string } = {}): SetupPlan {
  const packageSource = options.packageSource ?? defaultPackageSource();
  const packageManager = detectPackageManager(root);
  const config = createConfigForRoot(root);
  const baseline = createNoNewAnyBaseline(root, {
    include: config.rules.noNewAny.include,
    exclude: config.rules.noNewAny.exclude,
  });
  const changes: PlannedTextFile[] = [
    planOwnedTextFile(root, CONFIG_FILE, renderConfig(config), 'create Quality GC source-of-truth config'),
    planOwnedTextFile(root, NO_NEW_ANY_BASELINE_FILE, `${JSON.stringify(baseline, null, 2)}\n`, 'create accepted no-new-any baseline'),
    planPackageJsonUpdate(root, packageSource, { allowNpmVersionUpdate: true }),
    planManagedTextFile(root, '.github/workflows/quality-gc-architecture.yml', architectureWorkflow(packageManager), {
      key: 'workflow:architecture',
      syntax: 'yaml',
      reason: 'install Quality GC architecture workflow',
    }),
    planManagedTextFile(root, '.github/workflows/quality-gc-cleanup-scan.yml', cleanupScanWorkflow(packageManager), {
      key: 'workflow:cleanup-scan',
      syntax: 'yaml',
      reason: 'install Quality GC cleanup scan workflow',
    }),
    planManagedTextFile(root, 'docs/quality-gc.md', docsContent(packageManager), {
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
  const packageManager = detectPackageManager(root);
  const config = createConfigForRoot(root);
  const configPath = path.join(root, CONFIG_FILE);
  const configChange: PlannedTextFile = fileExists(configPath)
    ? {
        path: CONFIG_FILE,
        action: 'update',
        reason: `update Quality GC installedVersion to ${PACKAGE_VERSION}`,
        content: await renderMigratedConfig(configPath, config),
      }
    : planOwnedTextFile(root, CONFIG_FILE, renderConfig(config), 'create Quality GC source-of-truth config');

  const baselinePath = path.join(root, NO_NEW_ANY_BASELINE_FILE);
  const baseline = createNoNewAnyBaseline(root, {
    include: config.rules.noNewAny.include,
    exclude: config.rules.noNewAny.exclude,
  });
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
      planManagedTextFile(root, '.github/workflows/quality-gc-architecture.yml', architectureWorkflow(packageManager), {
        key: 'workflow:architecture',
        syntax: 'yaml',
        reason: 'update Quality GC architecture workflow',
      }),
      planManagedTextFile(root, '.github/workflows/quality-gc-cleanup-scan.yml', cleanupScanWorkflow(packageManager), {
        key: 'workflow:cleanup-scan',
        syntax: 'yaml',
        reason: 'update Quality GC cleanup scan workflow',
      }),
      planManagedTextFile(root, 'docs/quality-gc.md', docsContent(packageManager), {
        key: 'docs:quality-gc',
        syntax: 'markdown',
        reason: 'update installed Quality GC docs',
      }),
    ],
  };
}

async function renderMigratedConfig(configPath: string, inferredConfig: ReturnType<typeof defaultConfig>): Promise<string> {
  const moduleUrl = pathToFileURL(configPath);
  moduleUrl.search = `mtime=${Date.now()}`;
  const loaded = (await import(moduleUrl.href)) as { default?: unknown };
  const current = loaded.default;
  if (!current || typeof current !== 'object' || (current as { schemaVersion?: unknown }).schemaVersion !== 1) {
    throw new Error('Cannot migrate Quality GC config without schemaVersion: 1.');
  }

  const migrated = current as ReturnType<typeof defaultConfig>;
  const noNewAny = migrated.rules.noNewAny;
  if (
    sameStringArray(noNewAny.include, DEFAULT_NO_NEW_ANY_INCLUDE) &&
    !sameStringArray(inferredConfig.rules.noNewAny.include, DEFAULT_NO_NEW_ANY_INCLUDE)
  ) {
    noNewAny.include = [...inferredConfig.rules.noNewAny.include];
  }
  if (
    sameStringArray(noNewAny.exclude, LEGACY_SRC_ONLY_NO_NEW_ANY_EXCLUDE) ||
    sameStringArray(noNewAny.exclude, DEFAULT_NO_NEW_ANY_EXCLUDE)
  ) {
    noNewAny.exclude = [...inferredConfig.rules.noNewAny.exclude];
  }

  return renderConfig({
    ...migrated,
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
