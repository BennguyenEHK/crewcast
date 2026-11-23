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

  // Order per §7.7: the worktree link + folder first, then the branch. Reports (not swallows) a step that fails — on Windows a locked
  // worktree folder fails routinely — so the caller knows cleanup was partial; then prunes any stale registration left behind.
  async remove(wt: Worktree): Promise<{ failed: string[] }> {
    const failed: string[] = [];
    const step = async (args: string[], label: string) => {
      try { await this.git(['-C', this.deps.repoRoot, ...args]); }
      catch (e) { failed.push(`${label}: ${(e as Error).message}`); }
    };
    await step(['worktree', 'remove', '--force', wt.path], `worktree remove ${wt.path}`);
    await step(['branch', '-D', wt.branch], `branch -D ${wt.branch}`);
    await this.git(['-C', this.deps.repoRoot, 'worktree', 'prune']).catch(() => {});
    return { failed };
  }

  // The file names the branch changed vs its base: committed changes ∪ working-tree changes (incl. untracked). Names, not diff (§7.13).
  // -z gives NUL-separated, unquoted paths, so non-ASCII and spaced names come back raw (no octal escaping) and compare correctly.
  async changedFiles(wt: Worktree): Promise<string[]> {
    const committed = await this.git(['-C', wt.path, 'diff', '--name-only', '-z', `${wt.base}...HEAD`]);
    const status = await this.git(['-C', wt.path, 'status', '--porcelain', '-z']);
    const names = new Set<string>();
    for (const p of committed.split('\0')) if (p) names.add(norm(p));
    const fields = status.split('\0');
    for (let i = 0; i < fields.length; i++) {
      const entry = fields[i];
      if (!entry) continue;
      const code = entry.slice(0, 2);                 // 2 status chars, then a space, then the path
      names.add(norm(entry.slice(3)));
      if (code.includes('R') || code.includes('C')) i++; // a rename/copy adds the original path as the next field — skip it
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

const norm = (p: string): string => p.replace(/\\/g, '/'); // with -z git already emits forward slashes; this only guards a stray backslash
