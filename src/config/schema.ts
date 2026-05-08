export const PACKAGE_VERSION = '0.1.0';
export const CONFIG_FILE = '.quality-gc/quality-gc.config.mjs';
export const NO_NEW_ANY_BASELINE_FILE = '.quality-gc/no-new-any-baseline.json';

export type RuleStatus = 'blocking' | 'candidate' | 'disabled';

export interface ArchitectureBoundary {
  from: string[];
  disallowImportsFrom: string[];
  message?: string;
}

export interface QualityGcConfig {
  schemaVersion: 1;
  installedVersion: string;
  rules: {
    architecture: {
      status: RuleStatus;
      boundaries: ArchitectureBoundary[];
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
        include: ['src/**/*.{ts,tsx}'],
        exclude: [
          'src/**/__tests__/**',
          'src/**/*.spec.ts',
          'src/**/*.spec.tsx',
          'src/**/*.test.ts',
          'src/**/*.test.tsx',
          'src/**/scripts/**',
        ],
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
