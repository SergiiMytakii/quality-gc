import { runCommand } from '../util/exec.js';
import type { CleanupFinding } from '../cleanup/findings.js';

export const ISSUE_PREFIX = '[Quality GC Cleanup]';

export interface ExistingIssue {
  number: number;
  title: string;
  body?: string;
}

export interface IssueAction {
  action: 'create' | 'update' | 'close';
  issueNumber?: number;
  title: string;
  body: string;
  labels: string[];
}

export function issueMarker(finding: CleanupFinding): string {
  return `<!-- quality-gc-cleanup:${finding.key} -->`;
}

export function issueTitle(finding: CleanupFinding): string {
  return `${ISSUE_PREFIX}[${finding.key}] ${finding.title}`;
}

export function issueLabels(finding: CleanupFinding): string[] {
  const categoryLabel =
    finding.category === 'promotion'
      ? 'quality-gc:promotion'
      : finding.category === 'tracked-artifact'
        ? 'quality-gc:tracked-artifact'
        : finding.category === 'architecture-drift'
          ? 'quality-gc:architecture-drift'
          : 'quality-gc:candidate-rule';
  return ['quality-gc', 'cleanup', categoryLabel];
}

export function issueBody(finding: CleanupFinding): string {
  const evidence = finding.evidence.map(item => {
    const location = item.line ? `${item.path}:${item.line}` : item.path;
    return `- ${location} - ${item.detail}`;
  });

  return [
    issueMarker(finding),
    '',
    '## Quality GC Cleanup Scan Finding',
    '',
    `Category: ${finding.category}`,
    `Severity: ${finding.severity}`,
    `Scope: ${finding.scope}`,
    `Deterministic autofix safe: ${finding.deterministicAutofixSafe ? 'yes' : 'no'}`,
    '',
    '## Evidence',
    '',
    ...evidence,
    '',
    '## Suggested Verification',
    '',
    finding.suggestedVerification,
    '',
    '## Policy',
    '',
    'This finding is issue-first. Do not open a broad cleanup PR unless the cleanup is deterministic, narrow, and low-risk.',
  ].join('\n');
}

export function findExistingIssue(finding: CleanupFinding, existingIssues: ExistingIssue[]): ExistingIssue | null {
  const marker = issueMarker(finding);
  const titlePrefix = `${ISSUE_PREFIX}[${finding.key}]`;
  return (
    existingIssues.find(issue => typeof issue.body === 'string' && issue.body.includes(marker)) ??
    existingIssues.find(issue => issue.title.startsWith(titlePrefix)) ??
    null
  );
}

function extractIssueKey(issue: ExistingIssue): string | null {
  const markerMatch = issue.body?.match(/<!-- quality-gc-cleanup:([a-z0-9-]+) -->/);
  if (markerMatch) {
    return markerMatch[1];
  }

  const titleMatch = issue.title.match(/^\[Quality GC Cleanup]\[([a-z0-9-]+)]/);
  return titleMatch?.[1] ?? null;
}

export function planIssueActions(findings: CleanupFinding[], existingIssues: ExistingIssue[] = []): IssueAction[] {
  const findingKeys = new Set(findings.map(finding => finding.key));
  const upsertActions: IssueAction[] = findings.map(finding => {
    const existing = findExistingIssue(finding, existingIssues);
    return {
      action: existing ? 'update' : 'create',
      ...(existing ? { issueNumber: existing.number } : {}),
      title: issueTitle(finding),
      body: issueBody(finding),
      labels: issueLabels(finding),
    };
  });

  const closeActions: IssueAction[] = existingIssues
    .map(issue => ({ issue, key: extractIssueKey(issue) }))
    .filter(({ key }) => key !== null && !findingKeys.has(key))
    .map(({ issue, key }) => ({
      action: 'close',
      issueNumber: issue.number,
      title: issue.title,
      body: issue.body ?? `Resolved Quality GC cleanup finding ${key}.`,
      labels: [],
    }));

  return [...upsertActions, ...closeActions];
}

export function loadExistingIssues(repo: string): ExistingIssue[] {
  const output = runCommand('gh', ['issue', 'list', '--repo', repo, '--state', 'open', '--limit', '200', '--json', 'number,title,body']);
  if (output.status !== 0) {
    throw new Error(`Could not list GitHub issues: ${output.stderr}`);
  }
  return JSON.parse(output.stdout) as ExistingIssue[];
}

export function writeIssueActions(repo: string, actions: IssueAction[]): void {
  if (!process.env.GH_TOKEN) {
    throw new Error('GH_TOKEN is required for --write-issues mode.');
  }

  for (const action of actions) {
    const result =
      action.action === 'close'
        ? runCommand('gh', ['issue', 'close', String(action.issueNumber), '--repo', repo, '--comment', 'Resolved by Quality GC Cleanup Scan: finding is no longer present.'])
        : action.action === 'update'
          ? runCommand('gh', [
              'issue',
              'edit',
              String(action.issueNumber),
              '--repo',
              repo,
              '--title',
              action.title,
              '--body',
              action.body,
              '--add-label',
              action.labels.join(','),
            ])
          : runCommand('gh', [
            'issue',
            'create',
            '--repo',
            repo,
            '--title',
            action.title,
            '--body',
            action.body,
            ...action.labels.flatMap(label => ['--label', label]),
            ]);

    if (result.status !== 0) {
      throw new Error(`Could not ${action.action} GitHub issue: ${result.stderr}`);
    }
  }
}
