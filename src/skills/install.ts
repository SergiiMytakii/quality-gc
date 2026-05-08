import path from 'node:path';
import { fileExists, findPackageRoot, readText, writeText } from '../util/fs.js';

export type SkillTarget = 'codex' | 'claude-code';
export type SkillScope = 'user' | 'project';

export interface SkillInstallPlan {
  target: SkillTarget;
  scope: SkillScope;
  files: Array<{ source: string; destination: string; available: boolean }>;
  fallbackInstructions: string[];
}

function homeDir(home?: string): string {
  return home ?? process.env.HOME ?? process.cwd();
}

function packageRoot(): string {
  return findPackageRoot(import.meta.url);
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
    const codexHome = process.env.CODEX_HOME ?? path.join(home, '.codex');
    const destination = path.join(codexHome, 'skills', 'quality-gc-setup-agent', 'SKILL.md');
    return {
      target: options.target,
      scope: options.scope,
      files: [
        {
          source: path.join(pkgRoot, 'skills', 'codex', 'SKILL.md'),
          destination,
          available: fileExists(path.dirname(path.dirname(destination))),
        },
      ],
      fallbackInstructions: [`Create ${path.dirname(destination)} and copy skills/codex/SKILL.md to ${destination}.`],
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
      {
        source: path.join(pkgRoot, 'skills', 'claude-code', 'agents', 'quality-gc-setup-agent.md'),
        destination: path.join(base, 'agents', 'quality-gc-setup-agent.md'),
        available: fileExists(base) || options.scope === 'project',
      },
      {
        source: path.join(pkgRoot, 'skills', 'claude-code', 'commands', 'quality-gc-setup.md'),
        destination: path.join(base, 'commands', 'quality-gc-setup.md'),
        available: fileExists(base) || options.scope === 'project',
      },
    ],
    fallbackInstructions: [
      `Create ${path.join(base, 'agents')} and copy skills/claude-code/agents/quality-gc-setup-agent.md.`,
      `Create ${path.join(base, 'commands')} and copy skills/claude-code/commands/quality-gc-setup.md.`,
    ],
  };
}

export function applySkillInstallPlan(plan: SkillInstallPlan): string[] {
  const written: string[] = [];
  for (const file of plan.files) {
    writeText(file.destination, readText(file.source));
    written.push(file.destination);
  }
  return written;
}
