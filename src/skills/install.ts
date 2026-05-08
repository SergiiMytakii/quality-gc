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
    if (file.action === 'conflict' && !options.overwrite) {
      throw new Error(`Refusing to overwrite existing skill file without confirmation: ${file.destination}`);
    }
    writeText(file.destination, readText(file.source));
    written.push(file.destination);
  }
  return written;
}
