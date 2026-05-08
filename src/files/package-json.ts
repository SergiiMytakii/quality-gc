import path from 'node:path';
import { fileExists, readJson } from '../util/fs.js';
import type { PlannedTextFile } from './managed-block.js';

interface PackageJson {
  scripts?: Record<string, string>;
  devDependencies?: Record<string, string>;
  [key: string]: unknown;
}

export const QUALITY_GC_SCRIPTS: Record<string, string> = {
  'quality:gc': 'quality-gc run --root .',
  'quality:gc:architecture': 'quality-gc architecture --root .',
  'quality:gc:architecture-drift': 'quality-gc architecture-drift --root .',
  'quality:gc:cleanup-scan:dry-run': 'quality-gc cleanup-scan --root . --dry-run',
  'quality:gc:cleanup-scan:write': 'quality-gc cleanup-scan --root . --write-issues',
  'quality:gc:migrate': 'quality-gc migrate --root .',
};

function isNpmVersionSource(spec: string): boolean {
  const trimmed = spec.trim();
  if (trimmed === '*' || trimmed === 'latest') {
    return true;
  }

  return /^[~^]?\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(trimmed);
}

function fileSpecPath(root: string, spec: string): string | null {
  if (!spec.startsWith('file:')) {
    return null;
  }

  const value = spec.slice('file:'.length);
  return path.resolve(root, value);
}

export function planPackageJsonUpdate(
  root: string,
  packageSource: string,
  options: { allowDependencyUpdate?: boolean; allowNpmVersionUpdate?: boolean } = {},
): PlannedTextFile {
  const relativePath = 'package.json';
  const fullPath = path.join(root, relativePath);
  if (!fileExists(fullPath)) {
    throw new Error('quality-gc setup requires a package.json in the target root.');
  }

  const packageJson = readJson<PackageJson>(fullPath);
  const conflicts: string[] = [];
  const next: PackageJson = {
    ...packageJson,
    scripts: { ...(packageJson.scripts ?? {}) },
    devDependencies: { ...(packageJson.devDependencies ?? {}) },
  };

  for (const [scriptName, scriptValue] of Object.entries(QUALITY_GC_SCRIPTS)) {
    const existing = next.scripts?.[scriptName];
    if (existing && existing !== scriptValue) {
      conflicts.push(`script ${scriptName} already exists with a different value`);
      continue;
    }
    next.scripts![scriptName] = scriptValue;
  }

  const existingDependency = next.devDependencies?.['quality-gc'];
  const equivalentFileSource =
    existingDependency &&
    fileSpecPath(root, existingDependency) !== null &&
    fileSpecPath(root, existingDependency) === fileSpecPath(root, packageSource);
  const safeNpmVersionUpdate =
    Boolean(options.allowNpmVersionUpdate) &&
    existingDependency !== undefined &&
    isNpmVersionSource(existingDependency) &&
    isNpmVersionSource(packageSource);

  if (
    existingDependency &&
    existingDependency !== packageSource &&
    !equivalentFileSource &&
    !safeNpmVersionUpdate &&
    !options.allowDependencyUpdate
  ) {
    conflicts.push(`devDependency quality-gc is ${existingDependency}, not ${packageSource}`);
  } else if (existingDependency && equivalentFileSource) {
    next.devDependencies!['quality-gc'] = existingDependency;
  } else {
    next.devDependencies!['quality-gc'] = packageSource;
  }

  const content = `${JSON.stringify(next, null, 2)}\n`;
  const original = `${JSON.stringify(packageJson, null, 2)}\n`;

  if (conflicts.length > 0) {
    return {
      path: relativePath,
      action: 'conflict',
      reason: conflicts.join('; '),
      content,
    };
  }

  return {
    path: relativePath,
    action: content === original ? 'noop' : 'update',
    reason: 'add quality-gc scripts and package source',
    content,
  };
}
