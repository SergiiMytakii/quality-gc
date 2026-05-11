import path from 'node:path';
import { loadConfig } from '../config/load.js';
import { evaluateRules } from '../guards/rules.js';
import { collectArchitectureDriftFindings } from '../cleanup/architecture-drift.js';
import { candidateFindings, type CleanupFinding } from '../cleanup/findings.js';
import { listTrackedLocalArtifactFindings } from '../cleanup/local-artifacts.js';
import { loadExistingIssues, planIssueActions, writeIssueActions, type ExistingIssue } from '../github/issues.js';
import { readJson, writeJson } from '../util/fs.js';

export interface CleanupScanCommandOptions {
  root: string;
  output?: string;
  existingIssuesFile?: string;
  repo?: string;
  writeIssues: boolean;
  json: boolean;
}

function loadExistingIssueFixture(filePath?: string): ExistingIssue[] {
  if (!filePath) {
    return [];
  }
  const payload = readJson<{ issues?: ExistingIssue[] } | ExistingIssue[]>(filePath);
  return Array.isArray(payload) ? payload : (payload.issues ?? []);
}

export async function collectCleanupFindings(root: string): Promise<CleanupFinding[]> {
  const config = await loadConfig(root);
  const ruleResults = evaluateRules(root, config, { includeCandidates: true });
  return [
    ...collectArchitectureDriftFindings(root, config),
    ...candidateFindings(ruleResults),
    ...listTrackedLocalArtifactFindings(
      root,
      config.cleanupScan.trackedLocalArtifactRoots,
      config.cleanupScan.reviewedLocalArtifactPaths ?? [],
    ),
  ];
}

export async function runCleanupScanCommand(options: CleanupScanCommandOptions): Promise<number> {
  const findings = await collectCleanupFindings(options.root);
  if (options.output) {
    writeJson(path.resolve(options.root, options.output), { findings });
  }

  const existingIssues =
    options.writeIssues && options.repo ? loadExistingIssues(options.repo) : loadExistingIssueFixture(options.existingIssuesFile);
  const actions = planIssueActions(findings, existingIssues);
  const payload = { findings, issueActions: actions };

  if (options.json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(`Quality GC Cleanup Scan findings: ${findings.length}`);
    for (const action of actions) {
      console.log(`[${options.writeIssues ? 'write' : 'dry-run'}] ${action.action}: ${action.title}`);
    }
  }

  if (options.writeIssues) {
    if (!options.repo) {
      console.error('--repo is required with --write-issues.');
      return 1;
    }
    writeIssueActions(options.repo, actions);
  }

  return 0;
}
