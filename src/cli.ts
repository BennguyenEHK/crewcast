import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { performance } from 'node:perf_hooks';
import { BackendError, SystemOneClient, type SystemOneRequest, type SystemOneResponse } from './backend/systemone.js';
import { SkillCatalog, type Skill } from './catalog/skills.js';
import { SkillIndex } from './catalog/skill-index.js';
import { Config } from './paths.js';
import { Decider } from './decide/decide.js';
import type { DecisionRecord } from './decide/record.js';
import { GitInspector } from './git.js';
import { ShadowLog, type Actual } from './shadow.js';
import { Agreement, type Report } from './agreement.js';
import { Evaluator } from './eval.js';
import { McpServer } from './mcp/server.js';
import { DecideTool } from './mcp/decide-tool.js';
import { CatalogTool } from './mcp/catalog-tool.js';
import { EngineCatalog } from './engines/catalog.js';

const USAGE = [
  'usage: crewcast <command>',
  '  decide [--model <name>] [--json] <task...>',
  '  label <id> --mode solo|team --skills a,b[,c]',
  '  stats',
  '  eval draft [--projects <dir>] [--out <file>] [--limit N] [--force]',
  '  eval [--model <name>] [file]',
  '  skills',
  '  engines [--json]',
  '  mcp',
  '  --version',
];

export class Cli {
  constructor(
    private readonly out: (line: string) => void,
    private readonly deps: Partial<{ ask: (r: SystemOneRequest) => Promise<SystemOneResponse>; env: NodeJS.ProcessEnv; cwd: string; run: (bin: string, args: string[]) => Promise<string> }> = {},
  ) {}

  async run(argv: string[]): Promise<number> {
    if (argv[0] === '--version') {
      const { version } = createRequire(import.meta.url)('../package.json') as { version: string };
      this.out(version);
      return 0;
    }
    if (argv[0] === 'skills') return this.listSkills();
    if (argv[0] === 'decide') return this.decide(argv.slice(1));
    if (argv[0] === 'label') return this.label(argv.slice(1));
    if (argv[0] === 'stats') return this.stats();
    if (argv[0] === 'eval') return argv[1] === 'draft' ? this.evalDraft(argv.slice(2)) : this.evalRun(argv.slice(1));
    if (argv[0] === 'engines') return this.engines(argv.slice(1));
    if (argv[0] === 'mcp') return this.mcp();
    USAGE.forEach(line => this.out(line));
    return 1;
  }

  private async engines(args: string[]): Promise<number> {
    let json = false;
    try {
      json = parseArgs({ args, options: { json: { type: 'boolean', default: false } } }).values.json;
    } catch {
      USAGE.forEach(line => this.out(line));
      return 1;
    }
    const cat = new EngineCatalog({ run: this.deps.run });
    const engines = await cat.detect();
    await cat.save(engines, this.crewcastHome());
    if (json) {
      this.out(JSON.stringify(engines));
      return 0;
    }
    for (const e of engines) {
      this.out(`${e.id} — ${e.installed ? `installed ${e.version ?? '?'}` : 'absent'}, model ${e.models[0]}, parallel ${e.parallelLimit}`);
    }
    return 0;
  }

  private async mcp(): Promise<number> {
    const server = await this.buildMcpServer();
    await server.serve(process.stdin, process.stdout);
    return 0;
  }

  private async buildMcpServer(): Promise<McpServer> {
    const { home, cwd } = this.paths();
    const baseUrl = new Config(this.deps.env).ollamaBaseUrl;
    const client = new SystemOneClient({ baseUrl });
    const ask = this.deps.ask ?? ((r: SystemOneRequest) => client.ask(r));
    const skills = await new SkillCatalog().load(await SkillCatalog.defaultDirs(home, cwd));
    const git = await new GitInspector().state(cwd);
    const crewHome = this.crewcastHome();
    const { version } = createRequire(import.meta.url)('../package.json') as { version: string };
    const tools = [
      new DecideTool({ ask, skills, git, home: crewHome, baseUrl, defaultModel: 'kev:4b-q4_K_M' }),
      new CatalogTool({ skills }),
    ];
    return new McpServer({ tools, serverInfo: { name: 'crewcast', version } });
  }

  private paths(): { home: string; cwd: string } {
    const env = this.deps.env ?? {};
    return {
      home: env.HOME ?? env.USERPROFILE ?? homedir(),
      cwd: this.deps.cwd ?? process.cwd(),
    };
  }

