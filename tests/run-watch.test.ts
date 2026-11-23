import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RunWatch } from '../src/dispatch/run-watch.js';
import { Mailbox } from '../src/mailbox.js';

async function seed(): Promise<{ home: string; cleanup: () => Promise<void> }> {
  const home = await mkdtemp(join(tmpdir(), 'cc-watch-'));
  await mkdir(join(home, 'runs', 'r1'), { recursive: true });
  const run = {
    run: 'r1', startedAt: '2026-11-22T00:00:00.000Z',
    workers: [
      { unit: 'A', engine: 'codex', group: 0, cwd: '/wt/a', worktree: { path: '/wt/a' }, files: ['a.ts'], skills: ['tdd'], pid: 100 },
      { unit: 'B', engine: 'agy', group: 0, cwd: '/wt/b', worktree: { path: '/wt/b' }, files: ['b.ts'], skills: [], pid: 200 },
      { unit: 'C', engine: 'copilot', group: 0, cwd: '/repo', worktree: null, files: [], skills: [], pid: null, error: 'ENOENT' },
    ],
  };
  await writeFile(join(home, 'runs', 'r1', 'run.json'), JSON.stringify(run), 'utf8');
  return { home, cleanup: () => rm(home, { recursive: true, force: true }) };
}

test('view derives running/ended/failed, latest message, counts, and elapsed', async () => {
  const { home, cleanup } = await seed();
  try {
    const mailbox = new Mailbox(home);
    await mailbox.post('r1', 'A', 'first'); await mailbox.post('r1', 'A', 'second'); // worker A posted twice
    const probed: number[] = [];
    const alive = (pid: number) => { probed.push(pid); return pid === 100; }; // 100 alive, 200 gone
    const now = () => Date.parse('2026-11-22T00:00:05.000Z'); // 5s after start
    const view = await new RunWatch({ runsHome: home, mailbox, alive, now }).view('r1');

    const byUnit = Object.fromEntries(view.rows.map(r => [r.unit, r]));
    assert.equal(byUnit.A.status, 'running');
    assert.equal(byUnit.A.latest, 'second');
    assert.equal(byUnit.A.messages, 2);
    assert.deepEqual(byUnit.A.skills, ['tdd']);
    assert.equal(byUnit.B.status, 'ended');   // pid 200 not alive
    assert.equal(byUnit.B.messages, 0);
    assert.equal(byUnit.B.latest, '');
    assert.equal(byUnit.C.status, 'failed');
    assert.equal(byUnit.C.error, 'ENOENT');
    assert.ok(!probed.includes(0), 'a failed worker (null pid) is never probed for liveness');
    assert.equal(view.elapsedMs, 5000);
  } finally {
    await cleanup();
  }
});
