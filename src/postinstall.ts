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
type SkillUpdateChoice = 'update' | 'diff';

const VALID_CHOICES = new Set<PostinstallChoice>(['codex', 'claude-code', 'both', 'skip']);

interface PromptSession {
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
  close: () => void;
}

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

export function normalizeSkillUpdateChoice(value: string | undefined): SkillUpdateChoice | null {
  const normalized = value?.trim().toLowerCase() ?? '';
  if (normalized === '' || normalized === '2' || normalized === 'd' || normalized === 'diff' || normalized === 'n' || normalized === 'no') {
    return 'diff';
  }
  if (normalized === '1' || normalized === 'u' || normalized === 'update' || normalized === 'y' || normalized === 'yes') {
    return 'update';
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

export function shouldPromptForSkillInstall(
  env: NodeJS.ProcessEnv,
  stdinIsTTY: boolean,
  stdoutIsTTY: boolean,
  controllingTerminalAvailable = false,
): boolean {
  if (normalizePostinstallChoice(env.QUALITY_GC_INSTALL_SKILL) === 'skip') {
    return false;
  }
  if (env.CI === 'true' || env.QUALITY_GC_SKIP_POSTINSTALL === '1') {
    return false;
  }
  return (stdinIsTTY && stdoutIsTTY) || controllingTerminalAvailable;
}

export function hasControllingTerminal(ttyPath = '/dev/tty'): boolean {
  if (process.platform === 'win32') {
    return false;
  }
  try {
    const fd = fs.openSync(ttyPath, 'r+');
    fs.closeSync(fd);
    return true;
  } catch {
    return false;
  }
}

function createControllingTerminalPromptSession(): PromptSession | null {
  if (process.platform === 'win32') {
    return null;
  }

  let readFd: number | null = null;
  let writeFd: number | null = null;
  try {
    readFd = fs.openSync('/dev/tty', 'r');
    writeFd = fs.openSync('/dev/tty', 'w');
    const input = fs.createReadStream('/dev/tty', { fd: readFd, autoClose: true });
    const output = fs.createWriteStream('/dev/tty', { fd: writeFd, autoClose: true });
    return {
      input,
      output,
      close: () => {
        input.destroy();
        output.end();
      },
    };
  } catch {
    if (readFd !== null) {
      fs.closeSync(readFd);
    }
    if (writeFd !== null) {
      fs.closeSync(writeFd);
    }
    return null;
  }
}

function createPromptSession(): PromptSession | null {
  if (process.stdin.isTTY && process.stdout.isTTY) {
    return {
      input: process.stdin,
      output: process.stdout,
      close: () => {},
    };
  }
  return createControllingTerminalPromptSession();
}

function canPrompt(): boolean {
  if (
    normalizePostinstallChoice(process.env.QUALITY_GC_INSTALL_SKILL) === 'skip' ||
    process.env.CI === 'true' ||
    process.env.QUALITY_GC_SKIP_POSTINSTALL === '1'
  ) {
    return false;
  }

  const stdinIsTTY = process.stdin.isTTY === true;
  const stdoutIsTTY = process.stdout.isTTY === true;
  if (stdinIsTTY && stdoutIsTTY) {
    return true;
  }
  return shouldPromptForSkillInstall(process.env, stdinIsTTY, stdoutIsTTY, hasControllingTerminal());
}

function writePromptLine(output: NodeJS.WritableStream, line = ''): void {
  output.write(`${line}\n`);
}

async function withPromptSession<T>(
  prompt: (rl: readline.Interface, output: NodeJS.WritableStream) => Promise<T>,
): Promise<T> {
  const session = createPromptSession();
  if (!session) {
    throw new Error('No interactive terminal is available');
  }

  const rl = readline.createInterface({ input: session.input, output: session.output });
  try {
    return await prompt(rl, session.output);
  } finally {
    rl.close();
    session.close();
  }
}

async function promptForChoice(): Promise<PostinstallChoice> {
  return withPromptSession(async (rl, output) => {
    writePromptLine(output);
    writePromptLine(output, 'Quality GC can install the setup-agent skill now.');
    writePromptLine(output, 'Choose where to install it:');
    writePromptLine(output, '  1. Codex');
    writePromptLine(output, '  2. Claude Code');
    writePromptLine(output, '  3. Both');
    writePromptLine(output, '  4. Skip');

    for (;;) {
      const answer = await rl.question('Install Quality GC skill for [1/2/3/4]? ');
      const choice = normalizePostinstallChoice(answer);
      if (choice) {
        return choice;
      }
      writePromptLine(output, 'Please enter 1, 2, 3, or 4.');
    }
  });
}

async function promptForSkillUpdate(destinations: string[]): Promise<boolean> {
  return withPromptSession(async (rl, output) => {
    writePromptLine(output);
    writePromptLine(output, 'Quality GC setup-agent skill already exists and differs from the packaged version.');
    writePromptLine(output, 'Affected files:');
    for (const destination of destinations) {
      writePromptLine(output, `  - ${destination}`);
    }
    writePromptLine(output, 'Choose what to do:');
    writePromptLine(output, '  1. Update the installed skill now');
    writePromptLine(output, '  2. Keep the current skill and write a diff report');

    for (;;) {
      const answer = await rl.question('Update Quality GC skill now? [1/2, default 2] ');
      const choice = normalizeSkillUpdateChoice(answer);
      if (choice) {
        return choice === 'update';
      }
      writePromptLine(output, 'Please enter 1 to update or 2 to write a diff report.');
    }
  });
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
