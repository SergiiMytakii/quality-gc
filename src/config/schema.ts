import fs from 'node:fs';

const packageJson = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
  version: string;
};

export const PACKAGE_VERSION = packageJson.version;
export const CONFIG_FILE = '.quality-gc/quality-gc.config.mjs';
export const NO_NEW_ANY_BASELINE_FILE = '.quality-gc/no-new-any-baseline.json';
export const DEFAULT_NO_NEW_ANY_INCLUDE = ['src/**/*.{ts,tsx}'];
export const DEFAULT_NO_NEW_ANY_EXCLUDE = [
  '**/__tests__/**',
  '**/*.spec.ts',
  '**/*.spec.tsx',
  '**/*.test.ts',
  '**/*.test.tsx',
  '**/scripts/**',
];

export type RuleStatus = 'blocking' | 'candidate' | 'disabled';

export interface ArchitectureRuleStatus {
  status?: RuleStatus;
}

export interface ArchitectureBoundary extends ArchitectureRuleStatus {
  from: string[];
  disallowImportsFrom: string[];
  message?: string;
}

export interface ArchitectureServiceRoot extends ArchitectureRuleStatus {
  id: string;
  path: string;
  packageName?: string;
  public?: boolean;
}

export interface ArchitectureDomainBoundary extends ArchitectureRuleStatus {
  id?: string;
  root: string;
  publicEntryPoints?: string[];
  internalConsumerRoots?: string[];
  message?: string;
}

export interface ArchitecturePathImportBoundary extends ArchitectureRuleStatus {
  id?: string;
  fromPaths: string[];
  targetPaths: string[];
  message?: string;
}

export interface ArchitectureLayer {
  id: string;
  paths: string[];
}

export interface ArchitectureLayerRule extends ArchitectureRuleStatus {
  from: string;
  disallow: string[];
  message?: string;
}

export interface ArchitectureLayerBoundary extends ArchitectureRuleStatus {
  id?: string;
  layers: ArchitectureLayer[];
  rules: ArchitectureLayerRule[];
}

export interface ArchitectureExternalImportBoundary extends ArchitectureRuleStatus {
  id?: string;
  sourcePaths: string[];
  exceptPaths?: string[];
  forbiddenImportSpecifiers: string[];
  message?: string;
}

export interface ArchitectureSyntaxBoundary extends ArchitectureRuleStatus {
  id?: string;
  sourcePaths: string[];
  exceptPaths?: string[];
  forbiddenSyntax: string[];
  includeTests?: boolean;
  message?: string;
}

export interface QualityGcConfig {
  schemaVersion: 1;
  installedVersion: string;
  rules: {
    architecture: {
      status: RuleStatus;
      boundaries: ArchitectureBoundary[];
      serviceRoots?: ArchitectureServiceRoot[];
      domains?: ArchitectureDomainBoundary[];
      pathImportBoundaries?: ArchitecturePathImportBoundary[];
      layerBoundaries?: ArchitectureLayerBoundary[];
      externalImportBoundaries?: ArchitectureExternalImportBoundary[];
      syntaxBoundaries?: ArchitectureSyntaxBoundary[];
    };
    noNewAny: {
      status: RuleStatus;
      baselineFile: string;
      include: string[];
      exclude: string[];
    };
    staleLivePath: {
      status: RuleStatus;
      retiredPaths: string[];
    };
  };
  cleanupScan: {
    labels: string[];
    trackedLocalArtifactRoots: string[];
  };
}

export const QUALITY_GC_LABELS = [
  'quality-gc',
  'cleanup',
  'quality-gc:candidate-rule',
  'quality-gc:architecture-drift',
  'quality-gc:tracked-artifact',
  'quality-gc:promotion',
] as const;

export function defaultConfig(installedVersion = PACKAGE_VERSION): QualityGcConfig {
  return {
    schemaVersion: 1,
    installedVersion,
    rules: {
      architecture: {
        status: 'blocking',
        boundaries: [],
      },
      noNewAny: {
        status: 'blocking',
        baselineFile: NO_NEW_ANY_BASELINE_FILE,
        include: [...DEFAULT_NO_NEW_ANY_INCLUDE],
        exclude: [...DEFAULT_NO_NEW_ANY_EXCLUDE],
      },
      staleLivePath: {
        status: 'candidate',
        retiredPaths: [],
      },
    },
    cleanupScan: {
      labels: [...QUALITY_GC_LABELS],
      trackedLocalArtifactRoots: ['.tmp', 'tmp', 'logs', 'output'],
    },
  };
}

export function renderConfig(config: QualityGcConfig = defaultConfig()): string {
  return `export default ${JSON.stringify(config, null, 2)};\n`;
}
