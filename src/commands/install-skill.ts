import { applySkillInstallPlan, createSkillInstallPlan, type SkillScope, type SkillTarget } from '../skills/install.js';

export interface InstallSkillCommandOptions {
  target: SkillTarget;
  scope: SkillScope;
  root: string;
  home?: string;
  apply: boolean;
  json: boolean;
}

export async function runInstallSkillCommand(options: InstallSkillCommandOptions): Promise<number> {
  const plan = createSkillInstallPlan(options);

  if (options.json) {
    console.log(JSON.stringify(plan, null, 2));
  } else {
    console.log(`Quality GC skill install plan: ${plan.target} (${plan.scope})`);
    for (const file of plan.files) {
      console.log(`- ${options.apply ? 'write' : 'preview'}: ${file.destination}`);
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

  const written = applySkillInstallPlan(plan);
  if (!options.json) {
    console.log(`Installed Quality GC skill files: ${written.join(', ')}`);
  }
  return 0;
}
