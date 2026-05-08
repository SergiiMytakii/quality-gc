#!/usr/bin/env node
import process from 'node:process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runArchitectureDriftCommand } from './commands/architecture-drift.js';
import { runArchitectureCommand } from './commands/architecture.js';
import { runCleanupScanCommand } from './commands/cleanup-scan.js';
import { runInstallSkillCommand } from './commands/install-skill.js';
import { runLabelsCommand } from './commands/labels.js';
import { runMigrateCommand } from './commands/migrate.js';
import { runGuardrailsCommand } from './commands/run.js';
import { runSetupCommand } from './commands/setup.js';
import type { SkillScope, SkillTarget } from './skills/install.js';

interface ParsedArgs {
  command?: string;
  values: Map<string, string>;
  flags: Set<string>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const [command, ...rest] = argv;
  const values = new Map<string, string>();
  const flags = new Set<string>();

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (!arg.startsWith('--')) {
      throw new Error(`Unknown positional argument: ${arg}`);
    }

    const key = arg.slice(2);
    const next = rest[index + 1];
    if (!next || next.startsWith('--')) {
      flags.add(key);
      continue;
    }

    values.set(key, next);
    index += 1;
  }

  return { command, values, flags };
}

function root(args: ParsedArgs): string {
  return args.values.get('root') ?? process.cwd();
}

function bool(args: ParsedArgs, name: string): boolean {
  return args.flags.has(name) || args.values.get(name) === 'true';
}

function requireTarget(value: string | undefined): SkillTarget {
  if (value === 'codex' || value === 'claude-code') {
    return value;
  }
  throw new Error('--target must be codex or claude-code.');
}

function skillScope(value: string | undefined): SkillScope {
  if (!value) {
    return 'user';
  }
  if (value === 'user' || value === 'project') {
    return value;
  }
  throw new Error('--scope must be user or project.');
}

function printHelp(): void {
  console.log(`quality-gc

Commands:
  setup --root <path> [--apply] [--package-source <source>] [--allow-default-branch]
  run --root <path>
  architecture --root <path>
  architecture-drift --root <path> [--fail-on-findings]
  cleanup-scan --root <path> [--output <file>] [--existing-issues-file <file>] [--repo owner/name] [--write-issues]
  labels --repo owner/name [--apply]
  install-skill --target codex|claude-code [--scope user|project] [--root <path>] [--home <path>] [--apply]
  migrate --root <path> [--apply] [--package-source <source>] [--allow-default-branch]
`);
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const args = parseArgs(argv);
  const json = bool(args, 'json');

  switch (args.command) {
    case undefined:
    case 'help':
    case '--help':
      printHelp();
      return 0;
    case 'setup':
      return runSetupCommand({
        root: root(args),
        apply: bool(args, 'apply'),
        packageSource: args.values.get('package-source'),
        json,
        allowDefaultBranch: bool(args, 'allow-default-branch'),
      });
    case 'run':
      return runGuardrailsCommand({ root: root(args), json });
    case 'architecture':
      return runArchitectureCommand({ root: root(args), json });
    case 'architecture-drift':
      return runArchitectureDriftCommand({
        root: root(args),
        json,
        failOnFindings: bool(args, 'fail-on-findings'),
      });
    case 'cleanup-scan':
      return runCleanupScanCommand({
        root: root(args),
        output: args.values.get('output'),
        existingIssuesFile: args.values.get('existing-issues-file'),
        repo: args.values.get('repo'),
        writeIssues: bool(args, 'write-issues'),
        json,
      });
    case 'install-skill':
      return runInstallSkillCommand({
        target: requireTarget(args.values.get('target')),
        scope: skillScope(args.values.get('scope')),
        root: root(args),
        home: args.values.get('home'),
        apply: bool(args, 'apply'),
        json,
      });
    case 'labels': {
      const repo = args.values.get('repo');
      if (!repo) {
        throw new Error('--repo is required for labels.');
      }
      return runLabelsCommand({
        repo,
        apply: bool(args, 'apply'),
        json,
      });
    }
    case 'migrate':
      return runMigrateCommand({
        root: root(args),
        apply: bool(args, 'apply'),
        packageSource: args.values.get('package-source'),
        json,
        allowDefaultBranch: bool(args, 'allow-default-branch'),
      });
    default:
      throw new Error(`Unknown command: ${args.command}`);
  }
}

function isCliEntrypoint(): boolean {
  if (!process.argv[1]) {
    return false;
  }

  return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
}

if (isCliEntrypoint()) {
  main().then(
    exitCode => {
      process.exitCode = exitCode;
    },
    error => {
      console.error(`[quality-gc] ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    },
  );
}
