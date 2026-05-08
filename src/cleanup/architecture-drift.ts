import path from 'node:path';
import { listFiles, relativePosix, toPosixPath } from '../util/fs.js';
import type { QualityGcConfig } from '../config/schema.js';
import type { CleanupFinding } from './findings.js';

interface ArchitectureCandidateRoot {
  path: string;
  kind: 'package-root' | 'source-module';
}

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'];
const WORKSPACE_ROOTS = new Set(['apps', 'packages', 'services']);

function normalizePath(value: string): string {
  return toPosixPath(value).replace(/\/$/, '');
}

function isInPath(candidate: string, parent: string): boolean {
  return candidate === parent || candidate.startsWith(`${parent}/`);
}

function isTestOrGeneratedSource(relativePath: string): boolean {
  return (
    relativePath.startsWith('.github/') ||
    relativePath.startsWith('.quality-gc/') ||
    relativePath.startsWith('test/') ||
    relativePath.includes('/__tests__/') ||
    relativePath.includes('/__test__/') ||
    relativePath.endsWith('.spec.ts') ||
    relativePath.endsWith('.spec.tsx') ||
    relativePath.endsWith('.test.ts') ||
    relativePath.endsWith('.test.tsx') ||
    relativePath.endsWith('.d.ts')
  );
}

function collectSourceFiles(root: string): string[] {
  return listFiles(root, { extensions: SOURCE_EXTENSIONS })
    .map(filePath => relativePosix(root, filePath))
    .filter(relativePath => !isTestOrGeneratedSource(relativePath));
}

function collectPackageRoots(root: string, sourceFiles: string[]): string[] {
  return listFiles(root, { extensions: ['.json'] })
    .map(filePath => relativePosix(root, filePath))
    .filter(relativePath => path.posix.basename(relativePath) === 'package.json')
    .map(relativePath => path.posix.dirname(relativePath))
    .filter(packageRoot => packageRoot !== '.')
    .filter(packageRoot => sourceFiles.some(sourceFile => isInPath(sourceFile, packageRoot)))
    .sort();
}

function sourceModuleFromFile(sourceFile: string, packageRoots: string[]): string | null {
  const packageRoot = packageRoots.find(candidate => isInPath(sourceFile, candidate));
  if (packageRoot) {
    const suffix = sourceFile.slice(packageRoot.length + 1);
    const parts = suffix.split('/');
    if (parts[0] === 'src' && parts.length >= 3) {
      return `${packageRoot}/src/${parts[1]}`;
    }
    return null;
  }

  const parts = sourceFile.split('/');
  if (parts[0] === 'src' && parts.length >= 3) {
    return `src/${parts[1]}`;
  }
  if (WORKSPACE_ROOTS.has(parts[0]) && parts.length >= 3) {
    return `${parts[0]}/${parts[1]}`;
  }

  return null;
}

function uniqueCandidates(candidates: ArchitectureCandidateRoot[]): ArchitectureCandidateRoot[] {
  const seen = new Set<string>();
  const unique: ArchitectureCandidateRoot[] = [];
  for (const candidate of candidates.sort((left, right) => left.path.localeCompare(right.path))) {
    const key = `${candidate.kind}:${candidate.path}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(candidate);
    }
  }
  return unique;
}

function collectCandidateRoots(root: string): ArchitectureCandidateRoot[] {
  const sourceFiles = collectSourceFiles(root);
  const packageRoots = collectPackageRoots(root, sourceFiles);
  const candidates: ArchitectureCandidateRoot[] = packageRoots.map(packageRoot => ({
    path: packageRoot,
    kind: 'package-root',
  }));

  for (const sourceFile of sourceFiles) {
    const sourceModule = sourceModuleFromFile(sourceFile, packageRoots);
    if (sourceModule) {
      candidates.push({ path: sourceModule, kind: 'source-module' });
    }
  }

  return uniqueCandidates(candidates);
}

function architectureConfiguredPaths(config: QualityGcConfig): string[] {
  const architecture = config.rules.architecture;
  const paths: string[] = [];

  for (const boundary of architecture.boundaries) {
    paths.push(...boundary.from, ...boundary.disallowImportsFrom);
  }
  for (const serviceRoot of architecture.serviceRoots ?? []) {
    paths.push(serviceRoot.path);
  }
  for (const domain of architecture.domains ?? []) {
    paths.push(domain.root, ...(domain.publicEntryPoints ?? []), ...(domain.internalConsumerRoots ?? []));
  }
  for (const boundary of architecture.pathImportBoundaries ?? []) {
    paths.push(...boundary.fromPaths, ...boundary.targetPaths);
  }
  for (const boundary of architecture.layerBoundaries ?? []) {
    for (const layer of boundary.layers) {
      paths.push(...layer.paths);
    }
  }
  for (const boundary of architecture.externalImportBoundaries ?? []) {
    paths.push(...boundary.sourcePaths, ...(boundary.exceptPaths ?? []));
  }
  for (const boundary of architecture.syntaxBoundaries ?? []) {
    paths.push(...boundary.sourcePaths, ...(boundary.exceptPaths ?? []));
  }

  return [...new Set(paths.map(normalizePath).filter(Boolean))].sort();
}

function candidateCovered(candidate: ArchitectureCandidateRoot, configuredPaths: string[]): boolean {
  return configuredPaths.some(configuredPath => isInPath(candidate.path, configuredPath) || isInPath(configuredPath, candidate.path));
}

export function collectArchitectureDriftFindings(root: string, config: QualityGcConfig): CleanupFinding[] {
  if (config.rules.architecture.status === 'disabled') {
    return [];
  }

  const configuredPaths = architectureConfiguredPaths(config);
  const uncovered = collectCandidateRoots(root).filter(candidate => !candidateCovered(candidate, configuredPaths));
  if (uncovered.length === 0) {
    return [];
  }

  return [
    {
      key: 'architecture-config-drift',
      title: 'Refresh architecture boundary config',
      category: 'architecture-drift',
      severity: 'medium',
      scope: 'architecture boundaries',
      suggestedVerification:
        'Run the Quality GC setup-agent architecture refresh, review the config diff, then run quality-gc architecture and quality-gc cleanup-scan --dry-run.',
      deterministicAutofixSafe: false,
      evidence: uncovered.slice(0, 20).map(candidate => ({
        path: candidate.path,
        detail: `${candidate.kind} is not covered by current architecture boundary config`,
      })),
    },
  ];
}
