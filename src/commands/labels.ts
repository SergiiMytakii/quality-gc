import { ensureLabels, listLabels, planLabelActions } from '../github/labels.js';

export interface LabelsCommandOptions {
  repo: string;
  apply: boolean;
  json: boolean;
}

export async function runLabelsCommand(options: LabelsCommandOptions): Promise<number> {
  const existing = listLabels(options.repo);
  const actions = planLabelActions(existing);

  if (options.json) {
    console.log(JSON.stringify(actions, null, 2));
  } else {
    for (const action of actions) {
      console.log(`[${options.apply ? 'apply' : 'preview'}] ${action.action}: ${action.name}`);
    }
  }

  if (!options.apply) {
    if (!options.json) {
      console.log('Preview only. Re-run with --apply after reviewing the plan.');
    }
    return 0;
  }

  ensureLabels(options.repo);
  if (!options.json) {
    console.log('Quality GC labels are ready.');
  }
  return 0;
}
