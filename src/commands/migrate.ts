import { loadConfig } from '../config/load.js';
import { PACKAGE_VERSION } from '../config/schema.js';
import { createMigrationPlan, summarizePlan } from '../setup/plan.js';
import { applySetupPlan } from '../setup/apply.js';
import { assertNotDefaultBranch } from '../git/default-branch.js';

export interface MigrateCommandOptions {
  root: string;
  apply: boolean;
  packageSource?: string;
  json: boolean;
  allowDefaultBranch: boolean;
}

export async function runMigrateCommand(options: MigrateCommandOptions): Promise<number> {
  const config = await loadConfig(options.root);
  const plan = await createMigrationPlan(options.root, { packageSource: options.packageSource });
  const drift = {
    schemaVersion: config.schemaVersion,
    installedVersion: config.installedVersion,
    targetVersion: PACKAGE_VERSION,
    needsMigration: config.installedVersion !== PACKAGE_VERSION,
  };

  if (options.json) {
    console.log(JSON.stringify({ drift, plan }, null, 2));
  } else {
    console.log(
      `Quality GC migration preview: installed=${drift.installedVersion}, target=${drift.targetVersion}, needsMigration=${drift.needsMigration}`,
    );
    process.stdout.write(summarizePlan(plan));
  }

  const conflicts = plan.changes.filter(change => change.action === 'conflict');
  if (conflicts.length > 0) {
    console.error('Migration has unmanaged conflicts. Review the preview before applying.');
    return 1;
  }

  if (!options.apply) {
    if (!options.json) {
      console.log('Preview only. Re-run with --apply after reviewing the plan.');
    }
    return 0;
  }

  assertNotDefaultBranch(options.root, options.allowDefaultBranch, 'migration');
  const written = applySetupPlan(plan);
  if (!options.json) {
    console.log(`Applied Quality GC migration. Written files: ${written.length === 0 ? 'none' : written.join(', ')}`);
  }
  return 0;
}
