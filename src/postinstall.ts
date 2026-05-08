#!/usr/bin/env node
import fs from 'node:fs';
import process from 'node:process';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import {
  applySkillInstallPlan,
  createSkillInstallPlan,
  writeSkillUpdateReport,
  type SkillTarget,
} from './skills/install.js';

type PostinstallChoice = 'codex' | 'claude-code' | 'both' | 'skip';

const VALID_CHOICES = new Set<PostinstallChoice>(['codex', 'claude-code', 'both', 'skip']);

export function normalizePostinstallChoice(value: string | undefined): PostinstallChoice | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === '1' || normalized === 'codex') {
    return 'codex';
  }
  if (normalized === '2' || normalized === 'claude' || normalized === 'claude-code') {
    return 'claude-code';
  }
  if (normalized === '3' || normalized === 'both') {
    return 'both';
  }
  if (normalized === '4' || normalized === 's' || normalized === 'skip' || normalized === 'no') {
    return 'skip';
  }
  if (VALID_CHOICES.has(normalized as PostinstallChoice)) {
    return normalized as PostinstallChoice;
  }

  return null;
}

export function targetsForChoice(choice: PostinstallChoice): SkillTarget[] {
  if (choice === 'codex') {
    return ['codex'];
  }
  if (choice === 'claude-code') {
    return ['claude-code'];
  }
  if (choice === 'both') {
    return ['codex', 'claude-code'];
  }
  return [];
}

export function shouldPromptForSkillInstall(env: NodeJS.ProcessEnv, stdinIsTTY: boolean, stdoutIsTTY: boolean): boolean {
  if (normalizePostinstallChoice(env.QUALITY_GC_INSTALL_SKILL) === 'skip') {
    return false;
  }
  if (env.CI === 'true' || env.QUALITY_GC_SKIP_POSTINSTALL === '1') {
    return false;
  }
  return stdinIsTTY && stdoutIsTTY;
}

function canPrompt(): boolean {
  return shouldPromptForSkillInstall(process.env, process.stdin.isTTY, process.stdout.isTTY);
}

async function promptForChoice(): Promise<PostinstallChoice> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log('\nQuality GC can install the setup-agent skill now.');
    console.log('Choose where to install it:');
    console.log('  1. Codex');
    console.log('  2. Claude Code');
    console.log('  3. Both');
    console.log('  4. Skip');

    for (;;) {
      const answer = await rl.question('Install Quality GC skill for [1/2/3/4]? ');
      const choice = normalizePostinstallChoice(answer);
      if (choice) {
        return choice;
      }
      console.log('Please enter 1, 2, 3, or 4.');
    }
  } finally {
    rl.close();
  }
}

async function promptForSkillUpdate(destinations: string[]): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log('\nQuality GC setup-agent skill already exists and differs from the packaged version.');
    console.log('Update these files?');
    for (const destination of destinations) {
      console.log(`  - ${destination}`);
    }
    const answer = await rl.question('Update Quality GC skill? [y/N] ');
    return answer.trim().toLowerCase() === 'y' || answer.trim().toLowerCase() === 'yes';
  } finally {
    rl.close();
  }
}

function projectRoot(): string {
  return process.env.INIT_CWD ?? process.cwd();
}

function packageRunner(): string {
  if (process.env.npm_execpath?.includes('pnpm')) {
    return 'pnpm exec quality-gc';
  }
  if (process.env.npm_execpath?.includes('yarn')) {
    return 'yarn quality-gc';
  }
  return 'npx quality-gc';
}

function printManualInstructions(): void {
  const runner = packageRunner();
  console.log('Quality GC skill was not installed automatically.');
  console.log('Install it later with one of these commands:');
  console.log(`  Codex:       ${runner} install-skill --target codex --scope project --root . --apply`);
  console.log(`  Claude Code: ${runner} install-skill --target claude-code --scope project --root . --apply`);
}

export function defaultPostinstallChoice(env: NodeJS.ProcessEnv): PostinstallChoice {
  const envChoice = normalizePostinstallChoice(env.QUALITY_GC_INSTALL_SKILL);
  if (envChoice) {
    return envChoice;
  }
  if (env.CI === 'true' || env.QUALITY_GC_SKIP_POSTINSTALL === '1') {
    return 'skip';
  }
  return 'codex';
}

export async function runPostinstall(): Promise<void> {
  const explicitPrompt = process.env.QUALITY_GC_INSTALL_SKILL === 'prompt';
  const choice = explicitPrompt && canPrompt() ? await promptForChoice() : defaultPostinstallChoice(process.env);

  const targets = targetsForChoice(choice);
  if (targets.length === 0) {
    if (!process.env.QUALITY_GC_INSTALL_SKILL && process.env.CI !== 'true' && process.env.QUALITY_GC_SKIP_POSTINSTALL !== '1') {
      printManualInstructions();
    }
    return;
  }

  const root = projectRoot();
  const written: string[] = [];
  const reports: string[] = [];
  for (const target of targets) {
    const plan = createSkillInstallPlan({ target, scope: 'project', root });
    const conflicts = plan.files.filter(file => file.action === 'conflict');
    const overwrite = conflicts.length > 0 && canPrompt() ? await promptForSkillUpdate(conflicts.map(file => file.destination)) : false;

    if (conflicts.length > 0 && !overwrite) {
      const reportPath = writeSkillUpdateReport(plan, root);
      if (reportPath) {
        reports.push(reportPath);
      }
      written.push(...applySkillInstallPlan(plan, { skipConflicts: true }));
      continue;
    }

    written.push(...applySkillInstallPlan(plan, { overwrite }));
  }

  if (written.length > 0) {
    console.log(`Quality GC skill installed: ${written.join(', ')}`);
  }
  if (reports.length > 0) {
    console.log(`Quality GC skill update report written: ${reports.join(', ')}`);
  }
  if (written.length === 0 && reports.length === 0) {
    console.log('Quality GC skill is already up to date.');
  }
}

function isEntrypoint(): boolean {
  if (!process.argv[1]) {
    return false;
  }
  return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
}

if (isEntrypoint()) {
  runPostinstall().catch(error => {
    console.error(`[quality-gc] Skill auto-install skipped: ${error instanceof Error ? error.message : String(error)}`);
    printManualInstructions();
  });
}
