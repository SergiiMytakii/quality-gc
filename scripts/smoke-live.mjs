#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'quality-gc-smoke-'));
const fixtureRoot = path.join(tempRoot, 'fixture');
const packRoot = path.join(tempRoot, 'pack');
const keepTemp = process.env.SMOKE_KEEP_TMP === '1' || process.env.SMOKE_KEEP_TMP === 'true';
const architectureRefreshCommand = process.env.SMOKE_ARCHITECTURE_REFRESH_CMD;
const logDir = path.join(repoRoot, '.tmp', 'smoke-live');
const logPath = path.join(logDir, 'latest.md');

const logLines = [
  '# Quality GC Live Smoke',
  '',
  `Started: ${new Date().toISOString()}`,
  `Temp root: ${tempRoot}`,
  '',
];

function writeText(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function appendLog(section) {
  logLines.push(...section, '');
}

function commandText(command, args) {
  return [command, ...args.map(arg => (arg.includes(' ') ? JSON.stringify(arg) : arg))].join(' ');
}

function run(command, args, options = {}) {
  const started = Date.now();
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: { ...process.env, ...(options.env ?? {}) },
    encoding: 'utf8',
  });
  const durationMs = Date.now() - started;
  const ok = result.status === 0;

  appendLog([
    `## ${options.title ?? commandText(command, args)}`,
    '',
    `Command: \`${commandText(command, args)}\``,
    `CWD: \`${options.cwd ?? repoRoot}\``,
    `Exit: ${result.status ?? 'signal'} (${durationMs}ms)`,
    '',
    '<details><summary>stdout</summary>',
    '',
    '```text',
    (result.stdout ?? '').trim(),
    '```',
    '',
    '</details>',
    '',
    '<details><summary>stderr</summary>',
    '',
    '```text',
    (result.stderr ?? '').trim(),
    '```',
    '',
    '</details>',
  ]);

  if (!ok && !options.allowFailure) {
    throw new Error(`Command failed: ${commandText(command, args)}`);
  }

  return result;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
  appendLog([`- PASS: ${message}`]);
}

function readJson(filePath) {
  return JSON.parse(readText(filePath));
}

