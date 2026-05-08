import { QUALITY_GC_LABELS } from '../config/schema.js';
import { runCommand } from '../util/exec.js';

export interface LabelAction {
  action: 'create' | 'exists';
  name: string;
  color: string;
  description: string;
}

const LABEL_METADATA: Record<string, { color: string; description: string }> = {
  'quality-gc': { color: '5319e7', description: 'Quality GC generated issue' },
  cleanup: { color: 'fbca04', description: 'Cleanup work' },
  'quality-gc:candidate-rule': { color: 'd4c5f9', description: 'Quality GC candidate guardrail cleanup' },
  'quality-gc:architecture-drift': { color: 'bfdadc', description: 'Quality GC architecture config refresh' },
  'quality-gc:tracked-artifact': { color: 'fef2c0', description: 'Quality GC tracked local artifact cleanup' },
  'quality-gc:promotion': { color: '0e8a16', description: 'Quality GC guardrail promotion' },
};

export function planLabelActions(existingLabels: string[]): LabelAction[] {
  const existing = new Set(existingLabels);
  return QUALITY_GC_LABELS.map(name => {
    const metadata = LABEL_METADATA[name];
    return {
      action: existing.has(name) ? 'exists' : 'create',
      name,
      color: metadata.color,
      description: metadata.description,
    };
  });
}

export function listLabels(repo: string): string[] {
  const output = runCommand('gh', ['label', 'list', '--repo', repo, '--limit', '200', '--json', 'name']);
  if (output.status !== 0) {
    throw new Error(`Could not list GitHub labels: ${output.stderr}`);
  }
  return (JSON.parse(output.stdout) as Array<{ name: string }>).map(label => label.name);
}

export function ensureLabels(repo: string): void {
  for (const action of planLabelActions(listLabels(repo))) {
    if (action.action === 'exists') {
      continue;
    }
    const result = runCommand('gh', [
      'label',
      'create',
      action.name,
      '--repo',
      repo,
      '--color',
      action.color,
      '--description',
      action.description,
    ]);
    if (result.status !== 0) {
      throw new Error(`Could not create label ${action.name}: ${result.stderr}`);
    }
  }
}
