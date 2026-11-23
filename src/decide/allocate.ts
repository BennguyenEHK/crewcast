import type { Engine } from '../engines/catalog.js';
import { resolveFlags } from '../engines/flags.js';
import type { RiskArea, Size } from './record.js';
import type { WorkUnit } from '../plan.js';

export interface UnitAllocation extends WorkUnit {
  group: number;
  engine: string;
  model: string;
  effort: string | null;
  args: string[];
  skills: string[];
  mcps: string[];
  leadFallback?: true;
}
export interface PlanAllocation { units: UnitAllocation[] }

// shortcut: keyword risk + file-count size; upgrade if it mis-grades a real plan.
const RISK: [RiskArea, RegExp][] = [
  ['secrets', /secret|credential|\.env/],
  ['payments', /payment|billing|stripe|charge/],
  ['auth', /auth|login|password|session|token/],
  ['db_schema', /schema|migration|migrate|\btable\b/],
  ['deploy', /deploy|release|publish|\bci\b/],
];

// Turns an approved plan.md into a per-unit crew allocation, locally and zero-token (§7.14). plan.md names no crew; this derives it.
export class PlanAllocator {
  private readonly leadEngine: string;
  private readonly workers: Engine[];

  constructor(private readonly deps: { engines: Engine[]; leadEngine?: string; pickSkills: (text: string) => Promise<string[]> }) {
    this.leadEngine = deps.leadEngine ?? 'claude';
    this.workers = deps.engines.filter(e => e.installed && e.id !== this.leadEngine);
  }

  async allocate(units: WorkUnit[]): Promise<PlanAllocation> {
    const byId = new Map(units.map(u => [u.id, u]));
    const group = this.group(units, byId);
    const out: UnitAllocation[] = [];
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      const signals = { writes_files: u.files.length > 0, size: size(u.files.length), risk_area: risk(u) };
      // shortcut: round-robin CLI assignment; upgrade to capability-based when a real policy exists.
      const lead = this.workers.length === 0;
      const engine = lead ? this.leadOrDefault() : this.workers[i % this.workers.length];
      const flags = resolveFlags(engine, signals);
      out.push({
        ...u,
        group: group.get(u.id)!,
        engine: engine.id,
        model: flags.model,
        effort: flags.effort,
        args: flags.args,
        skills: await this.deps.pickSkills(u.description),
        mcps: [], // per-unit MCP pick is the pending 1e MCP catalog (§7.5)
        ...(lead ? { leadFallback: true as const } : {}),
      });
    }
    return { units: out };
  }

  private leadOrDefault(): Engine {
    const lead = this.deps.engines.find(e => e.id === this.leadEngine);
    if (lead) return lead;
    throw new Error(`no installed worker engines and no lead engine '${this.leadEngine}' in the catalog`);
  }

  // Topological level per unit: 1 + max(dep level); no deps → 0. Throws on an unknown dep or a cycle.
  private group(units: WorkUnit[], byId: Map<string, WorkUnit>): Map<string, number> {
    const level = new Map<string, number>();
    const inProgress = new Set<string>();
    const visit = (id: string): number => {
      const cached = level.get(id);
      if (cached !== undefined) return cached;
      if (inProgress.has(id)) throw new Error(`dependency cycle at ${JSON.stringify(id)}`);
      const u = byId.get(id);
      if (!u) throw new Error(`unknown dependency: ${JSON.stringify(id)}`);
      inProgress.add(id);
      const g = u.depends.length === 0 ? 0 : 1 + Math.max(...u.depends.map(visit));
      inProgress.delete(id);
      level.set(id, g);
      return g;
    };
    for (const u of units) visit(u.id);
    return level;
  }
}

const size = (n: number): Size => (n <= 1 ? 'one_file' : n <= 4 ? 'few_files' : 'many_files');
const risk = (u: WorkUnit): RiskArea => {
  const hay = `${u.description} ${u.files.join(' ')}`.toLowerCase();
  return RISK.find(([, re]) => re.test(hay))?.[0] ?? 'none';
};
