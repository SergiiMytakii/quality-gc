import { loadConfig } from '../config/load.js';
import { evaluateRules } from '../guards/rules.js';
import { formatViolation } from '../util/result.js';

export interface RunCommandOptions {
  root: string;
  json: boolean;
}

export async function runGuardrailsCommand(options: RunCommandOptions): Promise<number> {
  const config = await loadConfig(options.root);
  const results = evaluateRules(options.root, config, { includeCandidates: false });
  const blockingFailures = results.filter(result => result.status === 'blocking' && result.violations.length > 0);

  if (options.json) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    for (const result of results) {
      console.log(`[quality-gc] ${result.rule}: ${result.violations.length === 0 ? 'passed' : 'failed'}`);
      for (const violation of result.violations) {
        console.log(`  ${formatViolation(violation)}`);
      }
    }
  }

  if (blockingFailures.length > 0) {
    if (!options.json) {
      console.error('Quality GC blocking guardrails failed.');
    }
    return 1;
  }

  if (!options.json) {
    console.log('Quality GC blocking guardrails passed.');
  }
  return 0;
}
