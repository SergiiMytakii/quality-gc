export interface Violation {
  rule: string;
  path: string;
  line?: number;
  detail: string;
}

export interface RuleEvaluation {
  rule: string;
  status: 'blocking' | 'candidate' | 'disabled';
  violations: Violation[];
}

export function formatViolation(violation: Violation): string {
  const location = violation.line ? `${violation.path}:${violation.line}` : violation.path;
  return `${location} - ${violation.detail}`;
}
