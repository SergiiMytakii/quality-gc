import type { QualityGcConfig, RuleStatus } from '../config/schema.js';
import { evaluateArchitectureRules } from './architecture.js';
import { evaluateNoNewAny } from './no-new-any.js';
import { evaluateStaleLivePaths } from './stale-live-path.js';
import type { RuleEvaluation, Violation } from '../util/result.js';

type Evaluator = (root: string, config: QualityGcConfig) => Violation[];

const evaluators: Record<string, { status: (config: QualityGcConfig) => RuleStatus; evaluate: Evaluator }> = {
  'no-new-any': {
    status: config => config.rules.noNewAny.status,
    evaluate: evaluateNoNewAny,
  },
  'stale-live-path': {
    status: config => config.rules.staleLivePath.status,
    evaluate: evaluateStaleLivePaths,
  },
};

export function evaluateRules(root: string, config: QualityGcConfig, options: { includeCandidates: boolean }): RuleEvaluation[] {
  const architectureResults = evaluateArchitectureRules(root, config, options);
  const otherResults = Object.entries(evaluators)
    .map(([rule, entry]) => {
      const status = entry.status(config);
      if (rule === 'stale-live-path' && config.rules.staleLivePath.retiredPaths.length === 0) {
        return { rule, status: 'disabled' as const, violations: [] };
      }
      if (status === 'disabled' || (status === 'candidate' && !options.includeCandidates)) {
        return { rule, status, violations: [] };
      }
      return { rule, status, violations: entry.evaluate(root, config) };
    })
    .filter(result => result.status !== 'disabled' && (options.includeCandidates || result.status === 'blocking'));
  return [...architectureResults, ...otherResults];
}
