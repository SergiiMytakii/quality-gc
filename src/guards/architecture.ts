import path from 'node:path';
import ts from 'typescript';
import { listFiles, readText, relativePosix, toPosixPath } from '../util/fs.js';
import type { Violation } from '../util/result.js';
import type { ArchitectureBoundary, QualityGcConfig } from '../config/schema.js';

interface ImportReference {
  specifier: string;
  line: number;
}

function matchesPrefix(file: string, prefixes: string[]): boolean {
  return prefixes.some(prefix => file === prefix || file.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`));
}

function resolveImportPath(file: string, specifier: string): string {
  if (!specifier.startsWith('.')) {
    return specifier;
  }

  return toPosixPath(path.normalize(path.join(path.dirname(file), specifier)));
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
  if (filePath.endsWith('.js')) {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
}

function moduleSpecifierText(node: ts.Expression | undefined): string | null {
  return node && ts.isStringLiteralLike(node) ? node.text : null;
}

function collectImportReferences(fileName: string, content: string): ImportReference[] {
  const sourceFile = ts.createSourceFile(fileName, content, ts.ScriptTarget.Latest, true, scriptKindForFile(fileName));
  const references: ImportReference[] = [];

  function addReference(specifier: string, node: ts.Node): void {
    const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    references.push({ specifier, line: position.line + 1 });
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

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return references;
}

export function evaluateArchitecture(root: string, config: QualityGcConfig): Violation[] {
  const violations: Violation[] = [];
  const boundaries = config.rules.architecture.boundaries;

  for (const filePath of listFiles(root, { extensions: ['.ts', '.tsx', '.js', '.jsx'], includeHidden: false })) {
    const relativePath = relativePosix(root, filePath);
    const content = readText(filePath);

    for (const reference of collectImportReferences(filePath, content)) {
      const imported = resolveImportPath(relativePath, reference.specifier);
      for (const boundary of boundaries) {
        if (violatesBoundary(relativePath, imported, boundary)) {
          violations.push({
            rule: 'architecture',
            path: relativePath,
            line: reference.line,
            detail: boundary.message ?? `import from ${imported} violates architecture boundary`,
          });
        }
      }
    }
  }

  return violations;
}
