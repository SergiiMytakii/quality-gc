import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { listFiles, readJson, readText, relativePosix, writeJson } from '../util/fs.js';
import type { Violation } from '../util/result.js';
import { DEFAULT_NO_NEW_ANY_INCLUDE } from '../config/schema.js';
import type { QualityGcConfig } from '../config/schema.js';

export interface NoNewAnyBaseline {
  schemaVersion: 1;
  description: string;
  files: Record<string, number>;
}

function globToRegExp(pattern: string): RegExp {
  const normalized = pattern.replace(/\\/g, '/');
  let regex = '';
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    const next = normalized[index + 1];

    if (char === '*' && next === '*' && normalized[index + 2] === '/') {
      regex += '(?:.*/)?';
      index += 2;
    } else if (char === '*' && next === '*') {
      regex += '.*';
      index += 1;
    } else if (char === '*') {
      regex += '[^/]*';
    } else if (char === '?') {
      regex += '.';
    } else if (char === '{') {
      const end = normalized.indexOf('}', index);
      if (end === -1) {
        regex += '\\{';
      } else {
        regex += `(${normalized
          .slice(index + 1, end)
          .split(',')
          .map(part => part.replace(/[.+^${}()|[\]\\]/g, '\\$&'))
          .join('|')})`;
        index = end;
      }
    } else {
      regex += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${regex}$`);
}

function matchesAny(relativePath: string, patterns: string[]): boolean {
  return patterns.some(pattern => globToRegExp(pattern).test(relativePath));
}

function scriptKindForFile(filePath: string): ts.ScriptKind {
  return filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}

export function countExplicitAny(content: string, scriptKind: ts.ScriptKind = ts.ScriptKind.TS): number {
  const sourceFile = ts.createSourceFile('source.ts', content, ts.ScriptTarget.Latest, true, scriptKind);
  let count = 0;

  function visit(node: ts.Node): void {
    if (node.kind === ts.SyntaxKind.AnyKeyword) {
      count += 1;
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return count;
}

export function collectAnyCounts(
  root: string,
  options: { include?: string[]; exclude?: string[] } = {},
): Record<string, number> {
  const counts: Record<string, number> = {};
  const include = options.include ?? DEFAULT_NO_NEW_ANY_INCLUDE;
  const exclude = options.exclude ?? [];

  for (const filePath of listFiles(root, { extensions: ['.ts', '.tsx'] })) {
    const relativePath = relativePosix(root, filePath);
    if (!matchesAny(relativePath, include) || matchesAny(relativePath, exclude)) {
      continue;
    }

    const count = countExplicitAny(readText(filePath), scriptKindForFile(filePath));
    if (count > 0) {
      counts[relativePath] = count;
    }
  }
  return counts;
}

export function createNoNewAnyBaseline(
  root: string,
  options: { include?: string[]; exclude?: string[] } = {},
): NoNewAnyBaseline {
  return {
    schemaVersion: 1,
    description: 'Accepted explicit TypeScript any baseline for the Quality GC no-new-any ratchet.',
    files: collectAnyCounts(root, options),
  };
}

export function writeNoNewAnyBaseline(root: string, baselineFile: string): void {
  writeJson(path.join(root, baselineFile), createNoNewAnyBaseline(root));
}

export function evaluateNoNewAny(root: string, config: QualityGcConfig): Violation[] {
  const baselinePath = path.join(root, config.rules.noNewAny.baselineFile);
  const baseline = fs.existsSync(baselinePath)
    ? readJson<NoNewAnyBaseline>(baselinePath)
    : ({ schemaVersion: 1, description: 'missing baseline', files: {} } satisfies NoNewAnyBaseline);
  const current = collectAnyCounts(root, {
    include: config.rules.noNewAny.include,
    exclude: config.rules.noNewAny.exclude,
  });
  const violations: Violation[] = [];

  for (const [file, count] of Object.entries(current)) {
    const accepted = baseline.files[file] ?? 0;
    if (count > accepted) {
      violations.push({
        rule: 'no-new-any',
        path: file,
        detail: `explicit any count ${count} exceeds accepted baseline ${accepted}`,
      });
    }
  }

  return violations;
}
