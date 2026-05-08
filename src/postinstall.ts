#!/usr/bin/env node
import fs from 'node:fs';
import process from 'node:process';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { applySkillInstallPlan, createSkillInstallPlan, type SkillTarget } from './skills/install.js';

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
  if (env.QUALITY_GC_INSTALL_SKILL) {
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

function projectRoot(): string {
  return process.env.INIT_CWD ?? process.cwd();
}

function packageRunner(): string {
  return process.env.npm_execpath?.includes('pnpm') ? 'pnpm exec quality-gc' : 'npx quality-gc';
}

function printManualInstructions(): void {
  const runner = packageRunner();
  console.log('Quality GC skill was not installed automatically.');
  console.log('Install it later with one of these commands:');
  console.log(`  Codex:       ${runner} install-skill --target codex --scope project --root . --apply`);
  console.log(`  Claude Code: ${runner} install-skill --target claude-code --scope project --root . --apply`);
}

export async function runPostinstall(): Promise<void> {
  const envChoice = normalizePostinstallChoice(process.env.QUALITY_GC_INSTALL_SKILL);
  const choice = envChoice ?? (canPrompt() ? await promptForChoice() : 'skip');

  const targets = targetsForChoice(choice);
  if (targets.length === 0) {
    if (!process.env.QUALITY_GC_INSTALL_SKILL && process.env.CI !== 'true' && !canPrompt()) {
      printManualInstructions();
    }
    return;
  }

  const root = projectRoot();
  const written: string[] = [];
  for (const target of targets) {
    const plan = createSkillInstallPlan({ target, scope: 'project', root });
    written.push(...applySkillInstallPlan(plan));
  }

  console.log(`Quality GC skill installed: ${written.join(', ')}`);
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
