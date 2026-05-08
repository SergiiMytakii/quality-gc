import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { validateConfig } from '../src/config/load.js';
import { defaultConfig, renderConfig } from '../src/config/schema.js';
import { main } from '../src/cli.js';
import { collectCleanupFindings } from '../src/commands/cleanup-scan.js';
import { runGuardrailsCommand } from '../src/commands/run.js';
import { issueMarker, planIssueActions } from '../src/github/issues.js';
import { planLabelActions } from '../src/github/labels.js';
import { createMigrationPlan, createSetupPlan } from '../src/setup/plan.js';
import { applySetupPlan } from '../src/setup/apply.js';
import { writeNoNewAnyBaseline, evaluateNoNewAny } from '../src/guards/no-new-any.js';
import { cleanupScanWorkflow } from '../src/workflows/templates.js';
import { createSkillInstallPlan, applySkillInstallPlan } from '../src/skills/install.js';
import { fileExists, readJson, readText, writeText } from '../src/util/fs.js';
import { requireSuccessfulCommand } from '../src/util/exec.js';

function tempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function createNpmRepo(): string {
  const root = tempDir('quality-gc-fixture-');
  writeText(
    path.join(root, 'package.json'),
    `${JSON.stringify({ name: 'fixture', version: '1.0.0', type: 'module' }, null, 2)}\n`,
  );
  writeText(path.join(root, 'src/index.ts'), 'export const value: string = "ok";\n');
  requireSuccessfulCommand('git', ['init'], { cwd: root });
  requireSuccessfulCommand('git', ['config', 'user.email', 'quality-gc@example.com'], { cwd: root });
  requireSuccessfulCommand('git', ['config', 'user.name', 'Quality GC'], { cwd: root });
  return root;
}

async function captureStdout(run: () => Promise<number>): Promise<{ exitCode: number; stdout: string }> {
  const lines: string[] = [];
  const logSpy = vi.spyOn(console, 'log').mockImplementation((message?: unknown, ...optionalParams: unknown[]) => {
    lines.push([message, ...optionalParams].map(value => String(value)).join(' '));
  });
  try {
    return {
      exitCode: await run(),
      stdout: lines.join('\n'),
    };
  } finally {
    logSpy.mockRestore();
  }
}

describe('setup and migrate safety', () => {
  it('previews setup without writing files', () => {
    const root = createNpmRepo();
    const plan = createSetupPlan(root, { packageSource: 'github:SergiiMytakii/quality-gc#main' });

    expect(plan.changes.map(change => change.path)).toContain('.quality-gc/quality-gc.config.mjs');
    expect(fileExists(path.join(root, '.quality-gc/quality-gc.config.mjs'))).toBe(false);
    expect(plan.changes.every(change => change.action !== 'conflict')).toBe(true);
  });

  it('applies setup with a pre-publish package source', () => {
    const root = createNpmRepo();
    const plan = createSetupPlan(root, { packageSource: 'github:SergiiMytakii/quality-gc#main' });
    const written = applySetupPlan(plan);
    const packageJson = readJson<{ devDependencies: Record<string, string>; scripts: Record<string, string> }>(
      path.join(root, 'package.json'),
    );

    expect(written).toContain('.github/workflows/quality-gc-cleanup-scan.yml');
    expect(packageJson.devDependencies['quality-gc']).toBe('github:SergiiMytakii/quality-gc#main');
    expect(packageJson.scripts['quality:gc']).toBe('quality-gc run --root .');
  });

  it('refuses unmanaged generated files', () => {
    const root = createNpmRepo();
    writeText(path.join(root, 'docs/quality-gc.md'), '# local docs\n');

    const plan = createSetupPlan(root);
    const conflict = plan.changes.find(change => change.path === 'docs/quality-gc.md');

    expect(conflict?.action).toBe('conflict');
    expect(() => applySetupPlan(plan)).toThrow(/Refusing to apply/);
  });

  it('rejects invalid config without schemaVersion', () => {
    expect(() => validateConfig({ installedVersion: '0.1.0', rules: {} })).toThrow(/schemaVersion/);
  });

  it('migrates old owned config and package source without blind overwrite conflicts', async () => {
    const root = createNpmRepo();
    applySetupPlan(createSetupPlan(root, { packageSource: '^0.0.1' }));
    writeText(path.join(root, '.quality-gc/quality-gc.config.mjs'), renderConfig(defaultConfig('0.0.1')));

    const plan = await createMigrationPlan(root, { packageSource: '^0.1.0' });
    expect(plan.changes.every(change => change.action !== 'conflict')).toBe(true);

    applySetupPlan(plan);
    const packageJson = readJson<{ devDependencies: Record<string, string> }>(path.join(root, 'package.json'));
    const configText = readText(path.join(root, '.quality-gc/quality-gc.config.mjs'));

    expect(packageJson.devDependencies['quality-gc']).toBe('^0.1.0');
    expect(configText).toContain('"installedVersion": "0.1.0"');
  });
});

