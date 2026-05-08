import path from 'node:path';
import ts from 'typescript';
import { listFiles, readText, relativePosix, toPosixPath } from '../util/fs.js';
import type { RuleEvaluation, Violation } from '../util/result.js';
import type {
  ArchitectureBoundary,
  ArchitectureDomainBoundary,
  ArchitectureLayerBoundary,
  ArchitectureLayerRule,
  ArchitectureRuleStatus,
  ArchitectureServiceRoot,
  QualityGcConfig,
  RuleStatus,
} from '../config/schema.js';

interface ImportReference {
  specifier: string;
  line: number;
}

interface ResolvedImportReference extends ImportReference {
  rawImported: string;
  imported: string;
}

interface SyntaxReference {
  token: string;
  line: number;
}

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];
const RUNTIME_IMPORT_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs']);

function matchesPrefix(file: string, prefixes: string[]): boolean {
  return prefixes.map(normalizeManifestPath).some(prefix => file === prefix || file.startsWith(`${prefix}/`));
}

function normalizeManifestPath(value: string): string {
  return toPosixPath(value).replace(/\/$/, '');
}

function resolveImportPath(file: string, specifier: string): string {
  if (!specifier.startsWith('.')) {
    return specifier;
  }

  return toPosixPath(path.normalize(path.join(path.dirname(file), specifier)));
}

function buildFileCandidates(basePath: string): string[] {
  const candidates: string[] = [];
  const extension = path.extname(basePath);

  if (extension) {
    candidates.push(basePath);

    if (RUNTIME_IMPORT_EXTENSIONS.has(extension)) {
      const withoutExtension = basePath.slice(0, -extension.length);
      for (const candidateExtension of SOURCE_EXTENSIONS) {
        candidates.push(`${withoutExtension}${candidateExtension}`);
      }
    }
  } else {
    for (const candidateExtension of SOURCE_EXTENSIONS) {
      candidates.push(`${basePath}${candidateExtension}`);
    }
  }

  for (const candidateExtension of SOURCE_EXTENSIONS) {
    candidates.push(path.join(basePath, `index${candidateExtension}`));
  }

  return [...new Set(candidates)];
}

function resolveFileCandidate(root: string, basePath: string): string | null {
  for (const candidate of buildFileCandidates(basePath)) {
    const absoluteCandidate = path.join(root, candidate);
    if (ts.sys.fileExists(absoluteCandidate)) {
      return normalizeManifestPath(candidate);
    }
  }

  return null;
}

function resolveWorkspacePackageImport(
  root: string,
  specifier: string,
  serviceRoots: ArchitectureServiceRoot[],
): string | null {
  const targetService = serviceRoots.find(
    serviceRoot =>
      serviceRoot.packageName &&
      (specifier === serviceRoot.packageName || specifier.startsWith(`${serviceRoot.packageName}/`)),
  );
  if (!targetService?.packageName) {
    return null;
  }

  const subpath = specifier === targetService.packageName ? '' : specifier.slice(targetService.packageName.length + 1);
  const targetPath = normalizeManifestPath(path.posix.join(targetService.path, subpath));
  return resolveFileCandidate(root, targetPath) ?? targetPath;
}

function resolveImportReference(
  root: string,
  file: string,
  reference: ImportReference,
  serviceRoots: ArchitectureServiceRoot[],
): ResolvedImportReference {
  const imported = resolveImportPath(file, reference.specifier);
  if (!reference.specifier.startsWith('.')) {
    return { ...reference, rawImported: imported, imported: resolveWorkspacePackageImport(root, imported, serviceRoots) ?? imported };
  }

  return { ...reference, rawImported: imported, imported: resolveFileCandidate(root, imported) ?? imported };
}

