import path from 'node:path';
import type { SetupPlan } from './plan.js';
import { writeText } from '../util/fs.js';

export function assertPlanCanApply(plan: SetupPlan): void {
  const conflicts = plan.changes.filter(change => change.action === 'conflict');
  if (conflicts.length > 0) {
    throw new Error(`Refusing to apply over unmanaged changes: ${conflicts.map(change => change.path).join(', ')}`);
  }
}

export function applySetupPlan(plan: SetupPlan): string[] {
  assertPlanCanApply(plan);
  const written: string[] = [];

  for (const change of plan.changes) {
    if (change.action === 'create' || change.action === 'update') {
      writeText(path.join(plan.root, change.path), change.content);
      written.push(change.path);
    }
  }

  return written;
}
