import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { GitState } from './decide/record.js';

const run = promisify(execFile);

export class GitInspector {
  async state(cwd: string): Promise<GitState | null> {
    try {
      if (await this.git(cwd, ['rev-parse', '--is-inside-work-tree']) !== 'true') return null;
    } catch {
      return null; // git missing or cwd is not a repo
    }
    const branch = (await this.git(cwd, ['branch', '--show-current'])) || null;
    return {
      isRepo: true,
      branch,
      defaultBranch: await this.defaultBranch(cwd),
      dirty: (await this.git(cwd, ['status', '--porcelain'])) !== '',
    };
  }

  private async defaultBranch(cwd: string): Promise<string | null> {
    const remote = await this.git(cwd, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']).catch(() => '');
    if (remote) return remote.replace(/^origin\//, '');
    for (const name of ['main', 'master']) {
      if (await this.git(cwd, ['rev-parse', '--verify', '--quiet', `refs/heads/${name}`]).then(() => true, () => false)) return name;
    }
    return null;
  }

  private async git(cwd: string, args: string[]): Promise<string> {
    return (await run('git', args, { cwd })).stdout.trim();
  }
}
