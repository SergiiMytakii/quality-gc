import path from 'node:path';
import { fileExists, findPackageRoot, readText, writeText } from '../util/fs.js';

export type SkillTarget = 'codex' | 'claude-code';
export type SkillScope = 'user' | 'project';
export type SkillInstallAction = 'create' | 'noop' | 'conflict';

export interface SkillInstallPlan {
  target: SkillTarget;
  scope: SkillScope;
  files: SkillInstallFile[];
  fallbackInstructions: string[];
}

export interface SkillInstallFile {
  source: string;
  destination: string;
  available: boolean;
  action: SkillInstallAction;
  reason: string;
}

export interface ApplySkillInstallOptions {
  overwrite?: boolean;
  skipConflicts?: boolean;
}

export interface SkillUpdateReport {
  path: string;
  content: string;
}

function homeDir(home?: string): string {
  return home ?? process.env.HOME ?? process.cwd();
}

function packageRoot(): string {
  return findPackageRoot(import.meta.url);
}

function planSkillFile(source: string, destination: string, available: boolean): SkillInstallFile {
  if (!fileExists(destination)) {
    return {
      source,
      destination,
      available,
      action: 'create',
      reason: 'skill file does not exist',
    };
  }

  if (readText(destination) === readText(source)) {
    return {
      source,
      destination,
      available,
      action: 'noop',
      reason: 'already up to date',
    };
  }

  return {
    source,
    destination,
    available,
    action: 'conflict',
    reason: 'existing skill file differs',
  };
}

export function createSkillInstallPlan(options: {
  target: SkillTarget;
  scope: SkillScope;
  root: string;
  home?: string;
}): SkillInstallPlan {
  const pkgRoot = packageRoot();
  const home = homeDir(options.home);

  if (options.target === 'codex') {
    const codexHome =
      options.scope === 'project'
        ? path.join(options.root, '.codex')
        : process.env.CODEX_HOME ?? path.join(home, '.codex');
    const source = path.join(pkgRoot, 'skills', 'codex', 'SKILL.md');
    const destination = path.join(codexHome, 'skills', 'quality-gc-setup-agent', 'SKILL.md');
    const referenceSource = path.join(pkgRoot, 'skills', 'references', 'architecture-boundary-synthesis.md');
    const referenceDestination = path.join(
      codexHome,
      'skills',
      'quality-gc-setup-agent',
      'references',
      'architecture-boundary-synthesis.md',
    );
    return {
      target: options.target,
      scope: options.scope,
      files: [
        planSkillFile(source, destination, fileExists(path.dirname(path.dirname(destination))) || options.scope === 'project'),
        planSkillFile(
          referenceSource,
          referenceDestination,
          fileExists(path.dirname(path.dirname(destination))) || options.scope === 'project',
        ),
      ],
      fallbackInstructions: [
        `Create ${path.dirname(destination)} and copy skills/codex/SKILL.md to ${destination}.`,
        `Create ${path.dirname(referenceDestination)} and copy skills/references/architecture-boundary-synthesis.md to ${referenceDestination}.`,
      ],
    };
  }

  const base =
    options.scope === 'project'
      ? path.join(options.root, '.claude')
      : path.join(home, '.claude');
  return {
    target: options.target,
    scope: options.scope,
    files: [
      planSkillFile(
        path.join(pkgRoot, 'skills', 'claude-code', 'agents', 'quality-gc-setup-agent.md'),
        path.join(base, 'agents', 'quality-gc-setup-agent.md'),
        fileExists(base) || options.scope === 'project',
      ),
      planSkillFile(
        path.join(pkgRoot, 'skills', 'claude-code', 'commands', 'quality-gc-setup.md'),
        path.join(base, 'commands', 'quality-gc-setup.md'),
        fileExists(base) || options.scope === 'project',
      ),
      planSkillFile(
        path.join(pkgRoot, 'skills', 'references', 'architecture-boundary-synthesis.md'),
        path.join(base, 'agents', 'quality-gc-architecture-boundaries.md'),
        fileExists(base) || options.scope === 'project',
      ),
    ],
    fallbackInstructions: [
      `Create ${path.join(base, 'agents')} and copy skills/claude-code/agents/quality-gc-setup-agent.md.`,
      `Create ${path.join(base, 'commands')} and copy skills/claude-code/commands/quality-gc-setup.md.`,
      `Create ${path.join(base, 'agents')} and copy skills/references/architecture-boundary-synthesis.md.`,
    ],
  };
}

