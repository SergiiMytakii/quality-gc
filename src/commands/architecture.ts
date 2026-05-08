import { loadConfig } from '../config/load.js';
import { evaluateArchitecture } from '../guards/architecture.js';
import { formatViolation } from '../util/result.js';

export interface ArchitectureCommandOptions {
  root: string;
  json: boolean;
}

export async function runArchitectureCommand(options: ArchitectureCommandOptions): Promise<number> {
  const config = await loadConfig(options.root);
  const violations = config.rules.architecture.status === 'disabled' ? [] : evaluateArchitecture(options.root, config);

  if (options.json) {
    console.log(JSON.stringify({ rule: 'architecture', violations }, null, 2));
  } else {
    for (const violation of violations) {
      console.log(formatViolation(violation));
    }
  }

  if (config.rules.architecture.status === 'blocking' && violations.length > 0) {
    if (!options.json) {
      console.error('Quality GC architecture guardrail failed.');
    }
    return 1;
  }

  if (!options.json) {
    console.log('Quality GC architecture guardrail passed.');
  }
  return 0;
}
