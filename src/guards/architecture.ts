import path from 'node:path';
import { listFiles, readText, relativePosix, toPosixPath } from '../util/fs.js';
import type { Violation } from '../util/result.js';
import type { ArchitectureBoundary, QualityGcConfig } from '../config/schema.js';

const IMPORT_RE = /(?:import|export)\s+(?:[^'"]+\s+from\s+)?['"]([^'"]+)['"]/g;

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

export function evaluateArchitecture(root: string, config: QualityGcConfig): Violation[] {
  const violations: Violation[] = [];
  const boundaries = config.rules.architecture.boundaries;

  for (const filePath of listFiles(root, { extensions: ['.ts', '.tsx', '.js', '.jsx'], includeHidden: false })) {
    const relativePath = relativePosix(root, filePath);
    const content = readText(filePath);
    const lines = content.split('\n');

    for (const [lineIndex, line] of lines.entries()) {
      for (const match of line.matchAll(IMPORT_RE)) {
        const imported = resolveImportPath(relativePath, match[1]);
        for (const boundary of boundaries) {
          if (violatesBoundary(relativePath, imported, boundary)) {
            violations.push({
              rule: 'architecture',
              path: relativePath,
              line: lineIndex + 1,
              detail: boundary.message ?? `import from ${imported} violates architecture boundary`,
            });
          }
        }
      }
    }
  }

  return violations;
}
