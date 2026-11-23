import { DEFAULT_ENGINES, EngineCatalog, type Engine } from '../engines/catalog.js';

export interface DoctorReport {
  engines: { id: string; installed: boolean; staleFlags: string[] }[];
  warmed: string[];
}

// Re-detects CLIs, checks each catalog flag against the CLI's --help (catches stale vendor facts), and pre-warms the models.
export class Doctor {
  constructor(
    private readonly deps: {
      baseUrl: string;
      run: (bin: string, args: string[]) => Promise<string>;
      warm: (model: string) => Promise<void>;
    },
  ) {}

  async run(engines: Engine[] = DEFAULT_ENGINES): Promise<DoctorReport> {
    const detected = await new EngineCatalog({ run: this.deps.run }).detect(engines);
    const report: DoctorReport = { engines: [], warmed: [] };
    for (const e of detected) {
      if (!e.installed) {
        report.engines.push({ id: e.id, installed: false, staleFlags: [] });
        continue;
      }
      let help: string;
      try {
        help = await this.deps.run(e.bin, ['--help']);
      } catch {
        report.engines.push({ id: e.id, installed: true, staleFlags: [] }); // can't read help → can't check
        continue;
      }
      const flags = [e.modelFlag, ...e.writeFlags, ...e.readFlags, ...e.safeFlags, ...e.effortArgs]
        .filter((f): f is string => !!f && f.startsWith('-'));
      const staleFlags = [...new Set(flags)].filter(f => !help.includes(f));
      report.engines.push({ id: e.id, installed: true, staleFlags });
    }
    for (const model of ['mxbai-embed-large', 'kev:4b-q4_K_M']) {
      await this.deps.warm(model);
      report.warmed.push(model);
    }
    return report;
  }
}