describe('CLI output contracts', () => {
  it('emits parseable JSON without trailing status prose', async () => {
    const root = createNpmRepo();
    const result = await captureStdout(() => main(['run', '--root', root, '--json']));

    expect(result.exitCode).toBe(0);
    expect(() => JSON.parse(result.stdout)).not.toThrow();
    expect(result.stdout).not.toContain('Quality GC blocking guardrails passed');
  });
});

describe('guardrail adoption model', () => {
  it('detects explicit any above baseline', () => {
    const root = createNpmRepo();
    writeNoNewAnyBaseline(root, '.quality-gc/no-new-any-baseline.json');
    writeText(path.join(root, 'src/index.ts'), 'export const value: any = "bad";\n');
    const config = defaultConfig();

    expect(evaluateNoNewAny(root, config)).toHaveLength(1);
  });

  it('honors no-new-any include and exclude config', () => {
    const root = createNpmRepo();
    writeText(path.join(root, 'src/index.ts'), 'export const value: any = "covered";\n');
    writeText(path.join(root, 'tools/script.ts'), 'export const value: any = "ignored";\n');
    const config = defaultConfig();
    config.rules.noNewAny.include = ['src/**/*.ts', 'tools/**/*.ts'];
    config.rules.noNewAny.exclude = ['tools/**/*.ts'];

    const violations = evaluateNoNewAny(root, config);

    expect(violations).toEqual([expect.objectContaining({ path: 'src/index.ts' })]);
  });

  it('keeps candidate violations advisory for quality-gc run', async () => {
    const root = createNpmRepo();
    const config = defaultConfig();
    config.rules.noNewAny.status = 'disabled';
    config.rules.staleLivePath.status = 'candidate';
    config.rules.staleLivePath.retiredPaths = ['src/old-live-path'];
    writeText(path.join(root, '.quality-gc/quality-gc.config.mjs'), renderConfig(config));
    writeText(path.join(root, '.github/workflows/test.yml'), 'run: node src/old-live-path/index.js\n');

    await expect(runGuardrailsCommand({ root, json: true })).resolves.toBe(0);
    const findings = await collectCleanupFindings(root);

    expect(findings.some(finding => finding.key === 'candidate-stale-live-path')).toBe(true);
  });

  it('creates promotion findings for clean candidate rules', async () => {
    const root = createNpmRepo();
    const config = defaultConfig();
    config.rules.noNewAny.status = 'disabled';
    config.rules.staleLivePath.status = 'candidate';
    config.rules.staleLivePath.retiredPaths = ['src/old-live-path'];
    writeText(path.join(root, '.quality-gc/quality-gc.config.mjs'), renderConfig(config));

    const findings = await collectCleanupFindings(root);

    expect(findings.some(finding => finding.key === 'promote-stale-live-path')).toBe(true);
  });

  it('does not promote unconfigured candidate rules', async () => {
    const root = createNpmRepo();
    const config = defaultConfig();
    config.rules.noNewAny.status = 'disabled';
    config.rules.staleLivePath.status = 'candidate';
    config.rules.staleLivePath.retiredPaths = [];
    writeText(path.join(root, '.quality-gc/quality-gc.config.mjs'), renderConfig(config));

    const findings = await collectCleanupFindings(root);

    expect(findings.some(finding => finding.key === 'promote-stale-live-path')).toBe(false);
  });
});

