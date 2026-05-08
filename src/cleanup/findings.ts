import path from 'node:path';
import type { RuleEvaluation, Violation } from '../util/result.js';

export interface CleanupEvidence {
  path: string;
  line?: number;
  detail: string;
}

export interface CleanupFinding {
  key: string;
  title: string;
  category: 'candidate-rule' | 'promotion' | 'tracked-artifact';
  severity: 'low' | 'medium' | 'high';
  scope: string;
  suggestedVerification: string;
  deterministicAutofixSafe: boolean;
  evidence: CleanupEvidence[];
}

function sanitizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '');
}

function evidenceFromViolations(violations: Violation[]): CleanupEvidence[] {
  return violations.map(violation => ({
    path: violation.path,
    ...(violation.line ? { line: violation.line } : {}),
    detail: violation.detail,
  }));
}

export function candidateFindings(evaluations: RuleEvaluation[]): CleanupFinding[] {
  const findings: CleanupFinding[] = [];
  for (const evaluation of evaluations) {
    if (evaluation.status !== 'candidate') {
      continue;
    }

    if (evaluation.violations.length > 0) {
      findings.push({
        key: `candidate-${sanitizeKey(evaluation.rule)}`,
        title: `Resolve candidate rule violations for ${evaluation.rule}`,
        category: 'candidate-rule',
        severity: 'medium',
        scope: evaluation.rule,
        suggestedVerification: 'Run quality-gc cleanup-scan --dry-run, then promote the rule only after violations are zero.',
        deterministicAutofixSafe: false,
        evidence: evidenceFromViolations(evaluation.violations),
      });
      continue;
    }

    findings.push({
      key: `promote-${sanitizeKey(evaluation.rule)}`,
      title: `Promote clean candidate rule ${evaluation.rule} to blocking`,
      category: 'promotion',
      severity: 'low',
      scope: evaluation.rule,
      suggestedVerification: 'Change the candidate rule status to blocking and run quality-gc run.',
      deterministicAutofixSafe: true,
      evidence: [
        {
          path: '.quality-gc/quality-gc.config.mjs',
          detail: `candidate rule ${evaluation.rule} has zero current violations`,
        },
      ],
    });
  }

  return findings;
}

export function trackedArtifactFinding(filePath: string, root: string, secretLike: boolean): CleanupFinding {
  const relativePath = filePath.split(path.sep).join('/');
  const key = `${secretLike ? 'credential-artifact' : 'tracked-artifact'}-${sanitizeKey(relativePath)}`;
  return {
    key,
    title: secretLike ? 'Remove credential-shaped tracked local artifact' : 'Remove tracked local artifact',
    category: 'tracked-artifact',
    severity: secretLike ? 'high' : 'low',
    scope: 'tracked local artifact',
    suggestedVerification: 'Remove unintended tracked local artifacts or document why they belong in source control, then rerun quality-gc cleanup-scan --dry-run.',
    deterministicAutofixSafe: false,
    evidence: [
      {
        path: relativePath,
        detail: secretLike
          ? `credential-shaped tracked artifact under ${root}; path-level evidence only, contents were not read`
          : `tracked local artifact under ${root}`,
      },
    ],
  };
}
