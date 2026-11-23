import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Cli } from '../src/cli.js';
import { Mailbox } from '../src/mailbox.js';

async function seedRun(home: string, run: string, startedAt: string) {
  await mkdir(join(home, 'runs', run), { recursive: true });
  const state = {
    run, startedAt,
    workers: [
      { unit: 'A', engine: 'codex', group: 0, cwd: '/wt/a', worktree: { path: '/wt/a' }, files: ['a.ts'], skills: ['tdd'], pid: 100 },
      { unit: 'B', engine: 'agy', group: 0, cwd: '/wt/b', worktree: { path: '/wt/b' }, files: ['b.ts'], skills: [], pid: 200 },
    ],
  };
  await writeFile(join(home, 'runs', run, 'run.json'), JSON.stringify(state), 'utf8');
}

type Internals = { watchOnce(run: string): Promise<string>; latestRun(): Promise<string | undefined> };

test('watchOnce renders a frame naming the workers', async () => {
  const home = await mkdtemp(join(tmpdir(), 'cc-cliwatch-'));
  try {
    await seedRun(home, 'r1', new Date().toISOString());
    await new Mailbox(home).post('r1', 'A', 'writing tests');
    const cli = new Cli(() => {}, { env: { CREWCAST_HOME: home }, cwd: home, alive: pid => pid === 100 });
    const frame = await (cli as unknown as Internals).watchOnce('r1');
    assert.match(frame, /codex/); assert.match(frame, /agy/);
    assert.match(frame, /writing tests/); // worker A's latest message
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('watch with an explicit run id that does not exist says so, exit 1 (not a raw ENOENT)', async () => {
  const home = await mkdtemp(join(tmpdir(), 'cc-cliwatch-nf-'));
  try {
    await seedRun(home, 'r1', new Date().toISOString());
    const lines: string[] = [];
    const code = await new Cli(l => lines.push(l), { env: { CREWCAST_HOME: home }, cwd: home }).run(['watch', 'typo']);
    assert.equal(code, 1);
    assert.ok(lines.some(l => /not found|no run/i.test(l) && l.includes('typo')), lines.join('\n'));
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('watch with no runs prints a clear message and exits 0', async () => {
  const home = await mkdtemp(join(tmpdir(), 'cc-cliwatch2-'));
  try {
    const lines: string[] = [];
    const code = await new Cli(l => lines.push(l), { env: { CREWCAST_HOME: home }, cwd: home }).run(['watch']);
    assert.equal(code, 0);
    assert.ok(lines.some(l => /no runs/i.test(l)), lines.join('\n'));
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('latestRun picks the most recently started run', async () => {
  const home = await mkdtemp(join(tmpdir(), 'cc-cliwatch3-'));
  try {
    await seedRun(home, 'old', '2026-11-20T00:00:00.000Z');
    await new Promise(r => setTimeout(r, 20)); // ensure a later mtime
    await seedRun(home, 'new', '2026-11-22T00:00:00.000Z');
    const cli = new Cli(() => {}, { env: { CREWCAST_HOME: home }, cwd: home });
    assert.equal(await (cli as unknown as Internals).latestRun(), 'new');
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