export function applySkillInstallPlan(plan: SkillInstallPlan, options: ApplySkillInstallOptions = {}): string[] {
  const written: string[] = [];
  for (const file of plan.files) {
    if (file.action === 'noop') {
      continue;
    }
    if (file.action === 'conflict' && !options.overwrite && options.skipConflicts) {
      continue;
    }
    if (file.action === 'conflict' && !options.overwrite) {
      throw new Error(`Refusing to overwrite existing skill file without confirmation: ${file.destination}`);
    }
    writeText(file.destination, readText(file.source));
    written.push(file.destination);
  }
  return written;
}

function relativeReportPath(destination: string, root: string): string {
  const relative = path.relative(root, destination);
  return relative.startsWith('..') ? destination : relative;
}

const MAX_SKILL_REPORT_PREVIEW_LINES = 24;

function appendChangedLinesPreview(lines: string[], marker: '-' | '+', changedLines: string[]): void {
  const previewLines = changedLines.slice(0, MAX_SKILL_REPORT_PREVIEW_LINES);
  for (const line of previewLines) {
    lines.push(`${marker}${line}`);
  }

  const hiddenLineCount = changedLines.length - previewLines.length;
  if (hiddenLineCount > 0) {
    lines.push(`${marker}... ${hiddenLineCount} more changed line${hiddenLineCount === 1 ? '' : 's'} hidden`);
  }
}

function renderChangedRangeDiff(before: string, after: string): string {
  const beforeLines = before.split('\n');
  const afterLines = after.split('\n');
  let start = 0;
  while (start < beforeLines.length && start < afterLines.length && beforeLines[start] === afterLines[start]) {
    start += 1;
  }

  let beforeEnd = beforeLines.length - 1;
  let afterEnd = afterLines.length - 1;
  while (beforeEnd >= start && afterEnd >= start && beforeLines[beforeEnd] === afterLines[afterEnd]) {
    beforeEnd -= 1;
    afterEnd -= 1;
  }

  const beforeChangedLines = beforeEnd >= start ? beforeLines.slice(start, beforeEnd + 1) : [];
  const afterChangedLines = afterEnd >= start ? afterLines.slice(start, afterEnd + 1) : [];
  const hiddenLineCount = Math.max(beforeChangedLines.length, afterChangedLines.length) - MAX_SKILL_REPORT_PREVIEW_LINES;
  const previewNote = hiddenLineCount > 0 ? `, preview only` : '';
  const lines = [`@@ first changed line ${start + 1}${previewNote} @@`];
  appendChangedLinesPreview(lines, '-', beforeChangedLines);
  appendChangedLinesPreview(lines, '+', afterChangedLines);
  return lines.join('\n');
}

export function createSkillUpdateReport(plan: SkillInstallPlan, root: string): SkillUpdateReport | null {
  const conflicts = plan.files.filter(file => file.action === 'conflict');
  if (conflicts.length === 0) {
    return null;
  }

  const lines = [
    '# Quality GC Skill Update',
    '',
    'Quality GC found an existing setup-agent skill that differs from the packaged version.',
    'Nothing was overwritten.',
    '',
    'To update it, run:',
    '',
    '```sh',
    `quality-gc install-skill --target ${plan.target} --scope ${plan.scope} --root . --apply`,
    '```',
    '',
    'Then approve the update when prompted.',
    '',
    'Short change preview:',
  ];

  for (const file of conflicts) {
    lines.push('', `## ${relativeReportPath(file.destination, root)}`, '', '```diff');
    lines.push(`--- ${relativeReportPath(file.destination, root)}`);
    lines.push(`+++ packaged quality-gc skill`);
    lines.push(renderChangedRangeDiff(readText(file.destination), readText(file.source)));
    lines.push('```');
  }

  return {
    path: path.join(root, '.quality-gc', 'skill-update-report.md'),
    content: `${lines.join('\n')}\n`,
  };
}

export function writeSkillUpdateReport(plan: SkillInstallPlan, root: string): string | null {
  const report = createSkillUpdateReport(plan, root);
  if (!report) {
    return null;
  }

  const content = fileExists(report.path) ? `${readText(report.path).trimEnd()}\n\n---\n\n${report.content}` : report.content;
  writeText(report.path, content);
  return report.path;
}
