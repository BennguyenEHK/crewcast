import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WorktreeManager } from '../src/worktree.js';

const execFileP = promisify(execFile);
const git = (cwd: string, ...args: string[]) => execFileP('git', ['-C', cwd, ...args]).then(r => r.stdout);

async function repo() {
  const parent = await mkdtemp(join(tmpdir(), 'cc-wto-'));
  const root = join(parent, 'repo');
  await git(parent, 'init', 'repo');
  await git(root, 'config', 'user.email', 'a@b.c');
  await git(root, 'config', 'user.name', 'test');
  await writeFile(join(root, 'README.md'), 'hi\n', 'utf8');
  await git(root, 'add', '.');
  await git(root, 'commit', '-m', 'init');
  return { root, cleanup: () => rm(parent, { recursive: true, force: true }) };
}

test('ownership checks the branch changed-file names (committed + untracked) against the owned list', async () => {
  const { root, cleanup } = await repo();
  try {
    const mgr = new WorktreeManager({ repoRoot: root });
    const wt = await mgr.create('codex', 1);
    await mkdir(join(wt.path, 'src'), { recursive: true });
    await writeFile(join(wt.path, 'src', 'a.ts'), 'export const a = 1;\n', 'utf8'); // committed
    await git(wt.path, 'add', 'src/a.ts');
    await git(wt.path, 'commit', '-m', 'add a');
    await writeFile(join(wt.path, 'src', 'b.ts'), 'export const b = 2;\n', 'utf8'); // left untracked

    const changed = await mgr.changedFiles(wt);
    assert.ok(changed.includes('src/a.ts'), `committed file missing: ${changed.join(', ')}`);
    assert.ok(changed.includes('src/b.ts'), `untracked file missing: ${changed.join(', ')}`);

    assert.deepEqual(await mgr.ownership(wt, ['src/a.ts', 'src/b.ts']), { ok: true, outside: [] });
    assert.deepEqual(await mgr.ownership(wt, ['src/a.ts']), { ok: false, outside: ['src/b.ts'] });
  } finally {
    await cleanup();
  }
});
