import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);
// Default git runner. shell:true matches the Windows quoting/shim pattern used for CLI detection (src/engines/catalog.ts).
const defaultGit = async (args: string[]): Promise<string> => (await execFileP('git', args, { shell: true })).stdout;

export interface Worktree { path: string; branch: string; base: string }

// Gives each writing worker its own worktree + branch (shared history, never a shared folder), per §7.7.
// It never links node_modules into a worktree: a worker runs its own install inside it (§7.7).
export class WorktreeManager {
  constructor(private readonly deps: { repoRoot: string; run?: (args: string[]) => Promise<string> }) {}

  async create(engine: string, n: number, base = 'HEAD'): Promise<Worktree> {
    const path = `${this.deps.repoRoot}-wt/${engine}-${n}`;
    const branch = `crewcast/${engine}-${n}`;
    await this.git(['-C', this.deps.repoRoot, 'worktree', 'add', '-b', branch, path, base]);
    return { path, branch, base };
  }

  async remove(wt: Worktree): Promise<void> {
    // Order per §7.7: the worktree link + folder first, then the branch. Best-effort: a step whose target is already gone is skipped.
    await this.git(['-C', this.deps.repoRoot, 'worktree', 'remove', '--force', wt.path]).catch(() => {});
    await this.git(['-C', this.deps.repoRoot, 'branch', '-D', wt.branch]).catch(() => {});
  }

  private git(args: string[]): Promise<string> {
    return (this.deps.run ?? defaultGit)(args);
  }
}
