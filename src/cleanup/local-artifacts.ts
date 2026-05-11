import path from 'node:path';
import { runCommand } from '../util/exec.js';
import { trackedArtifactFinding, type CleanupFinding } from './findings.js';

function isCredentialShaped(relativePath: string): boolean {
  const basename = path.basename(relativePath).toLowerCase();
  return basename.startsWith('.env') || basename.includes('secret') || basename.includes('credential') || basename.includes('token');
}

export function listTrackedLocalArtifactFindings(
  root: string,
  artifactRoots: string[],
  reviewedArtifactPaths: string[] = [],
): CleanupFinding[] {
  const result = runCommand('git', ['ls-files'], { cwd: root });
  if (result.status !== 0) {
    return [];
  }

  const roots = artifactRoots.map(value => value.replace(/\/+$/g, ''));
  const reviewed = new Set(reviewedArtifactPaths.map(value => value.split(path.sep).join('/')));
  const findings: CleanupFinding[] = [];
  for (const file of result.stdout.split('\n').filter(Boolean)) {
    const normalized = file.split(path.sep).join('/');
    if (reviewed.has(normalized)) {
      continue;
    }
    const matchedRoot = roots.find(rootName => normalized === rootName || normalized.startsWith(`${rootName}/`));
    if (!matchedRoot) {
      continue;
    }
    findings.push(trackedArtifactFinding(normalized, matchedRoot, isCredentialShaped(normalized)));
  }

  return findings;
}