  private async listSkills(): Promise<number> {
    const { home, cwd } = this.paths();
    const started = performance.now();
    const dirs = await SkillCatalog.defaultDirs(home, cwd);
    const skills = await new SkillCatalog().load(dirs);
    const ms = Math.round(performance.now() - started);
    const sourceOf = (s: Skill) => dirname(dirname(s.path));
    for (const s of skills) this.out(`${s.name} — ${sourceOf(s)}`);
    for (const d of dirs) this.out(`${d.dir}: ${skills.filter(s => sourceOf(s) === d.dir).length} skills`);
    if (!dirs.some(d => d.prefix)) this.out('plugin skills: none (no enabled plugins, or installed_plugins.json / settings.json missing or unreadable)');
    this.out(`scan: ${ms} ms`);
    return 0;
  }

  private async decide(args: string[]): Promise<number> {
    let parsed;
    try {
      parsed = parseArgs({
        args,
        allowPositionals: true,
        options: { model: { type: 'string', default: 'kev:4b-q4_K_M' }, json: { type: 'boolean', default: false } },
      });
    } catch {
      USAGE.forEach(line => this.out(line));
      return 1;
    }
    const task = parsed.positionals.join(' ');
    if (!task) {
      USAGE.forEach(line => this.out(line));
      return 1;
    }

    const { home, cwd } = this.paths();
    const baseUrl = new Config(this.deps.env).ollamaBaseUrl;
    const client = new SystemOneClient({ baseUrl });
    const ask = this.deps.ask ?? ((r: SystemOneRequest) => client.ask(r));
    const skills = await new SkillCatalog().load(await SkillCatalog.defaultDirs(home, cwd));
    const git = await new GitInspector().state(cwd);
    const model = parsed.values.model;
    const index = new SkillIndex({ baseUrl, home: this.crewcastHome() });

    let rec;
    try {
      rec = await new Decider({ ask, skills, git, model, shortlist: (t, s) => index.top(t, s) }).decide(task);
    } catch (err) {
      if (!(err instanceof BackendError)) throw err;
      this.backendLine(err, baseUrl, model);
      return 2;
    }

    if (rec.shadow) await new ShadowLog(this.crewcastHome()).append(rec);
    if (parsed.values.json) {
      this.out(JSON.stringify(rec));
      return 0;
    }
    this.out(`mode: ${rec.mode}`);
    if (rec.error) this.out(`note: ${rec.error}`);
    this.out(`skills: ${rec.agents[0]?.skills.join(', ') || 'none'}`);
    this.out(`branch: ${rec.branch.action}${rec.branch.name ? ` ${rec.branch.name}` : ''}`);
    this.out(`ms: ${rec.ms}`);
    return 0;
  }

  private crewcastHome(): string {
    return new Config(this.deps.env ?? process.env).home;
  }

  private backendLine(err: BackendError, baseUrl: string, model: string): void {
    if (err.code === 'ollama_unreachable') this.out(`Ollama not reachable at ${baseUrl} — start Ollama`);
    else if (err.code === 'model_missing') this.out(`model '${model}' not found — run: ollama pull ${model}`);
    else if (err.code === 'timeout') this.out(`Ollama at ${baseUrl} did not answer in 10 s — the model may still be loading; run the command again`);
    else this.out(`error: ${err.message}`);
  }

  private async evalDraft(args: string[]): Promise<number> {
    let parsed;
    try {
      parsed = parseArgs({
        args,
        allowPositionals: true,
        options: { projects: { type: 'string' }, out: { type: 'string' }, limit: { type: 'string', default: '80' }, force: { type: 'boolean', default: false } },
      });
    } catch {
      USAGE.forEach(line => this.out(line));
      return 1;
    }
    const limit = Number(parsed.values.limit);
    if (parsed.positionals.length || !Number.isInteger(limit) || limit < 1) {
      USAGE.forEach(line => this.out(line));
      return 1;
    }
    const { home, cwd } = this.paths();
    const projects = parsed.values.projects ?? join(home, '.claude', 'projects');
    const out = parsed.values.out ?? join(this.crewcastHome(), 'eval', 'tasks.jsonl');
    try {
      const { written } = await new Evaluator({ cwd }).draft(projects, out, limit, parsed.values.force);
      this.out(`Drafted ${written} tasks → ${out}. Open it and correct \`actual\` (mode, skills) for each line; delete lines that are not real tasks.`);
      return 0;
    } catch (err) {
      this.out(`error: ${(err as Error).message}`);
      return 1;
    }
  }

