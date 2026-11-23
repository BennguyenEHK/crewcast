import { execFile } from 'node:child_process';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WorktreeManager } from '../src/worktree.js';

const execFileP = promisify(execFile);
const git = (cwd: string, ...args: string[]) => execFileP('git', ['-C', cwd, ...args]).then(r => r.stdout);

async function repo(): Promise<{ root: string; base: string; cleanup: () => Promise<void> }> {
  const parent = await mkdtemp(join(tmpdir(), 'cc-wt-'));
  const root = join(parent, 'repo');
  await git(parent, 'init', 'repo');
  await git(root, 'config', 'user.email', 'a@b.c');
  await git(root, 'config', 'user.name', 'test');
  await writeFile(join(root, 'README.md'), 'hi\n', 'utf8');
  await git(root, 'add', '.');
  await git(root, 'commit', '-m', 'init');
  const base = (await git(root, 'rev-parse', '--abbrev-ref', 'HEAD')).trim();
  return { root, base, cleanup: () => rm(parent, { recursive: true, force: true }) };
}
const exists = (p: string) => stat(p).then(() => true, () => false);

test('create makes a distinct worktree + branch per worker; remove tears it down without touching the main repo', async () => {
  const { root, cleanup } = await repo();
  try {
    const mgr = new WorktreeManager({ repoRoot: root });
    const a = await mgr.create('codex', 1);
    const b = await mgr.create('gemini', 2);

    assert.ok(a.path.replace(/\\/g, '/').endsWith('-wt/codex-1'));
    assert.ok(await exists(a.path));
    assert.notEqual(a.path, b.path);        // two writers, no shared folder
    assert.notEqual(a.branch, b.branch);
    const list = await git(root, 'worktree', 'list', '--porcelain');
    assert.ok(list.includes(a.branch) || list.includes(a.path.replace(/\\/g, '/')));

    await mgr.remove(a);
    assert.equal(await exists(a.path), false);                                  // folder gone
    assert.ok(!(await git(root, 'branch', '--list', a.branch)).trim());         // branch gone
    assert.ok(await exists(join(root, 'README.md')));                            // main repo untouched
  } finally {
    await cleanup();
  }
});
