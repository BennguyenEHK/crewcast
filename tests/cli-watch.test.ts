import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Cli } from '../src/cli.js';
import { Mailbox } from '../src/mailbox.js';
import { ActivityLog } from '../src/activity.js';
import { noPaint } from '../src/dispatch/watch-render.js';

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

type Internals = { watchFrame(given: string | undefined, paint: typeof noPaint): Promise<string>; latestRun(): Promise<string | undefined> };
const frame = (cli: Cli, given: string | undefined) => (cli as unknown as Internals).watchFrame(given, noPaint);

test('watchFrame: a team run shows the agents pane with its workers and latest message', async () => {
  const home = await mkdtemp(join(tmpdir(), 'cc-cliwatch-'));
  try {
    await seedRun(home, 'r1', new Date().toISOString());
    await new Mailbox(home).post('r1', 'A', 'writing tests');
    const cli = new Cli(() => {}, { env: { CREWCAST_HOME: home }, cwd: home, alive: pid => pid === 100 });
    const f = await frame(cli, 'r1');
    assert.match(f, /agents · 2/); // lower pane titled as the agents pane with 2 workers
    assert.match(f, /codex/); assert.match(f, /agy/);
    assert.match(f, /writing tests/); // worker A's latest message
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

test('watchFrame: solo shows the decision in the lower pane (not an agents pane)', async () => {
  const home = await mkdtemp(join(tmpdir(), 'cc-cliwatch-feed-'));
  try {
    await new ActivityLog(home).append({ kind: 'decided', ts: '2026-11-22T10:00:00.000Z', mode: 'solo', skills: ['frontend-design'], branch: 'keep', task: 'x' });
    const cli = new Cli(() => {}, { env: { CREWCAST_HOME: home }, cwd: home });
    const f = await frame(cli, undefined);
    assert.match(f, /crewcast · live feed/);   // feed pane title
    assert.match(f, /decision · solo/);         // lower pane shows the decision in solo
    assert.match(f, /frontend-design/);         // the decision's skills
    assert.ok(!/agents ·/.test(f), f);          // no agents pane in solo
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('watchFrame: the feed pane carries the activity, above the lower pane', async () => {
  const home = await mkdtemp(join(tmpdir(), 'cc-cliwatch-both-'));
  try {
    await new ActivityLog(home).append({ kind: 'decided', ts: '2026-11-22T10:00:00.000Z', mode: 'team', skills: [], branch: 'feat/x', task: 'x' });
    await seedRun(home, 'r1', new Date().toISOString());
    const cli = new Cli(() => {}, { env: { CREWCAST_HOME: home }, cwd: home, alive: pid => pid === 100 });
    const f = await frame(cli, 'r1');
    assert.match(f, /decided: team/);                                  // feed content
    assert.match(f, /agents · 2/);                                     // lower pane = agents (a run resolved)
    assert.ok(f.indexOf('agents · 2') > f.indexOf('decided: team'), 'the lower pane is below the feed'); // feed above lower
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('watch in a non-TTY prints one clean frame and exits (no pile-up)', async () => {
  const home = await mkdtemp(join(tmpdir(), 'cc-cliwatch-notty-'));
  try {
    const lines: string[] = [];
    const code = await new Cli(l => lines.push(l), { env: { CREWCAST_HOME: home }, cwd: home }).run(['watch']);
    assert.equal(code, 0); // non-TTY: one frame, then return (no infinite in-place loop)
    const out = lines.join('\n');
    assert.match(out, /crewcast · live feed/);
    assert.equal(out.split('crewcast · live feed').length - 1, 1); // exactly one frame, not a pile
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('watchFrame: empty home shows the two panes with a "no decision yet" prompt', async () => {
  const home = await mkdtemp(join(tmpdir(), 'cc-cliwatch-empty-'));
  try {
    const cli = new Cli(() => {}, { env: { CREWCAST_HOME: home }, cwd: home });
    const f = await frame(cli, undefined);
    assert.match(f, /crewcast · live feed/);   // the frame is drawn even when empty
    assert.match(f, /no decision yet/i);
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