function writeJson(filePath, value) {
  writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function parseJsonCommandResult(result, label) {
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`Could not parse JSON from ${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function npmPackageSource(packageJson) {
  const spec = packageJson.devDependencies?.['quality-gc'];
  assert(typeof spec === 'string' && spec.length > 0, 'fixture package.json records quality-gc as a dev dependency');
  return spec;
}

function applyContractArchitectureRefresh(configPath) {
  const referencePath = path.join(
    fixtureRoot,
    '.codex/skills/quality-gc-setup-agent/references/architecture-boundary-synthesis.md',
  );
  const reference = readText(referencePath);
  assert(reference.includes('Classify the project shape before choosing rule types.'), 'installed reference contains project-shape classification rule');
  assert(reference.includes('Refresh Triggers'), 'installed reference documents architecture refresh triggers');

  const config = readText(configPath);
  const replacement = [
    '      "boundaries": [],',
    '      "layerBoundaries": [',
    '        {',
    '          "id": "billing",',
    '          "layers": [',
    '            { "id": "domain", "paths": ["src/billing/domain"] },',
    '            { "id": "persistence", "paths": ["src/billing/persistence"] }',
    '          ],',
    '          "rules": [',
    '            {',
    '              "from": "domain",',
    '              "disallow": ["persistence"],',
    '              "message": "billing domain must not import persistence directly"',
    '            }',
    '          ]',
    '        }',
    '      ],',
  ].join('\n');

  assert(config.includes('      "boundaries": []'), 'generated config contains the architecture boundaries anchor');
  writeText(configPath, config.replace('      "boundaries": []', replacement));
  appendLog([
    '## Contract architecture refresh',
    '',
    'No `SMOKE_ARCHITECTURE_REFRESH_CMD` was provided, so the smoke used the installed synthesis reference to apply the expected architecture-refresh output shape locally.',
  ]);
}

function refreshArchitectureConfig(configPath) {
  if (architectureRefreshCommand) {
    run(process.env.SHELL ?? 'sh', ['-lc', architectureRefreshCommand], {
      cwd: fixtureRoot,
      title: 'Run external architecture refresh command',
      env: {
        QUALITY_GC_SMOKE_FIXTURE_ROOT: fixtureRoot,
        QUALITY_GC_SMOKE_CONFIG_PATH: configPath,
      },
    });
  } else {
    applyContractArchitectureRefresh(configPath);
  }

  const refreshedConfig = readText(configPath);
  assert(refreshedConfig.includes('"layerBoundaries"'), 'architecture refresh wrote layer boundaries into config');
  assert(refreshedConfig.includes('src/billing/domain'), 'architecture refresh covered the billing domain source root');
}

function main() {
  fs.mkdirSync(logDir, { recursive: true });
  fs.mkdirSync(packRoot, { recursive: true });
  fs.mkdirSync(fixtureRoot, { recursive: true });

  const pack = run('npm', ['pack', '--pack-destination', packRoot], {
    title: 'Pack local quality-gc tarball',
  });
  const tarballName = pack.stdout.trim().split('\n').find(line => line.endsWith('.tgz'));
  assert(Boolean(tarballName), 'npm pack produced a tarball name');
  const tarballPath = path.join(packRoot, tarballName);
  assert(fs.existsSync(tarballPath), 'packed tarball exists on disk');

  writeJson(path.join(fixtureRoot, 'package.json'), {
    name: 'quality-gc-smoke-fixture',
    version: '1.0.0',
    type: 'module',
  });
  writeText(path.join(fixtureRoot, 'src/index.ts'), 'export const value: string = "ok";\n');
  run('git', ['init'], { cwd: fixtureRoot, title: 'Initialize fixture git repository' });
  run('git', ['config', 'user.email', 'quality-gc-smoke@example.com'], { cwd: fixtureRoot });
  run('git', ['config', 'user.name', 'Quality GC Smoke'], { cwd: fixtureRoot });
  run('git', ['add', '.'], { cwd: fixtureRoot });

  run('npm', ['install', '--save-dev', tarballPath, '--foreground-scripts'], {
    cwd: fixtureRoot,
    title: 'Install packed quality-gc into fixture',
    env: { QUALITY_GC_INSTALL_SKILL: 'skip' },
  });
  const packageSource = npmPackageSource(readJson(path.join(fixtureRoot, 'package.json')));

  const setupPreview = run('npx', ['quality-gc', 'setup', '--root', '.', '--json', '--package-source', packageSource], {
    cwd: fixtureRoot,
    title: 'Preview setup plan',
  });
  const setupPayload = parseJsonCommandResult(setupPreview, 'setup preview');
  assert(setupPayload.changes.some(change => change.path === '.quality-gc/quality-gc.config.mjs'), 'setup preview includes Quality GC config');
  assert(setupPayload.changes.some(change => change.path === '.github/workflows/quality-gc-architecture.yml'), 'setup preview includes architecture workflow');

  run('npx', ['quality-gc', 'setup', '--root', '.', '--apply', '--package-source', packageSource], {
    cwd: fixtureRoot,
    title: 'Apply setup plan',
  });
  assert(fs.existsSync(path.join(fixtureRoot, '.quality-gc/quality-gc.config.mjs')), 'setup wrote Quality GC config');
  assert(fs.existsSync(path.join(fixtureRoot, '.quality-gc/no-new-any-baseline.json')), 'setup wrote no-new-any baseline');
  assert(fs.existsSync(path.join(fixtureRoot, '.github/workflows/quality-gc-architecture.yml')), 'setup wrote architecture workflow');
  assert(readJson(path.join(fixtureRoot, 'package.json')).scripts['quality:gc:architecture-drift'], 'setup added architecture drift package script');

  run('npx', ['quality-gc', 'install-skill', '--target', 'codex', '--scope', 'project', '--root', '.', '--apply'], {
    cwd: fixtureRoot,
    title: 'Install Codex skill into fixture',
  });
  assert(fs.existsSync(path.join(fixtureRoot, '.codex/skills/quality-gc-setup-agent/SKILL.md')), 'Codex skill installed');
  assert(
    fs.existsSync(path.join(fixtureRoot, '.codex/skills/quality-gc-setup-agent/references/architecture-boundary-synthesis.md')),
    'architecture synthesis reference installed with Codex skill',
  );

  run('npx', ['quality-gc', 'architecture', '--root', '.'], {
    cwd: fixtureRoot,
    title: 'Architecture guard passes with generated empty config',
  });
  run('npx', ['quality-gc', 'architecture-drift', '--root', '.'], {
    cwd: fixtureRoot,
    title: 'Architecture drift command is advisory',
  });

  writeText(path.join(fixtureRoot, 'src/new-any.ts'), 'export const value: any = "new";\n');
  const guardFailure = run('npx', ['quality-gc', 'run', '--root', '.', '--json'], {
    cwd: fixtureRoot,
    title: 'Guardrails fail for new explicit any',
    allowFailure: true,
  });
  assert(guardFailure.status !== 0, 'guardrails fail when new explicit any is introduced');
  assert(guardFailure.stdout.includes('no-new-any'), 'guardrail failure includes no-new-any');
  fs.rmSync(path.join(fixtureRoot, 'src/new-any.ts'));

  writeText(
    path.join(fixtureRoot, 'src/billing/domain/render-snapshot.entity.ts'),
    "import type { BillingRecord } from '../persistence/billing.record';\nexport interface BillingSnapshot { record?: BillingRecord; }\n",
  );
  writeText(path.join(fixtureRoot, 'src/billing/persistence/billing.record.ts'), 'export interface BillingRecord { id: string; }\n');

  const initialDrift = run('npx', ['quality-gc', 'architecture-drift', '--root', '.', '--json'], {
    cwd: fixtureRoot,
    title: 'Architecture drift detects module that needs refresh',
  });
  const initialDriftPayload = parseJsonCommandResult(initialDrift, 'initial architecture drift');
  assert(
    initialDriftPayload.findings.some(finding =>
      finding.evidence.some(item => item.path === 'src/billing' || item.path.startsWith('src/billing/')),
    ),
    'architecture-drift detects billing module before refresh',
  );

  refreshArchitectureConfig(path.join(fixtureRoot, '.quality-gc/quality-gc.config.mjs'));

  const architectureFailure = run('npx', ['quality-gc', 'architecture', '--root', '.'], {
    cwd: fixtureRoot,
    title: 'Architecture guard catches configured layer violation',
    allowFailure: true,
  });
  assert(architectureFailure.status !== 0, 'architecture guard fails for configured domain-to-persistence import');
  assert(architectureFailure.stdout.includes('billing domain must not import persistence directly'), 'architecture violation uses configured message');

  const refreshedDrift = run('npx', ['quality-gc', 'architecture-drift', '--root', '.', '--json'], {
    cwd: fixtureRoot,
    title: 'Architecture drift is clear after refresh',
  });
  const refreshedDriftPayload = parseJsonCommandResult(refreshedDrift, 'refreshed architecture drift');
  assert(refreshedDriftPayload.findings.length === 0, 'architecture refresh clears drift for current fixture modules');

  writeText(path.join(fixtureRoot, 'src/reports/domain/report.ts'), 'export const report = "uncovered";\n');

  const drift = run('npx', ['quality-gc', 'architecture-drift', '--root', '.', '--json'], {
    cwd: fixtureRoot,
    title: 'Architecture drift reports newly added source module',
  });
  const driftPayload = parseJsonCommandResult(drift, 'architecture drift');
  assert(driftPayload.findings.some(finding => finding.key === 'architecture-config-drift'), 'architecture-drift reports config drift');

  const cleanup = run('npx', ['quality-gc', 'cleanup-scan', '--root', '.', '--dry-run', '--json'], {
    cwd: fixtureRoot,
    title: 'Cleanup scan reports architecture drift finding',
  });
  const cleanupPayload = parseJsonCommandResult(cleanup, 'cleanup scan');
  assert(cleanupPayload.findings.some(finding => finding.key === 'architecture-config-drift'), 'cleanup-scan includes architecture-config-drift finding');
  assert(cleanupPayload.issueActions.some(action => action.title.includes('architecture-config-drift')), 'cleanup-scan plans issue action for architecture drift');

  appendLog([
    '## Result',
    '',
    'PASS: live package smoke completed.',
  ]);
}

try {
  main();
  process.exitCode = 0;
} catch (error) {
  appendLog([
    '## Failure',
    '',
    error instanceof Error ? error.stack ?? error.message : String(error),
  ]);
  process.exitCode = 1;
} finally {
  appendLog([`Finished: ${new Date().toISOString()}`]);
  fs.mkdirSync(logDir, { recursive: true });
  fs.writeFileSync(logPath, `${logLines.join('\n')}\n`);
  if (!keepTemp) {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  } else {
    console.log(`Smoke temp preserved: ${tempRoot}`);
  }
  console.log(`Smoke log: ${logPath}`);
}
