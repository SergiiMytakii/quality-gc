import process from 'node:process';
import readline from 'node:readline/promises';
import { applySkillInstallPlan, createSkillInstallPlan, type SkillScope, type SkillTarget } from '../skills/install.js';

export interface InstallSkillCommandOptions {
  target: SkillTarget;
  scope: SkillScope;
  root: string;
  home?: string;
  apply: boolean;
  json: boolean;
}

async function confirmOverwrite(destinations: string[]): Promise<boolean> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('Refusing to overwrite existing skill files without interactive confirmation.');
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log('Existing skill files differ from the packaged Quality GC skill:');
    for (const destination of destinations) {
      console.log(`- ${destination}`);
    }
    const answer = await rl.question('Overwrite these skill files? [y/N] ');
    return answer.trim().toLowerCase() === 'y' || answer.trim().toLowerCase() === 'yes';
  } finally {
    rl.close();
  }
}

export async function runInstallSkillCommand(options: InstallSkillCommandOptions): Promise<number> {
  const plan = createSkillInstallPlan(options);
  const conflicts = plan.files.filter(file => file.action === 'conflict');

  if (options.json) {
    console.log(JSON.stringify(plan, null, 2));
  } else {
    console.log(`Quality GC skill install plan: ${plan.target} (${plan.scope})`);
    for (const file of plan.files) {
      console.log(`- ${options.apply ? file.action : `preview ${file.action}`}: ${file.destination} (${file.reason})`);
    }
    if (plan.files.some(file => !file.available)) {
      console.log('Fallback instructions:');
      for (const instruction of plan.fallbackInstructions) {
        console.log(`- ${instruction}`);
      }
    }
  }

  if (!options.apply) {
    if (!options.json) {
      console.log('Preview only. Re-run with --apply after reviewing the plan.');
    }
    return 0;
  }

  const overwrite = conflicts.length > 0 ? await confirmOverwrite(conflicts.map(file => file.destination)) : false;
  if (conflicts.length > 0 && !overwrite) {
    console.log('Skill install cancelled; existing files were left unchanged.');
    return 1;
  }

  const written = applySkillInstallPlan(plan, { overwrite });
  if (!options.json) {
    console.log(`Installed Quality GC skill files: ${written.join(', ')}`);
  }
  return 0;
}
