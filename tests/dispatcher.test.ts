import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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

async function repo() {
  const parent = await mkdtemp(join(tmpdir(), 'cc-disp-'));
  const root = join(parent, 'repo');
  await execFileP('git', ['-C', parent, 'init', 'repo']);
  await git(root, 'config', 'user.email', 'a@b.c');
  await git(root, 'config', 'user.name', 't');
  await writeFile(join(root, 'README.md'), 'hi\n', 'utf8');
  await git(root, 'add', '.');
  await git(root, 'commit', '-m', 'init');
  return { root, parent, cleanup: () => rm(parent, { recursive: true, force: true }) };
}

test('dispatch: writer gets a worktree, reader runs in the repo root; prompt carries run id + skills; no shell', async () => {
  const { root, parent, cleanup } = await repo();
  try {
    const home = join(parent, 'crew');
    const calls: { bin: string; args: string[]; opts: Record<string, unknown> }[] = [];
    let pid = 100;
    const dispatcher = new Dispatcher({
      worktrees: new WorktreeManager({ repoRoot: root }),
      mailbox: new Mailbox(home),
      runsHome: home,
      spawn: async (bin, args, opts) => { calls.push({ bin, args, opts: opts as unknown as Record<string, unknown> }); return { pid: pid++ }; },
      skillText: async names => (names.length ? `<<SKILLS:${names.join(',')}>>` : ''),
      mcpConfig: run => ({ CREWCAST_RUN: run }),
    });
    const alloc: PlanAllocation = {
      units: [
        unit({ id: 'W', engine: 'codex', files: ['w.ts'], args: ['--json'], skills: ['skill-a'] }),
        unit({ id: 'R', engine: 'copilot', files: [], skills: [] }),
      ],
    };
    const state = await dispatcher.dispatch(alloc, {
      run: 'run-1', repoRoot: root, engines: [eng('codex', ['exec', '{task}']), eng('copilot', ['-p', '{task}'])],
    });

    assert.equal(state.workers.length, 2);
    assert.equal(state.workers[0].pid, 100); // a successful spawn records its pid
    const w = state.workers.find(x => x.unit === 'W')!;
    const r = state.workers.find(x => x.unit === 'R')!;
    assert.ok(w.worktree && w.cwd.replace(/\\/g, '/').includes('-wt/codex-'), `writer cwd: ${w.cwd}`);
    assert.equal(r.worktree, null);
    assert.equal(r.cwd, root); // reader runs in the main repo

    const writerCall = calls.find(c => c.bin === 'codex')!;
    assert.ok(!('shell' in writerCall.opts) || writerCall.opts.shell !== true, 'never a shell');
    const prompt = writerCall.args.join('\n');
    assert.match(prompt, /run-1/);                     // the task card names the mailbox run
    assert.match(prompt, /<<SKILLS:skill-a>>/);        // the chosen skill text is injected (§7.8)
    assert.ok(writerCall.args.includes('--json'));     // the allocation's flags are passed
    assert.deepEqual(writerCall.opts.env, { CREWCAST_RUN: 'run-1' });

    assert.deepEqual(w.skills, ['skill-a']); // the unit's skills are recorded for the watch view
    const saved = JSON.parse(await readFile(join(home, 'runs', 'run-1', 'run.json'), 'utf8')) as { workers: unknown[] };
    assert.equal(saved.workers.length, 2);
  } finally {
    await cleanup();
  }
});

test('a spawn that fails is recorded as a failed worker, not thrown (no server crash)', async () => {
  const { root, parent, cleanup } = await repo();
  try {
    const home = join(parent, 'crew');
    const dispatcher = new Dispatcher({
      worktrees: new WorktreeManager({ repoRoot: root }),
      mailbox: new Mailbox(home), runsHome: home,
      spawn: async () => ({ pid: null, error: 'ENOENT: codex.cmd not launchable without a shell' }),
      skillText: async () => '', mcpConfig: r => ({ CREWCAST_RUN: r }),
    });
    const state = await dispatcher.dispatch(
      { units: [unit({ id: 'W', engine: 'codex', files: ['w.ts'] })] },
      { run: 'r2', repoRoot: root, engines: [eng('codex', ['exec', '{task}'])] },
    );
    assert.equal(state.workers[0].pid, null);
    assert.match(state.workers[0].error!, /ENOENT/);
  } finally {
    await cleanup();
  }
});

test('injected skill text is capped so the worker arg stays within OS command-line limits', async () => {
  const { root, parent, cleanup } = await repo();
  try {
    const home = join(parent, 'crew');
    const calls: string[][] = [];
    const dispatcher = new Dispatcher({
      worktrees: new WorktreeManager({ repoRoot: root }),
      mailbox: new Mailbox(home), runsHome: home,
      spawn: async (_b, args) => { calls.push(args); return { pid: 1 }; },
      skillText: async () => 'x'.repeat(50_000), mcpConfig: r => ({ CREWCAST_RUN: r }),
    });
    await dispatcher.dispatch(
      { units: [unit({ id: 'W', engine: 'codex', files: ['w.ts'], skills: ['big'] })] },
      { run: 'r3', repoRoot: root, engines: [eng('codex', ['exec', '{task}'])] },
    );
    assert.ok(calls[0].join('').length < 32_000, `prompt not capped: ${calls[0].join('').length}`);
  } finally {
    await cleanup();
  }
});
