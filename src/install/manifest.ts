import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export type Action =
  | { kind: 'mcp'; server: string }        // registered with `claude mcp add <server>`
  | { kind: 'skillCopy'; dest: string }     // copied a skill folder to dest
  | { kind: 'dir'; path: string }           // created a dir
  | { kind: 'file'; path: string }          // wrote a file
  | { kind: 'hook'; settingsPath: string }; // added the hook to a settings file

// Records exactly what setup changed, so uninstall reverses exactly that and nothing else (§7.1, §7.12).
export class InstalledManifest {
  private readonly file: string;

  constructor(private readonly home: string) {
    this.file = join(home, 'installed.json');
  }

  async load(): Promise<Action[]> {
    try {
      const o = JSON.parse(await readFile(this.file, 'utf8')) as { actions?: unknown };
      return Array.isArray(o.actions) ? (o.actions as Action[]) : [];
    } catch {
      return [];
    }
  }

  async record(action: Action): Promise<void> {
    const actions = await this.load();
    const key = JSON.stringify(action);
    if (actions.some(a => JSON.stringify(a) === key)) return; // idempotent
    actions.push(action);
    await mkdir(this.home, { recursive: true });
    await writeFile(this.file, JSON.stringify({ version: 1, actions }, null, 2), 'utf8');
  }

  async clear(): Promise<void> {
    await rm(this.file, { force: true });
  }
}
