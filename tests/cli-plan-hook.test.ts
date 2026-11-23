import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Cli } from '../src/cli.js';
import type { RunState } from '../src/dispatch/dispatcher.js';

const build = (cli: Cli, payload: string) => (cli as unknown as { buildHookOutput(p: string): Promise<string> }).buildHookOutput(payload);

async function withCwd(fn: (cwd: string, env: NodeJS.ProcessEnv) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'cc-planhook-'));
  try {
    const cwd = join(root, 'proj');
    await mkdir(cwd);
    await fn(cwd, { USERPROFILE: join(root, 'home'), CREWCAST_HOME: join(root, 'crew') });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('a PostToolUse ExitPlanMode payload dispatches from plan.md', async () => {
  await withCwd(async (cwd, env) => {
    const calls: { plan: string; run: string }[] = [];
    const dispatchPlan = async (plan: string, run: string): Promise<RunState> => { calls.push({ plan, run }); return { run, startedAt: 't', workers: [] }; };
    const out = await build(new Cli(() => {}, { env, cwd, dispatchPlan }), JSON.stringify({ hook_event_name: 'PostToolUse', tool_name: 'ExitPlanMode', tool_input: {} }));
    assert.equal(calls.length, 1);
    assert.match(calls[0].plan.replace(/\\/g, '/'), /plan\.md$/); // reads the project plan.md
    assert.match(out, /dispatch/i);
  });
});

test('a non-ExitPlanMode payload never dispatches', async () => {
  await withCwd(async (cwd, env) => {
    const calls: number[] = [];
    const dispatchPlan = async (_p: string, run: string): Promise<RunState> => { calls.push(1); return { run, startedAt: 't', workers: [] }; };
    await build(new Cli(() => {}, { env, cwd, dispatchPlan }), JSON.stringify({ prompt: 'fix a bug' }));
    assert.equal(calls.length, 0);
  });
});

test('malformed JSON is fail-open: no throw, no dispatch, empty output', async () => {
  await withCwd(async (cwd, env) => {
    const calls: number[] = [];
    const dispatchPlan = async (_p: string, run: string): Promise<RunState> => { calls.push(1); return { run, startedAt: 't', workers: [] }; };
    assert.equal(await build(new Cli(() => {}, { env, cwd, dispatchPlan }), 'not json'), '');
    assert.equal(calls.length, 0);
  });
});
