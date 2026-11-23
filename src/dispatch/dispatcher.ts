import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Engine } from '../engines/catalog.js';
import type { PlanAllocation, UnitAllocation } from '../decide/allocate.js';
import type { Mailbox } from '../mailbox.js';
import type { Worktree, WorktreeManager } from '../worktree.js';

export interface WorkerRecord { unit: string; engine: string; group: number; cwd: string; worktree: Worktree | null; files: string[]; pid: number }
export interface RunState { run: string; startedAt: string; workers: WorkerRecord[] }
export interface WorkerStatus extends WorkerRecord { messages: number; ownership: { ok: boolean; outside: string[] } | null }
export interface RunStatus { run: string; workers: WorkerStatus[] }

// Starts a team run from a plan allocation (§7.7): a worktree per writing unit, a task card + injected skills per worker, one spawned process each.
export class Dispatcher {
  constructor(
    private readonly deps: {
      worktrees: WorktreeManager;
      mailbox: Mailbox;
      runsHome: string;
      // spawn runs the trusted engine bin with resolved args; the prompt is an arg, never a shell string (§3 — no shell:true).
      spawn: (bin: string, args: string[], opts: { cwd: string; env: Record<string, string> }) => Promise<{ pid: number }>;
      skillText: (names: string[]) => Promise<string>;
      mcpConfig: (run: string) => Record<string, string>;
      now?: () => number;
    },
  ) {}

  async dispatch(alloc: PlanAllocation, opts: { run: string; repoRoot: string; engines: Engine[] }): Promise<RunState> {
    const byId = new Map(opts.engines.map(e => [e.id, e]));
    const n = new Map<string, number>(); // per-engine worktree counter so each writer's path is unique
    const workers: WorkerRecord[] = [];
    for (const u of alloc.units) {
      const engine = byId.get(u.engine);
      if (!engine) throw new Error(`no engine recipe for ${JSON.stringify(u.engine)}`);
      const writes = u.files.length > 0;
      let worktree: Worktree | null = null;
      let cwd = opts.repoRoot;
      if (writes) {
        const idx = (n.get(u.engine) ?? 0) + 1;
        n.set(u.engine, idx);
        worktree = await this.deps.worktrees.create(u.engine, idx);
        cwd = worktree.path;
      }
      const prompt = await this.card(u, opts.run);
      const args = [...engine.headless.map(a => a.replace('{task}', prompt)), ...u.args];
      const { pid } = await this.deps.spawn(engine.bin, args, { cwd, env: this.deps.mcpConfig(opts.run) });
      workers.push({ unit: u.id, engine: u.engine, group: u.group, cwd, worktree, files: u.files, pid });
    }
    const state: RunState = { run: opts.run, startedAt: new Date((this.deps.now ?? Date.now)()).toISOString(), workers };
    const dir = join(this.deps.runsHome, 'runs', opts.run);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'run.json'), JSON.stringify(state, null, 2), 'utf8');
    return state;
  }

  // Reports a run: how many messages each worker posted, and for a writer whether its changed files stayed inside its owned set (§7.13).
  async status(run: string): Promise<RunStatus> {
    const state = JSON.parse(await readFile(join(this.deps.runsHome, 'runs', run, 'run.json'), 'utf8')) as RunState;
    const { messages } = await this.deps.mailbox.read(run);
    const workers: WorkerStatus[] = [];
    for (const w of state.workers) {
      const count = messages.filter(m => m.from === w.unit).length;
      const ownership = w.worktree ? await this.deps.worktrees.ownership(w.worktree, w.files) : null;
      workers.push({ ...w, messages: count, ownership });
    }
    return { run, workers };
  }

  // The worker's task card (§7.7): goal, owned files, how to report, the mailbox run id, then the chosen skills' text (§7.8).
  private async card(u: UnitAllocation, run: string): Promise<string> {
    const skills = await this.deps.skillText(u.skills);
    return [
      `# Task: ${u.description}`,
      `Owned files (do not touch anything else): ${u.files.join(', ') || '(read-only, no files)'}`,
      `Report progress and your result with the crewcast post_message tool, run id: ${run}.`,
      'Done when: the task is complete, tests pass, and you have posted your result.',
      skills && `\n## Skills for this task\n${skills}`,
    ].filter(Boolean).join('\n');
  }
}
