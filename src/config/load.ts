import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { CONFIG_FILE, defaultConfig, type QualityGcConfig, type RuleStatus } from './schema.js';
import { fileExists } from '../util/fs.js';

function isRuleStatus(value: unknown): value is RuleStatus {
  return value === 'blocking' || value === 'candidate' || value === 'disabled';
}

export function validateConfig(value: unknown): QualityGcConfig {
  if (!value || typeof value !== 'object') {
    throw new Error('Quality GC config must export an object.');
  }

  const config = value as Partial<QualityGcConfig>;
  if (config.schemaVersion !== 1) {
    throw new Error('Quality GC config must set schemaVersion: 1.');
  }

  if (typeof config.installedVersion !== 'string' || config.installedVersion.length === 0) {
    throw new Error('Quality GC config must set installedVersion.');
  }

  if (!config.rules || typeof config.rules !== 'object') {
    throw new Error('Quality GC config must set rules.');
  }

  for (const ruleName of ['architecture', 'noNewAny', 'staleLivePath'] as const) {
    const rule = config.rules[ruleName] as { status?: unknown } | undefined;
    if (!rule || !isRuleStatus(rule.status)) {
      throw new Error(`Quality GC rule ${ruleName} must set a valid status.`);
    }
  }

  return config as QualityGcConfig;
}

export async function loadConfig(root: string): Promise<QualityGcConfig> {
  const configPath = path.join(root, CONFIG_FILE);
  if (!fileExists(configPath)) {
    return defaultConfig();
  }

  const moduleUrl = pathToFileURL(configPath);
  moduleUrl.search = `mtime=${Date.now()}`;
  const loaded = (await import(moduleUrl.href)) as { default?: unknown };
  return validateConfig(loaded.default);
}
