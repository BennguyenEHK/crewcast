import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

export interface Engine {
  id: string;                 // 'claude' | 'gemini' | 'codex' | 'copilot' | 'kiro'
  bin: string;                // executable on PATH
  versionArgs: string[];      // probe, e.g. ['--version']
  headless: string[];         // run template with a {task} token
  models: string[];           // working models (seed; first is the default)
  strongModel: string | null; // model for risky tasks
  modelFlag: string | null;   // model appended as [modelFlag, model]
  effortArgs: string[];       // template with {effort}; [] if the CLI has no effort knob
  highEffort: string | null;  // the high-effort value
  parallelLimit: number;
  writeFlags: string[];
  readFlags: string[];
  safeFlags: string[];        // always-on safe flags (never permission-off)
  autoMode: boolean;          // CLI has its own auto mode → crewcast stops choosing model/effort
  installed?: boolean;
  version?: string | null;
}

// Seed recipes from spec §7.6. Vendor facts to verify (§10); doctor (Phase 1d) checks them against --help.
export const DEFAULT_ENGINES: Engine[] = [
  { id: 'claude', bin: 'claude', versionArgs: ['--version'], headless: ['-p', '{task}'], models: ['default'], strongModel: null, modelFlag: '--model', effortArgs: [], highEffort: null, parallelLimit: 1, writeFlags: [], readFlags: [], safeFlags: [], autoMode: false },
  { id: 'gemini', bin: 'gemini', versionArgs: ['--version'], headless: ['-p', '{task}'], models: ['default'], strongModel: null, modelFlag: '-m', effortArgs: [], highEffort: null, parallelLimit: 1, writeFlags: [], readFlags: [], safeFlags: ['-y', '--output-format', 'json'], autoMode: false },
  { id: 'codex', bin: 'codex', versionArgs: ['--version'], headless: ['exec', '{task}'], models: ['default'], strongModel: null, modelFlag: '--model', effortArgs: ['-c', "model_reasoning_effort={effort}"], highEffort: 'high', parallelLimit: 2, writeFlags: ['--sandbox', 'workspace-write'], readFlags: ['--sandbox', 'read-only'], safeFlags: ['--json'], autoMode: false },
  { id: 'copilot', bin: 'copilot', versionArgs: ['--version'], headless: ['-p', '{task}'], models: ['default'], strongModel: null, modelFlag: '--model', effortArgs: [], highEffort: null, parallelLimit: 1, writeFlags: [], readFlags: [], safeFlags: ['--allow-all-tools', '-s'], autoMode: false },
  { id: 'kiro', bin: 'kiro-cli', versionArgs: ['--version'], headless: ['{task}'], models: ['default'], strongModel: null, modelFlag: null, effortArgs: [], highEffort: null, parallelLimit: 1, writeFlags: [], readFlags: [], safeFlags: [], autoMode: true },
];

export class EngineCatalog {
  private readonly run: (bin: string, args: string[]) => Promise<string>;

  constructor(deps: { run?: (bin: string, args: string[]) => Promise<string> } = {}) {
    this.run = deps.run ?? (async (bin, args) => (await execFileP(bin, args)).stdout);
  }

  // Probe each engine's version. A failure marks it absent and never aborts the others.
  async detect(engines: Engine[] = DEFAULT_ENGINES): Promise<Engine[]> {
    return Promise.all(engines.map(async e => {
      try {
        const out = await this.run(e.bin, e.versionArgs);
        const first = (out.split(/\r?\n/)[0] ?? '').trim();
        return { ...e, installed: true, version: first || null };
      } catch {
        return { ...e, installed: false, version: null };
      }
    }));
  }

  async save(engines: Engine[], home: string): Promise<void> {
    await mkdir(home, { recursive: true });
    await writeFile(join(home, 'engine-catalog.json'), JSON.stringify(engines, null, 2), 'utf8');
  }

  // Missing or corrupt file → the seed defaults, never a throw.
  static async load(home: string): Promise<Engine[]> {
    try {
      const parsed = JSON.parse(await readFile(join(home, 'engine-catalog.json'), 'utf8'));
      return Array.isArray(parsed) && parsed.length ? (parsed as Engine[]) : DEFAULT_ENGINES;
    } catch {
      return DEFAULT_ENGINES;
    }
  }
}