describe('cleanup issue lifecycle', () => {
  it('dedupes by stable marker before title fallback', () => {
    const finding = {
      key: 'candidate-stale-live-path',
      title: 'Resolve candidate rule violations for stale-live-path',
      category: 'candidate-rule' as const,
      severity: 'medium' as const,
      scope: 'stale-live-path',
      suggestedVerification: 'rerun',
      deterministicAutofixSafe: false,
      evidence: [{ path: '.github/workflows/test.yml', detail: 'path-level evidence' }],
    };
    const actions = planIssueActions([finding], [
      { number: 12, title: 'old title', body: `${issueMarker(finding)}\nold body` },
    ]);

    expect(actions[0]).toMatchObject({ action: 'update', issueNumber: 12 });
    expect(actions[0].labels).toContain('quality-gc:candidate-rule');
  });

  it('plans close actions for stale cleanup issues whose findings disappeared', () => {
    const actions = planIssueActions([], [
      {
        number: 99,
        title: '[Quality GC Cleanup][tracked-artifact-tmp-old-log] Remove tracked local artifact',
        body: '<!-- quality-gc-cleanup:tracked-artifact-tmp-old-log -->\nold finding',
      },
    ]);

    expect(actions).toEqual([
      expect.objectContaining({
        action: 'close',
        issueNumber: 99,
      }),
    ]);
  });

  it('plans minimum Quality GC labels', () => {
    const actions = planLabelActions(['cleanup']);

    expect(actions.filter(action => action.action === 'create').map(action => action.name)).toEqual([
      'quality-gc',
      'quality-gc:candidate-rule',
      'quality-gc:tracked-artifact',
      'quality-gc:promotion',
    ]);
  });

  it('uses path-level evidence for credential-shaped tracked artifacts', async () => {
    const root = createNpmRepo();
    writeText(path.join(root, 'tmp/.env.local'), 'TOKEN=super-secret\n');
    requireSuccessfulCommand('git', ['add', 'tmp/.env.local'], { cwd: root });
    const findings = await collectCleanupFindings(root);
    const body = JSON.stringify(findings);

    expect(body).toContain('tmp/.env.local');
    expect(body).not.toContain('super-secret');
    expect(body).toContain('contents were not read');
  });
});

describe('workflow and skill installer contracts', () => {
  it('keeps cleanup workflow dry-run by default and scopes write permissions', () => {
    const workflow = cleanupScanWorkflow();

    expect(workflow).toContain('default: true');
    expect(workflow).toContain('contents: read');
    expect(workflow).toContain('issues: write');
    expect(workflow).toContain(
      "github.event_name == 'schedule' || (github.event_name == 'workflow_dispatch' && inputs.dry_run == false)",
    );
    expect(workflow).not.toContain('write-all');
  });

  it('installs Codex and Claude Code skills into temp homes only with apply', () => {
    const root = createNpmRepo();
    const home = tempDir('quality-gc-home-');
    const codexPlan = createSkillInstallPlan({ target: 'codex', scope: 'user', root, home });
    const claudePlan = createSkillInstallPlan({ target: 'claude-code', scope: 'project', root, home });

    expect(fileExists(codexPlan.files[0].destination)).toBe(false);
    expect(fileExists(claudePlan.files[0].destination)).toBe(false);

    applySkillInstallPlan(codexPlan);
    applySkillInstallPlan(claudePlan);

    expect(readText(codexPlan.files[0].destination)).toContain('quality-gc');
    expect(readText(claudePlan.files[0].destination)).toContain('quality-gc');
  });
});
