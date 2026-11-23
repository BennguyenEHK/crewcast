import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Dispatcher } from '../src/dispatch/dispatcher.js';
import { WorktreeManager } from '../src/worktree.js';
import { Mailbox } from '../src/mailbox.js';
import type { Engine } from '../src/engines/catalog.js';
import type { PlanAllocation, UnitAllocation } from '../src/decide/allocate.js';

const execFileP = promisify(execFile);
const git = (cwd: string, ...a: string[]) => execFileP('git', ['-C', cwd, ...a]).then(r => r.stdout);
const eng = (id: string, headless: string[]): Engine => ({
  id, bin: id, versionArgs: ['--version'], installed: true, headless, models: ['default'], strongModel: null,
  modelFlag: '--model', effortArgs: [], highEffort: null, parallelLimit: 2, writeFlags: [], readFlags: [], safeFlags: [], autoMode: false,
} as Engine);
const unit = (o: Partial<UnitAllocation> & { id: string; engine: string }): UnitAllocation => ({
  description: o.id, files: [], depends: [], group: 0, model: 'default', effort: null, args: [], skills: [], mcps: [], ...o,
});

test('status: writer ownership violation surfaces; reader ownership is null; message counts reflect posts', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'cc-dstat-'));
  const root = join(parent, 'repo');
  try {
    await execFileP('git', ['-C', parent, 'init', 'repo']);
    await git(root, 'config', 'user.email', 'a@b.c');
    await git(root, 'config', 'user.name', 't');
    await writeFile(join(root, 'README.md'), 'hi\n', 'utf8');
    await git(root, 'add', '.'); await git(root, 'commit', '-m', 'init');

    const home = join(parent, 'crew');
    const mailbox = new Mailbox(home);
    const dispatcher = new Dispatcher({
      worktrees: new WorktreeManager({ repoRoot: root }),
      mailbox, runsHome: home,
      spawn: async () => ({ pid: 1 }),
      skillText: async () => '',
      mcpConfig: r => ({ CREWCAST_RUN: r }),
    });
    const alloc: PlanAllocation = {
      units: [unit({ id: 'W', engine: 'codex', files: ['allowed.ts'] }), unit({ id: 'R', engine: 'copilot', files: [] })],
    };
    const state = await dispatcher.dispatch(alloc, { run: 'r1', repoRoot: root, engines: [eng('codex', ['exec', '{task}']), eng('copilot', ['-p', '{task}'])] });

    // the writer touches a file it does not own
    const wt = state.workers.find(w => w.unit === 'W')!.worktree!;
    await writeFile(join(wt.path, 'sneaky.ts'), 'x\n', 'utf8');
    await mailbox.post('r1', 'W', 'progress'); // one message from W

    const status = await dispatcher.status('r1');
    const w = status.workers.find(x => x.unit === 'W')!;
    const r = status.workers.find(x => x.unit === 'R')!;
    assert.equal(w.ownership!.ok, false);
    assert.ok(w.ownership!.outside.includes('sneaky.ts'));
    assert.equal(w.messages, 1);
    assert.equal(r.ownership, null);   // reader has no worktree to check
    assert.equal(r.messages, 0);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