function violatesBoundary(file: string, imported: string, boundary: ArchitectureBoundary): boolean {
  if (!matchesPrefix(file, boundary.from)) {
    return false;
  }

  return boundary.disallowImportsFrom.some(prefix => imported === prefix || imported.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`));
}

function scriptKindForFile(filePath: string): ts.ScriptKind {
  if (filePath.endsWith('.tsx')) {
    return ts.ScriptKind.TSX;
  }
  if (filePath.endsWith('.jsx')) {
    return ts.ScriptKind.JSX;
  }
  if (filePath.endsWith('.js') || filePath.endsWith('.mjs') || filePath.endsWith('.cjs')) {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
}

function moduleSpecifierText(node: ts.Expression | undefined): string | null {
  return node && ts.isStringLiteralLike(node) ? node.text : null;
}

function lineForNode(sourceFile: ts.SourceFile, node: ts.Node): number {
  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return position.line + 1;
}

function collectReferences(fileName: string, content: string): { imports: ImportReference[]; syntax: SyntaxReference[] } {
  const sourceFile = ts.createSourceFile(fileName, content, ts.ScriptTarget.Latest, true, scriptKindForFile(fileName));
  const imports: ImportReference[] = [];
  const syntax: SyntaxReference[] = [];

  function addReference(specifier: string, node: ts.Node): void {
    imports.push({ specifier, line: lineForNode(sourceFile, node) });
  }

  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const specifier = moduleSpecifierText(node.moduleSpecifier);
      if (specifier) {
        addReference(specifier, node);
      }
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const specifier = moduleSpecifierText(node.arguments[0]);
      if (specifier) {
        addReference(specifier, node);
      }
    }

    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'process' &&
      node.name.text === 'env'
    ) {
      syntax.push({ token: 'process.env', line: lineForNode(sourceFile, node) });
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return { imports, syntax };
}

function isTestFile(relativePath: string): boolean {
  return (
    relativePath.includes('/__tests__/') ||
    relativePath.includes('/__test__/') ||
    relativePath.endsWith('.spec.ts') ||
    relativePath.endsWith('.spec.tsx') ||
    relativePath.endsWith('.test.ts') ||
    relativePath.endsWith('.test.tsx')
  );
}

function matchesImportSpecifier(importSpecifier: string, forbiddenImportSpecifier: string): boolean {
  if (forbiddenImportSpecifier.endsWith('/')) {
    return importSpecifier.startsWith(forbiddenImportSpecifier);
  }

  return importSpecifier === forbiddenImportSpecifier || importSpecifier.startsWith(`${forbiddenImportSpecifier}/`);
}

function findMatchingLayer(boundary: ArchitectureLayerBoundary, relativePath: string): { id: string } | null {
  return boundary.layers.find(layer => matchesPrefix(relativePath, layer.paths)) ?? null;
}

function findServiceOwner(serviceRoots: ArchitectureServiceRoot[], relativePath: string): ArchitectureServiceRoot | null {
  return serviceRoots.find(serviceRoot => matchesPrefix(relativePath, [serviceRoot.path])) ?? null;
}

function isDomainPublicEntryPoint(domain: ArchitectureDomainBoundary, imported: string, rawImported: string): boolean {
  const publicEntryPoints = (domain.publicEntryPoints ?? []).map(normalizeManifestPath);
  return publicEntryPoints.includes(imported) || publicEntryPoints.includes(rawImported);
}

function boundaryRuleName(kind: string, id: string | undefined): string {
  return id ? `architecture:${kind}:${id}` : 'architecture';
}

function layerRuleName(boundary: ArchitectureLayerBoundary, layerRule: ArchitectureLayerRule): string {
  const base = boundaryRuleName('layer-boundary', boundary.id);
  if (boundary.rules.length <= 1) {
    return base;
  }
  return `${base}:${layerRule.from}-to-${layerRule.disallow.join('-')}`;
}

function effectiveArchitectureStatus(globalStatus: RuleStatus, entry?: ArchitectureRuleStatus, parent?: ArchitectureRuleStatus): RuleStatus {
  if (globalStatus === 'disabled') {
    return 'disabled';
  }
  return entry?.status ?? parent?.status ?? globalStatus;
}

function addArchitectureViolation(
  evaluations: Map<string, RuleEvaluation>,
  status: RuleStatus,
  rule: string,
  violation: Violation,
): void {
  if (status === 'disabled') {
    return;
  }
  const key = `${status}:${rule}`;
  const evaluation = evaluations.get(key) ?? { rule, status, violations: [] };
  evaluation.violations.push(violation);
  evaluations.set(key, evaluation);
}

function ensureArchitectureEvaluation(evaluations: Map<string, RuleEvaluation>, status: RuleStatus, rule: string): void {
  if (status === 'disabled') {
    return;
  }
  const key = `${status}:${rule}`;
  if (!evaluations.has(key)) {
    evaluations.set(key, { rule, status, violations: [] });
  }
}

export function evaluateArchitectureRules(
  root: string,
  config: QualityGcConfig,
  options: { includeCandidates: boolean } = { includeCandidates: true },
): RuleEvaluation[] {
  const evaluations = new Map<string, RuleEvaluation>();
  const architecture = config.rules.architecture;
  const boundaries = architecture.boundaries;
  const serviceRoots = (architecture.serviceRoots ?? []).map(serviceRoot => ({
    ...serviceRoot,
    path: normalizeManifestPath(serviceRoot.path),
  }));
  const domains = (architecture.domains ?? []).map(domain => ({
    ...domain,
    root: normalizeManifestPath(domain.root),
    publicEntryPoints: (domain.publicEntryPoints ?? []).map(normalizeManifestPath),
    internalConsumerRoots: (domain.internalConsumerRoots ?? []).map(normalizeManifestPath),
  }));
  const pathImportBoundaries = architecture.pathImportBoundaries ?? [];
  const layerBoundaries = architecture.layerBoundaries ?? [];
  const externalImportBoundaries = architecture.externalImportBoundaries ?? [];
  const syntaxBoundaries = architecture.syntaxBoundaries ?? [];

  for (const boundary of boundaries) {
    const status = effectiveArchitectureStatus(architecture.status, boundary);
    if (status === 'candidate' && !options.includeCandidates) {
      continue;
    }
    ensureArchitectureEvaluation(evaluations, status, boundaryRuleName('boundary', undefined));
  }
  for (const serviceRoot of serviceRoots) {
    const status = effectiveArchitectureStatus(architecture.status, serviceRoot);
    if (status === 'candidate' && !options.includeCandidates) {
      continue;
    }
    ensureArchitectureEvaluation(evaluations, status, 'architecture:service-root-boundary');
  }
  for (const domain of domains) {
    const status = effectiveArchitectureStatus(architecture.status, domain);
    if (status === 'candidate' && !options.includeCandidates) {
      continue;
    }
    ensureArchitectureEvaluation(evaluations, status, boundaryRuleName('domain-public-entrypoint', domain.id));
  }
  for (const boundary of pathImportBoundaries) {
    const status = effectiveArchitectureStatus(architecture.status, boundary);
    if (status === 'candidate' && !options.includeCandidates) {
      continue;
    }
    ensureArchitectureEvaluation(evaluations, status, boundaryRuleName('path-import-boundary', boundary.id));
  }
  for (const boundary of externalImportBoundaries) {
    const status = effectiveArchitectureStatus(architecture.status, boundary);
    if (status === 'candidate' && !options.includeCandidates) {
      continue;
    }
    ensureArchitectureEvaluation(evaluations, status, boundaryRuleName('external-import-boundary', boundary.id));
  }
  for (const boundary of syntaxBoundaries) {
    const status = effectiveArchitectureStatus(architecture.status, boundary);
    if (status === 'candidate' && !options.includeCandidates) {
      continue;
    }
    ensureArchitectureEvaluation(evaluations, status, boundaryRuleName('syntax-boundary', boundary.id));
  }
  for (const boundary of layerBoundaries) {
    for (const layerRule of boundary.rules) {
      const status = effectiveArchitectureStatus(architecture.status, layerRule, boundary);
      if (status === 'candidate' && !options.includeCandidates) {
        continue;
      }
      ensureArchitectureEvaluation(evaluations, status, layerRuleName(boundary, layerRule));
    }
  }

  for (const filePath of listFiles(root, { extensions: SOURCE_EXTENSIONS, includeHidden: false })) {
    const relativePath = relativePosix(root, filePath);
    const content = readText(filePath);
    const references = collectReferences(filePath, content);

    for (const boundary of syntaxBoundaries) {
      if (!boundary.includeTests && isTestFile(relativePath)) {
        continue;
      }

      if (!matchesPrefix(relativePath, boundary.sourcePaths) || matchesPrefix(relativePath, boundary.exceptPaths ?? [])) {
        continue;
      }

      for (const syntaxReference of references.syntax) {
        if (boundary.forbiddenSyntax.includes(syntaxReference.token)) {
          const rule = boundaryRuleName('syntax-boundary', boundary.id);
          const status = effectiveArchitectureStatus(architecture.status, boundary);
          if (status === 'candidate' && !options.includeCandidates) {
            continue;
          }
          addArchitectureViolation(evaluations, status, rule, {
            rule,
            path: relativePath,
            line: syntaxReference.line,
            detail: boundary.message ?? `${syntaxReference.token} violates architecture boundary`,
          });
        }
      }
    }

    for (const reference of references.imports) {
      const resolvedReference = resolveImportReference(root, relativePath, reference, serviceRoots);
      const imported = resolvedReference.imported;
      for (const boundary of boundaries) {
        if (
          violatesBoundary(relativePath, imported, boundary) ||
          violatesBoundary(relativePath, resolvedReference.rawImported, boundary)
        ) {
          const rule = boundaryRuleName('boundary', undefined);
          const status = effectiveArchitectureStatus(architecture.status, boundary);
          if (status === 'candidate' && !options.includeCandidates) {
            continue;
          }
          addArchitectureViolation(evaluations, status, rule, {
            rule,
            path: relativePath,
            line: resolvedReference.line,
            detail: boundary.message ?? `import from ${imported} violates architecture boundary`,
          });
        }
      }

      const fromService = findServiceOwner(serviceRoots, relativePath);
      const toService = findServiceOwner(serviceRoots, imported);
      if (fromService && toService && fromService.id !== toService.id && toService.public !== true) {
        const rule = 'architecture:service-root-boundary';
        const status = effectiveArchitectureStatus(architecture.status, toService);
        if (!(status === 'candidate' && !options.includeCandidates)) {
          addArchitectureViolation(evaluations, status, rule, {
            rule,
            path: relativePath,
            line: resolvedReference.line,
            detail: `${fromService.id} must not import ${toService.id} internals directly`,
          });
        }
      }

      for (const domain of domains) {
        const fromInsideDomain = matchesPrefix(relativePath, [domain.root]);
        const fromAllowedInternalConsumer = matchesPrefix(relativePath, domain.internalConsumerRoots ?? []);
        const toInsideDomain = matchesPrefix(imported, [domain.root]);
        if (
          !fromInsideDomain &&
          !fromAllowedInternalConsumer &&
          toInsideDomain &&
          !isDomainPublicEntryPoint(domain, imported, resolvedReference.rawImported)
        ) {
          const rule = boundaryRuleName('domain-public-entrypoint', domain.id);
          const status = effectiveArchitectureStatus(architecture.status, domain);
          if (status === 'candidate' && !options.includeCandidates) {
            continue;
          }
          addArchitectureViolation(evaluations, status, rule, {
            rule,
            path: relativePath,
            line: resolvedReference.line,
            detail: domain.message ?? `import from ${imported} violates domain public entrypoint`,
          });
        }
      }

      for (const boundary of externalImportBoundaries) {
        if (
          matchesPrefix(relativePath, boundary.sourcePaths) &&
          !matchesPrefix(relativePath, boundary.exceptPaths ?? []) &&
          boundary.forbiddenImportSpecifiers.some(forbidden => matchesImportSpecifier(resolvedReference.specifier, forbidden))
        ) {
          const rule = boundaryRuleName('external-import-boundary', boundary.id);
          const status = effectiveArchitectureStatus(architecture.status, boundary);
          if (status === 'candidate' && !options.includeCandidates) {
            continue;
          }
          addArchitectureViolation(evaluations, status, rule, {
            rule,
            path: relativePath,
            line: resolvedReference.line,
            detail: boundary.message ?? `import from ${resolvedReference.specifier} violates architecture boundary`,
          });
        }
      }

      for (const boundary of pathImportBoundaries) {
        if (matchesPrefix(relativePath, boundary.fromPaths) && matchesPrefix(imported, boundary.targetPaths)) {
          const rule = boundaryRuleName('path-import-boundary', boundary.id);
          const status = effectiveArchitectureStatus(architecture.status, boundary);
          if (status === 'candidate' && !options.includeCandidates) {
            continue;
          }
          addArchitectureViolation(evaluations, status, rule, {
            rule,
            path: relativePath,
            line: resolvedReference.line,
            detail: boundary.message ?? `import from ${imported} violates architecture boundary`,
          });
        }
      }

      for (const boundary of layerBoundaries) {
        const fromLayer = findMatchingLayer(boundary, relativePath);
        const toLayer = findMatchingLayer(boundary, imported);
        if (!fromLayer || !toLayer || fromLayer.id === toLayer.id) {
          continue;
        }

        for (const layerRule of boundary.rules) {
          if (layerRule.from === fromLayer.id && layerRule.disallow.includes(toLayer.id)) {
            const rule = layerRuleName(boundary, layerRule);
            const status = effectiveArchitectureStatus(architecture.status, layerRule, boundary);
            if (status === 'candidate' && !options.includeCandidates) {
              continue;
            }
            addArchitectureViolation(evaluations, status, rule, {
              rule,
              path: relativePath,
              line: resolvedReference.line,
              detail: layerRule.message ?? `import from ${imported} violates architecture boundary`,
            });
          }
        }
      }
    }
  }

  return [...evaluations.values()].filter(evaluation => options.includeCandidates || evaluation.status === 'blocking');
}

export function evaluateArchitecture(root: string, config: QualityGcConfig): Violation[] {
  return evaluateArchitectureRules(root, config, { includeCandidates: true }).flatMap(evaluation => evaluation.violations);
}
