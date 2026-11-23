import { InstalledManifest } from './manifest.js';

// Reverses the manifest newest-first, then clears it. Touches only what the manifest records (§7.12).
export class Uninstall {
  constructor(
    private readonly deps: {
      home: string;
      run: (bin: string, args: string[]) => Promise<string>;
      remove: (path: string) => Promise<void>;
      removeHook: (settingsPath: string) => Promise<void>;
    },
  ) {}

  async run(): Promise<{ removed: string[] }> {
    const manifest = new InstalledManifest(this.deps.home);
    const actions = await manifest.load();
    const removed: string[] = [];
    for (const a of [...actions].reverse()) {
      try {
        if (a.kind === 'mcp') { await this.deps.run('claude', ['mcp', 'remove', a.server]); removed.push(`mcp ${a.server}`); }
        else if (a.kind === 'skillCopy') { await this.deps.remove(a.dest); removed.push(a.dest); }
        else if (a.kind === 'dir' || a.kind === 'file') { await this.deps.remove(a.path); removed.push(a.path); }
        else if (a.kind === 'hook') { await this.deps.removeHook(a.settingsPath); removed.push(`hook ${a.settingsPath}`); }
      } catch {
        // a target already gone, or a remove that no longer applies: best-effort, keep reversing the rest
      }
    }
    await manifest.clear();
    return { removed };
  }
}
