import { join } from 'node:path';
import { EngineCatalog } from '../engines/catalog.js';
import { InstalledManifest } from './manifest.js';
import { mcpAddArgs } from './mcp-register.js';

// Idempotent install. Each machine change is recorded only after it succeeds, so uninstall reverses exactly what happened.
export class Setup {
  constructor(
    private readonly deps: {
      crewHome: string;   // ~/.crewcast (catalogs + manifest)
      userHome: string;   // ~ (for ~/.claude/skills)
      skillSource: string; // the crewcast skill folder in the package/repo
      baseUrl: string;
      run: (bin: string, args: string[]) => Promise<string>;
      copyDir: (from: string, to: string) => Promise<void>;
      warm: (model: string) => Promise<void>;
      installHook: (userHome: string) => Promise<string>; // returns the settings path it edited
    },
  ) {}

  async run(opts: { skillTargets?: string[] } = {}): Promise<{ steps: string[] }> {
    const steps: string[] = [];
    const manifest = new InstalledManifest(this.deps.crewHome);

    // 1. engine catalog — crewcast's own state, not recorded for reversal
    const cat = new EngineCatalog({ run: this.deps.run });
    const detected = await cat.detect();
    await cat.save(detected, this.deps.crewHome);
    steps.push('engine catalog');

    // 2. register crewcast's MCP server into every installed CLI with a known mcp-add, so each worker has the post_message tool (§7.7).
    const have = await manifest.load();
    for (const e of detected) {
      if (!e.installed) continue;
      const args = mcpAddArgs(e.id);
      if (!args) continue;
      if (have.some(a => a.kind === 'mcp' && a.server === 'crewcast' && (a.bin ?? 'claude') === e.bin)) continue;
      await this.deps.run(e.bin, args);
      await manifest.record({ kind: 'mcp', server: 'crewcast', bin: e.bin });
      steps.push(`mcp register ${e.id}`);
    }

    // 3. install the crewcast skill
    const dest = join(this.deps.userHome, '.claude', 'skills', 'crewcast');
    await this.deps.copyDir(this.deps.skillSource, dest);
    await manifest.record({ kind: 'skillCopy', dest });
    steps.push('skill install');

    // 4. install the hook
    const settingsPath = await this.deps.installHook(this.deps.userHome);
    await manifest.record({ kind: 'hook', settingsPath });
    steps.push('hook install');

    // 5. copy the skill to other CLIs (§7.8)
    for (const target of opts.skillTargets ?? []) {
      await this.deps.copyDir(this.deps.skillSource, target);
      await manifest.record({ kind: 'skillCopy', dest: target });
      steps.push(`skill copy → ${target}`);
    }

    // 6. pre-warm the models (closes the 1c cold-start gap)
    await this.deps.warm('mxbai-embed-large');
    await this.deps.warm('kev:4b-q4_K_M');
    steps.push('prewarm');

    return { steps };
  }
}
