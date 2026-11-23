import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);
// git is a real executable (not an npm .cmd shim), so no shell is needed — and shell:false quotes args, so spaced repo paths are safe.
const defaultGit = async (args: string[]): Promise<string> => (await execFileP('git', args)).stdout;

export interface Worktree { path: string; branch: string; base: string }

// Gives each writing worker its own worktree + branch (shared history, never a shared folder), per §7.7.
// It never links node_modules into a worktree: a worker runs its own install inside it (§7.7).
export class WorktreeManager {
  constructor(private readonly deps: { repoRoot: string; run?: (args: string[]) => Promise<string> }) {}

  async create(engine: string, n: number, base = 'HEAD'): Promise<Worktree> {
    const path = `${this.deps.repoRoot}-wt/${engine}-${n}`;
    const branch = `crewcast/${engine}-${n}`;
    // Resolve to a commit SHA now: the worker will move HEAD, so the ownership diff must pin the point the branch was cut from.
    const baseRef = (await this.git(['-C', this.deps.repoRoot, 'rev-parse', base])).trim();
    await this.git(['-C', this.deps.repoRoot, 'worktree', 'add', '-b', branch, path, baseRef]);
    return { path, branch, base: baseRef };
  }

  async remove(wt: Worktree): Promise<void> {
    // Order per §7.7: the worktree link + folder first, then the branch. Best-effort: a step whose target is already gone is skipped.
    await this.git(['-C', this.deps.repoRoot, 'worktree', 'remove', '--force', wt.path]).catch(() => {});
    await this.git(['-C', this.deps.repoRoot, 'branch', '-D', wt.branch]).catch(() => {});
  }

  // The file names the branch changed vs its base: committed changes ∪ working-tree changes (incl. untracked). Names, not diff (§7.13).
  async changedFiles(wt: Worktree): Promise<string[]> {
    const committed = await this.git(['-C', wt.path, 'diff', '--name-only', `${wt.base}...HEAD`]);
    const status = await this.git(['-C', wt.path, 'status', '--porcelain']);
    const names = new Set<string>();
    for (const line of committed.split(/\r?\n/)) if (line.trim()) names.add(norm(line.trim()));
    for (const line of status.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const path = line.slice(3).trim();            // drop the 3-char status prefix (" M ", "?? ", …)
      names.add(norm(path.includes(' -> ') ? path.split(' -> ')[1] : path)); // a rename reports its destination
    }
    return [...names];
  }

  async ownership(wt: Worktree, owned: string[]): Promise<{ ok: boolean; outside: string[] }> {
    const ownedSet = new Set(owned.map(norm));
    const outside = (await this.changedFiles(wt)).filter(f => !ownedSet.has(f));
    return { ok: outside.length === 0, outside };
  }

  private git(args: string[]): Promise<string> {
    return (this.deps.run ?? defaultGit)(args);
  }
}

const norm = (p: string): string => p.replace(/\\/g, '/').replace(/^"|"$/g, '');
