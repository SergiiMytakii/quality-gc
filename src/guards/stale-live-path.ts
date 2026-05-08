import path from 'node:path';
import { listFiles, readText, relativePosix } from '../util/fs.js';
import type { QualityGcConfig } from '../config/schema.js';
import type { Violation } from '../util/result.js';

const ACTIVE_EXTENSIONS = ['.json', '.yml', '.yaml', '.md', '.mjs', '.js', '.ts', '.tsx'];

function isSecretLike(relativePath: string): boolean {
  const name = path.basename(relativePath).toLowerCase();
  return name.startsWith('.env') || name.includes('secret') || name.includes('credential') || name.includes('token');
}

export function evaluateStaleLivePaths(root: string, config: QualityGcConfig): Violation[] {
  const retiredPaths = config.rules.staleLivePath.retiredPaths;
  if (retiredPaths.length === 0) {
    return [];
  }

  const violations: Violation[] = [];
  for (const filePath of listFiles(root, { extensions: ACTIVE_EXTENSIONS, includeHidden: true })) {
    const relativePath = relativePosix(root, filePath);
    if (relativePath.startsWith('.quality-gc/') || isSecretLike(relativePath)) {
      continue;
    }

    const content = readText(filePath);
    const lines = content.split('\n');
    for (const [lineIndex, line] of lines.entries()) {
      for (const retiredPath of retiredPaths) {
        if (line.includes(retiredPath)) {
          violations.push({
            rule: 'stale-live-path',
            path: relativePath,
            line: lineIndex + 1,
            detail: `active file references retired path ${retiredPath}`,
          });
        }
      }
    }
  }

  return violations;
}
