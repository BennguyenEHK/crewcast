import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GitInspector } from '../src/git.js';

const run = promisify(execFile);
const git = (cwd: string, args: string[]) => run('git', args, { cwd });

test('gitState in a non-repo temp dir → null', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cc-git-'));
  try {
    assert.equal(await new GitInspector().state(dir), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('gitState in a fresh repo with one commit → branch main, clean; a new file → dirty', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cc-git-'));
  try {
    await git(dir, ['init', '-b', 'main']);
    await git(dir, ['config', 'user.name', 'test']);
    await git(dir, ['config', 'user.email', 'test@example.invalid']);
    await writeFile(join(dir, 'a.txt'), 'a\n');
    await git(dir, ['add', 'a.txt']);
    await git(dir, ['commit', '-m', 'init']);

    const inspector = new GitInspector();
    assert.deepEqual(await inspector.state(dir), { isRepo: true, branch: 'main', defaultBranch: 'main', dirty: false });

    await writeFile(join(dir, 'b.txt'), 'b\n');
    assert.equal((await inspector.state(dir))?.dirty, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
