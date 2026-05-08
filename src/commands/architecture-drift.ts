import { collectArchitectureDriftFindings } from '../cleanup/architecture-drift.js';
import { loadConfig } from '../config/load.js';

export interface ArchitectureDriftCommandOptions {
  root: string;
  json: boolean;
  failOnFindings: boolean;
}

export async function runArchitectureDriftCommand(options: ArchitectureDriftCommandOptions): Promise<number> {
  const config = await loadConfig(options.root);
  const findings = collectArchitectureDriftFindings(options.root, config);

  if (options.json) {
    console.log(JSON.stringify({ findings }, null, 2));
  } else if (findings.length === 0) {
    console.log('Quality GC architecture config coverage is current.');
  } else {
    console.log(`Quality GC architecture config may need refresh: ${findings[0].evidence.length} uncovered source root(s).`);
    for (const evidence of findings[0].evidence) {
      console.log(`::warning title=Quality GC architecture config drift::${evidence.path} - ${evidence.detail}`);
    }
  }

  return options.failOnFindings && findings.length > 0 ? 1 : 0;
}
