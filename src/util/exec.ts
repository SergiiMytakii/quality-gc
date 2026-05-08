import { spawnSync } from 'node:child_process';

export interface ExecResult {
  status: number;
  stdout: string;
  stderr: string;
}

export function runCommand(command: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): ExecResult {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.error) {
    throw new Error(`${command} failed to start: ${result.error.message}`);
  }

  return {
    status: result.status ?? 1,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

export function requireSuccessfulCommand(command: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): string {
  const result = runCommand(command, args, options);
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

export function tryCommand(command: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): string | null {
  const result = runCommand(command, args, options);
  return result.status === 0 ? result.stdout.trim() : null;
}
