import { createSetupPlan, summarizePlan } from '../setup/plan.js';
import { applySetupPlan } from '../setup/apply.js';
import { assertNotDefaultBranch } from '../git/default-branch.js';

export interface SetupCommandOptions {
  root: string;
  apply: boolean;
  packageSource?: string;
  json: boolean;
  allowDefaultBranch: boolean;
}

export async function runSetupCommand(options: SetupCommandOptions): Promise<number> {
  const plan = createSetupPlan(options.root, { packageSource: options.packageSource });

  if (options.json) {
    console.log(JSON.stringify(plan, null, 2));
  } else {
    process.stdout.write(summarizePlan(plan));
  }

  const conflicts = plan.changes.filter(change => change.action === 'conflict');
  if (conflicts.length > 0) {
    console.error('Setup has unmanaged conflicts. Review the preview before applying.');
    return 1;
  }

  if (!options.apply) {
    if (!options.json) {
      console.log('Preview only. Re-run with --apply after reviewing the plan.');
    }
    return 0;
  }

  assertNotDefaultBranch(plan.root, options.allowDefaultBranch, 'setup');
  const written = applySetupPlan(plan);
  if (!options.json) {
    console.log(`Applied Quality GC setup. Written files: ${written.length === 0 ? 'none' : written.join(', ')}`);
  }
  return 0;
}
