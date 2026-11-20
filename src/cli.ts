import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname } from 'node:path';
import { performance } from 'node:perf_hooks';
import { SkillCatalog, type Skill } from './catalog/skills.js';

const USAGE = [
  'usage: crewcast <command>',
  '  decide <task>',
  '  label <id> <actual>',
  '  stats',
  '  eval [draft]',
  '  skills',
  '  --version',
];

export class Cli {
  constructor(
    private readonly out: (line: string) => void,
    // ask is still unused; env and cwd are read by the skills command.
    private readonly deps: Partial<{ ask: unknown; env: NodeJS.ProcessEnv; cwd: string }> = {},
  ) {}

  async run(argv: string[]): Promise<number> {
    if (argv[0] === '--version') {
      const { version } = createRequire(import.meta.url)('../package.json') as { version: string };
      this.out(version);
      return 0;
    }
    if (argv[0] === 'skills') return this.listSkills();
    USAGE.forEach(line => this.out(line));
    return 1;
  }

  private async listSkills(): Promise<number> {
    const env = this.deps.env ?? {};
    const home = env.HOME ?? env.USERPROFILE ?? homedir();
    const cwd = this.deps.cwd ?? process.cwd();
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
}
