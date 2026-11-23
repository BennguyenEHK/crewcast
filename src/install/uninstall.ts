import { InstalledManifest, type Action } from './manifest.js';
import { mcpRemoveArgs } from './mcp-register.js';

const label = (a: Action): string =>
  a.kind === 'mcp' ? `mcp ${a.server} (${a.bin ?? 'claude'})`
  : a.kind === 'skillCopy' ? a.dest
  : a.kind === 'hook' ? `hook ${a.settingsPath}`
  : a.path;

// Reverses the manifest newest-first. Actions that reverse cleanly are dropped; ones that genuinely fail stay recorded for a retry (§7.12).
export class Uninstall {
  constructor(
    private readonly deps: {
      home: string;
      run: (bin: string, args: string[]) => Promise<string>;
      remove: (path: string) => Promise<void>; // the default uses force:true, so a missing file resolves — a throw here is a real failure
      removeHook: (settingsPath: string) => Promise<void>;
    },
  ) {}

  async run(): Promise<{ removed: string[]; failed: string[] }> {
    const manifest = new InstalledManifest(this.deps.home);
    const actions = await manifest.load();
    const removed: string[] = [];
    const failed: string[] = [];
    const kept: Action[] = [];
    for (const a of [...actions].reverse()) {
      try {
        if (a.kind === 'mcp') await this.deps.run(a.bin ?? 'claude', mcpRemoveArgs);
        else if (a.kind === 'skillCopy' || a.kind === 'dir' || a.kind === 'file') await this.deps.remove(a.kind === 'skillCopy' ? a.dest : a.path);
        else if (a.kind === 'hook') await this.deps.removeHook(a.settingsPath);
        removed.push(label(a));
      } catch (err) {
        // The change may still be on the machine — keep it recorded so a re-run can finish, and report rather than swallow.
        kept.push(a);
        failed.push(`${label(a)}: ${(err as Error).message}`);
      }
    }
    await manifest.keep([...kept].reverse()); // restore original order; [] clears the manifest
    return { removed, failed };
  }
}
