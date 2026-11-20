import { createRequire } from 'node:module';

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
    // Task 1 stores deps unused; later tasks read them.
    private readonly deps: Partial<{ ask: unknown; env: NodeJS.ProcessEnv; cwd: string }> = {},
  ) {}

  async run(argv: string[]): Promise<number> {
    if (argv[0] === '--version') {
      const { version } = createRequire(import.meta.url)('../package.json') as { version: string };
      this.out(version);
      return 0;
    }
    USAGE.forEach(line => this.out(line));
    return 1;
  }
}
