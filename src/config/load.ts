import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { CONFIG_FILE, defaultConfig, type QualityGcConfig, type RuleStatus } from './schema.js';
import { fileExists } from '../util/fs.js';

const SUPPORTED_FORBIDDEN_SYNTAX = new Set(['process.env']);

function isRuleStatus(value: unknown): value is RuleStatus {
  return value === 'blocking' || value === 'candidate' || value === 'disabled';
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requireObject(value: unknown, name: string): Record<string, unknown> {
  if (!isObject(value)) {
    throw new Error(`Quality GC config ${name} must be an object.`);
  }
  return value;
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Quality GC config ${name} must be a non-empty string.`);
  }
  return value;
}

function requireBoolean(value: unknown, name: string): void {
  if (typeof value !== 'boolean') {
    throw new Error(`Quality GC config ${name} must be a boolean.`);
  }
}

function requireStringArray(value: unknown, name: string, options: { allowEmpty?: boolean } = {}): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`Quality GC config ${name} must be an array of strings.`);
  }
  if (!options.allowEmpty && value.length === 0) {
    throw new Error(`Quality GC config ${name} must not be empty.`);
  }
  for (const [index, entry] of value.entries()) {
    requireString(entry, `${name}[${index}]`);
  }
  return value;
}

function requireOptionalStringArray(value: unknown, name: string): string[] {
  if (value === undefined) {
    return [];
  }
  return requireStringArray(value, name, { allowEmpty: true });
}

function validateOptionalString(value: unknown, name: string): void {
  if (value !== undefined) {
    requireString(value, name);
  }
}

function validateOptionalStatus(value: unknown, name: string): void {
  if (value !== undefined && !isRuleStatus(value)) {
    throw new Error(`Quality GC config ${name} must be blocking, candidate, or disabled.`);
  }
}

function validateArchitectureConfig(config: Partial<QualityGcConfig>): void {
  const architecture = requireObject(config.rules?.architecture, 'rules.architecture');
  const boundaries = architecture.boundaries;
  if (!Array.isArray(boundaries)) {
    throw new Error('Quality GC config rules.architecture.boundaries must be an array.');
  }

  for (const [index, boundary] of boundaries.entries()) {
    const entry = requireObject(boundary, `rules.architecture.boundaries[${index}]`);
    requireStringArray(entry.from, `rules.architecture.boundaries[${index}].from`);
    requireStringArray(entry.disallowImportsFrom, `rules.architecture.boundaries[${index}].disallowImportsFrom`);
    validateOptionalString(entry.message, `rules.architecture.boundaries[${index}].message`);
    validateOptionalStatus(entry.status, `rules.architecture.boundaries[${index}].status`);
  }

  validateServiceRoots(architecture.serviceRoots);
  validateDomains(architecture.domains);
  validatePathImportBoundaries(architecture.pathImportBoundaries);
  validateLayerBoundaries(architecture.layerBoundaries);
  validateExternalImportBoundaries(architecture.externalImportBoundaries);
  validateSyntaxBoundaries(architecture.syntaxBoundaries);
}

function validateCleanupScanConfig(config: Partial<QualityGcConfig>): void {
  const cleanupScan = requireObject(config.cleanupScan, 'cleanupScan');
  requireStringArray(cleanupScan.labels, 'cleanupScan.labels');
  requireStringArray(cleanupScan.trackedLocalArtifactRoots, 'cleanupScan.trackedLocalArtifactRoots');
  requireOptionalStringArray(cleanupScan.reviewedLocalArtifactPaths, 'cleanupScan.reviewedLocalArtifactPaths');
}

function validateStaleLivePathConfig(config: Partial<QualityGcConfig>): void {
  const staleLivePath = requireObject(config.rules?.staleLivePath, 'rules.staleLivePath');
  requireStringArray(staleLivePath.retiredPaths, 'rules.staleLivePath.retiredPaths', { allowEmpty: true });
  requireOptionalStringArray(staleLivePath.includePaths, 'rules.staleLivePath.includePaths');
  requireOptionalStringArray(staleLivePath.excludePaths, 'rules.staleLivePath.excludePaths');
}

function validateServiceRoots(value: unknown): void {
  if (value === undefined) {
    return;
  }
  if (!Array.isArray(value)) {
    throw new Error('Quality GC config rules.architecture.serviceRoots must be an array.');
  }
  for (const [index, serviceRoot] of value.entries()) {
    const entry = requireObject(serviceRoot, `rules.architecture.serviceRoots[${index}]`);
    requireString(entry.id, `rules.architecture.serviceRoots[${index}].id`);
    requireString(entry.path, `rules.architecture.serviceRoots[${index}].path`);
    validateOptionalString(entry.packageName, `rules.architecture.serviceRoots[${index}].packageName`);
    validateOptionalStatus(entry.status, `rules.architecture.serviceRoots[${index}].status`);
    if (entry.public !== undefined) {
      requireBoolean(entry.public, `rules.architecture.serviceRoots[${index}].public`);
    }
  }
}

function validateDomains(value: unknown): void {
  if (value === undefined) {
    return;
  }
  if (!Array.isArray(value)) {
    throw new Error('Quality GC config rules.architecture.domains must be an array.');
  }
  for (const [index, domain] of value.entries()) {
    const entry = requireObject(domain, `rules.architecture.domains[${index}]`);
    validateOptionalString(entry.id, `rules.architecture.domains[${index}].id`);
    requireString(entry.root, `rules.architecture.domains[${index}].root`);
    requireOptionalStringArray(entry.publicEntryPoints, `rules.architecture.domains[${index}].publicEntryPoints`);
    requireOptionalStringArray(entry.internalConsumerRoots, `rules.architecture.domains[${index}].internalConsumerRoots`);
    validateOptionalString(entry.message, `rules.architecture.domains[${index}].message`);
    validateOptionalStatus(entry.status, `rules.architecture.domains[${index}].status`);
  }
}

function validatePathImportBoundaries(value: unknown): void {
  if (value === undefined) {
    return;
  }
  if (!Array.isArray(value)) {
    throw new Error('Quality GC config rules.architecture.pathImportBoundaries must be an array.');
  }
  for (const [index, boundary] of value.entries()) {
    const entry = requireObject(boundary, `rules.architecture.pathImportBoundaries[${index}]`);
    validateOptionalString(entry.id, `rules.architecture.pathImportBoundaries[${index}].id`);
    requireStringArray(entry.fromPaths, `rules.architecture.pathImportBoundaries[${index}].fromPaths`);
    requireStringArray(entry.targetPaths, `rules.architecture.pathImportBoundaries[${index}].targetPaths`);
    validateOptionalString(entry.message, `rules.architecture.pathImportBoundaries[${index}].message`);
    validateOptionalStatus(entry.status, `rules.architecture.pathImportBoundaries[${index}].status`);
  }
}

function validateLayerBoundaries(value: unknown): void {
  if (value === undefined) {
    return;
  }
  if (!Array.isArray(value)) {
    throw new Error('Quality GC config rules.architecture.layerBoundaries must be an array.');
  }
  for (const [boundaryIndex, boundary] of value.entries()) {
    const entry = requireObject(boundary, `rules.architecture.layerBoundaries[${boundaryIndex}]`);
    validateOptionalString(entry.id, `rules.architecture.layerBoundaries[${boundaryIndex}].id`);
    validateOptionalStatus(entry.status, `rules.architecture.layerBoundaries[${boundaryIndex}].status`);
    if (!Array.isArray(entry.layers) || entry.layers.length === 0) {
      throw new Error(`Quality GC config rules.architecture.layerBoundaries[${boundaryIndex}].layers must not be empty.`);
    }
    const layerIds = new Set<string>();
    for (const [layerIndex, layer] of entry.layers.entries()) {
      const layerEntry = requireObject(layer, `rules.architecture.layerBoundaries[${boundaryIndex}].layers[${layerIndex}]`);
      const layerId = requireString(layerEntry.id, `rules.architecture.layerBoundaries[${boundaryIndex}].layers[${layerIndex}].id`);
      if (layerIds.has(layerId)) {
        throw new Error(`Quality GC config rules.architecture.layerBoundaries[${boundaryIndex}] has duplicate layer id ${layerId}.`);
      }
      layerIds.add(layerId);
      requireStringArray(layerEntry.paths, `rules.architecture.layerBoundaries[${boundaryIndex}].layers[${layerIndex}].paths`);
    }

    if (!Array.isArray(entry.rules)) {
      throw new Error(`Quality GC config rules.architecture.layerBoundaries[${boundaryIndex}].rules must be an array.`);
    }
    for (const [ruleIndex, rule] of entry.rules.entries()) {
      const ruleEntry = requireObject(rule, `rules.architecture.layerBoundaries[${boundaryIndex}].rules[${ruleIndex}]`);
      const from = requireString(ruleEntry.from, `rules.architecture.layerBoundaries[${boundaryIndex}].rules[${ruleIndex}].from`);
      if (!layerIds.has(from)) {
        throw new Error(`Quality GC config layer rule references unknown from layer ${from}.`);
      }
      const disallow = requireStringArray(
        ruleEntry.disallow,
        `rules.architecture.layerBoundaries[${boundaryIndex}].rules[${ruleIndex}].disallow`,
      );
      for (const disallowedLayer of disallow) {
        if (!layerIds.has(disallowedLayer)) {
          throw new Error(`Quality GC config layer rule references unknown disallowed layer ${disallowedLayer}.`);
        }
      }
      validateOptionalString(ruleEntry.message, `rules.architecture.layerBoundaries[${boundaryIndex}].rules[${ruleIndex}].message`);
      validateOptionalStatus(ruleEntry.status, `rules.architecture.layerBoundaries[${boundaryIndex}].rules[${ruleIndex}].status`);
    }
  }
}

function validateExternalImportBoundaries(value: unknown): void {
  if (value === undefined) {
    return;
  }
  if (!Array.isArray(value)) {
    throw new Error('Quality GC config rules.architecture.externalImportBoundaries must be an array.');
  }
  for (const [index, boundary] of value.entries()) {
    const entry = requireObject(boundary, `rules.architecture.externalImportBoundaries[${index}]`);
    validateOptionalString(entry.id, `rules.architecture.externalImportBoundaries[${index}].id`);
    requireStringArray(entry.sourcePaths, `rules.architecture.externalImportBoundaries[${index}].sourcePaths`);
    requireOptionalStringArray(entry.exceptPaths, `rules.architecture.externalImportBoundaries[${index}].exceptPaths`);
    requireStringArray(
      entry.forbiddenImportSpecifiers,
      `rules.architecture.externalImportBoundaries[${index}].forbiddenImportSpecifiers`,
    );
    validateOptionalString(entry.message, `rules.architecture.externalImportBoundaries[${index}].message`);
    validateOptionalStatus(entry.status, `rules.architecture.externalImportBoundaries[${index}].status`);
  }
}

function validateSyntaxBoundaries(value: unknown): void {
  if (value === undefined) {
    return;
  }
  if (!Array.isArray(value)) {
    throw new Error('Quality GC config rules.architecture.syntaxBoundaries must be an array.');
  }
  for (const [index, boundary] of value.entries()) {
    const entry = requireObject(boundary, `rules.architecture.syntaxBoundaries[${index}]`);
    validateOptionalString(entry.id, `rules.architecture.syntaxBoundaries[${index}].id`);
    requireStringArray(entry.sourcePaths, `rules.architecture.syntaxBoundaries[${index}].sourcePaths`);
    requireOptionalStringArray(entry.exceptPaths, `rules.architecture.syntaxBoundaries[${index}].exceptPaths`);
    const forbiddenSyntax = requireStringArray(entry.forbiddenSyntax, `rules.architecture.syntaxBoundaries[${index}].forbiddenSyntax`);
    for (const syntax of forbiddenSyntax) {
      if (!SUPPORTED_FORBIDDEN_SYNTAX.has(syntax)) {
        throw new Error(`Quality GC config unsupported forbidden syntax ${syntax}.`);
      }
    }
    if (entry.includeTests !== undefined) {
      requireBoolean(entry.includeTests, `rules.architecture.syntaxBoundaries[${index}].includeTests`);
    }
    validateOptionalString(entry.message, `rules.architecture.syntaxBoundaries[${index}].message`);
    validateOptionalStatus(entry.status, `rules.architecture.syntaxBoundaries[${index}].status`);
  }
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

  validateArchitectureConfig(config);
  validateStaleLivePathConfig(config);
  validateCleanupScanConfig(config);

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
