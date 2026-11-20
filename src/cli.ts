import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { performance } from 'node:perf_hooks';
import { BackendError, SystemOneClient, type SystemOneRequest, type SystemOneResponse } from './backend/systemone.js';
import { SkillCatalog, type Skill } from './catalog/skills.js';
import { Config } from './paths.js';
import { Decider } from './decide/decide.js';
import { GitInspector } from './git.js';

const USAGE = [
  'usage: crewcast <command>',
  '  decide [--model <name>] [--json] <task...>',
  '  label <id> <actual>',
  '  stats',
  '  eval [draft]',
  '  skills',
  '  --version',
];

export class Cli {
  constructor(
    private readonly out: (line: string) => void,
    private readonly deps: Partial<{ ask: (r: SystemOneRequest) => Promise<SystemOneResponse>; env: NodeJS.ProcessEnv; cwd: string }> = {},
  ) {}

  async run(argv: string[]): Promise<number> {
    if (argv[0] === '--version') {
      const { version } = createRequire(import.meta.url)('../package.json') as { version: string };
      this.out(version);
      return 0;
    }
    if (argv[0] === 'skills') return this.listSkills();
    if (argv[0] === 'decide') return this.decide(argv.slice(1));
    USAGE.forEach(line => this.out(line));
    return 1;
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
        options: { model: { type: 'string', default: 'nimble' }, json: { type: 'boolean', default: false } },
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

    let rec;
    try {
      rec = await new Decider({ ask, skills, git, model }).decide(task);
    } catch (err) {
      if (!(err instanceof BackendError)) throw err;
      if (err.code === 'ollama_unreachable') this.out(`Ollama not reachable at ${baseUrl} — start Ollama`);
      else if (err.code === 'model_missing') this.out(`model '${model}' not found — run: ollama pull ${model}`);
      else if (err.code === 'timeout') this.out(`Ollama at ${baseUrl} did not answer in time`);
      else this.out(`error: ${err.message}`);
      return 2;
    }

    if (parsed.values.json) {
      this.out(JSON.stringify(rec));
      return 0;
    }
    this.out(`mode: ${rec.mode}`);
    this.out(`skills: ${rec.agents.flatMap(a => a.skills).join(', ') || 'none'}`);
    this.out(`branch: ${rec.branch.action}${rec.branch.name ? ` ${rec.branch.name}` : ''}`);
    this.out(`ms: ${rec.ms}`);
    return 0;
  }
}