  private async evalRun(args: string[]): Promise<number> {
    let parsed;
    try {
      parsed = parseArgs({
        args,
        allowPositionals: true,
        options: { model: { type: 'string', default: 'kev:4b-q4_K_M' } },
      });
    } catch {
      USAGE.forEach(line => this.out(line));
      return 1;
    }
    if (parsed.positionals.length > 1) {
      USAGE.forEach(line => this.out(line));
      return 1;
    }
    const { home, cwd } = this.paths();
    const file = parsed.positionals[0] ?? join(this.crewcastHome(), 'eval', 'tasks.jsonl');
    const model = parsed.values.model;
    const baseUrl = new Config(this.deps.env).ollamaBaseUrl;
    const client = new SystemOneClient({ baseUrl });
    const ask = this.deps.ask ?? ((r: SystemOneRequest) => client.ask(r));
    const skills = await new SkillCatalog().load(await SkillCatalog.defaultDirs(home, cwd));
    const index = new SkillIndex({ baseUrl, home: this.crewcastHome() });

    let report: Report;
    try {
      report = await new Evaluator({ cwd }).run(file, { ask, skills, model, shortlist: (t, s) => index.top(t, s) });
    } catch (err) {
      if (err instanceof BackendError) {
        this.backendLine(err, baseUrl, model);
        return 2;
      }
      this.out(`error: ${(err as Error).message}`);
      return 1;
    }
    this.printReport(report);
    return report.pass ? 0 : 3;
  }

  private printReport(r: Report, unlabelled?: number): void {
    const uncertain = Object.entries(r.uncertain).map(([name, count]) => `${name} ${count}`).join(', ') || 'none';
    this.out(`labelled: ${r.n}`);
    this.out(`mode agreement: ${r.mode.toFixed(2)}`);
    this.out(`skills agreement: ${r.skills.toFixed(2)}`);
    this.out(`uncertain: ${uncertain}`);
    this.out(`p50 ms: ${r.p50ms}`);
    this.out(`p95 ms: ${r.p95ms}`);
    this.out(`skipped lines: ${r.skipped}`);
    if (unlabelled !== undefined) this.out(`unlabelled: ${unlabelled}`);
    this.out(r.pass ? 'PASS' : 'FAIL');
  }

  private async label(args: string[]): Promise<number> {
    let parsed;
    try {
      parsed = parseArgs({
        args,
        allowPositionals: true,
        options: { mode: { type: 'string' }, skills: { type: 'string' } },
      });
    } catch {
      USAGE.forEach(line => this.out(line));
      return 1;
    }
    const [id, ...rest] = parsed.positionals;
    const { mode, skills } = parsed.values;
    if (!id || rest.length || (mode !== 'solo' && mode !== 'team') || skills === undefined) {
      USAGE.forEach(line => this.out(line));
      return 1;
    }
    const actual: Actual = { mode, skills: skills.split(',').map(s => s.trim()).filter(Boolean) };
    const home = this.crewcastHome();
    await new ShadowLog(home).addLabel(id, actual);
    this.out(`labelled ${id}`);
    const shadow = await ShadowLog.readJsonl<{ id?: unknown }>(join(home, 'shadow.jsonl'));
    if (!shadow.rows.some(r => r?.id === id)) this.out(`warning: ${id} is not in the shadow log`);
    return 0;
  }

  private async stats(): Promise<number> {
    const home = this.crewcastHome();
    const shadow = await ShadowLog.readJsonl<DecisionRecord>(join(home, 'shadow.jsonl'));
    const labels = await ShadowLog.readJsonl<{ id: string; actual: Actual }>(join(home, 'labels.jsonl'));
    // A line that parses but has the wrong shape (null, {}) is skipped too, never a crash.
    const recs = shadow.rows.filter(r => typeof r?.id === 'string' && r.signals && Array.isArray(r.agents));
    const actuals = labels.rows.filter(l => typeof l?.id === 'string' && Array.isArray(l.actual?.skills));
    // Later labels overwrite earlier ones in the Map, so the last label for an id wins.
    const actualById = new Map(actuals.map(l => [l.id, l.actual]));
    const pairs: { rec: DecisionRecord; actual: Actual }[] = [];
    let unlabelled = 0;
    for (const rec of recs) {
      const actual = actualById.get(rec.id);
      if (actual) pairs.push({ rec, actual });
      else unlabelled++;
    }
    const shapeSkipped = (shadow.rows.length - recs.length) + (labels.rows.length - actuals.length);
    this.printReport(new Agreement().report(pairs, shadow.skipped + labels.skipped + shapeSkipped), unlabelled);
    return 0;
  }
}
