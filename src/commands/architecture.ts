import { loadConfig } from '../config/load.js';
import { evaluateArchitectureRules } from '../guards/architecture.js';
import { formatViolation } from '../util/result.js';

export interface ArchitectureCommandOptions {
  root: string;
  json: boolean;
}

export async function runArchitectureCommand(options: ArchitectureCommandOptions): Promise<number> {
  const config = await loadConfig(options.root);
  const results = evaluateArchitectureRules(options.root, config, { includeCandidates: true });
  const violations = results.flatMap(result => result.violations);
  const blockingFailures = results.filter(result => result.status === 'blocking' && result.violations.length > 0);

  if (options.json) {
    console.log(JSON.stringify({ rule: 'architecture', results, violations }, null, 2));
  } else {
    for (const result of results) {
      for (const violation of result.violations) {
        console.log(`${result.status}: ${formatViolation(violation)}`);
      }
    }
  }

  if (blockingFailures.length > 0) {
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
