import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Cli } from '../src/cli.js';
import { BackendError, type SystemOneRequest, type SystemOneResponse } from '../src/backend/systemone.js';

const ANSWERS: SystemOneResponse['answers'] = {
  task_type: { type: 'choice', choice: 'fix', probabilities: { fix: 0.9 }, confidence: 0.9 },
  writes_files: { type: 'noul', noul: 0.95 },
  risk_area: { type: 'choice', choice: 'none', probabilities: { none: 0.9 }, confidence: 0.9 },
  size: { type: 'choice', choice: 'one_file', probabilities: { one_file: 0.9 }, confidence: 0.9 },
  needs_web: { type: 'noul', noul: 0.05 },
};

async function withCli(ask: (r: SystemOneRequest) => Promise<SystemOneResponse>, fn: (cli: Cli) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'cc-hook-'));
  try {
    const cwd = join(root, 'proj');
    await mkdir(cwd);
    const env = { USERPROFILE: join(root, 'home'), CREWCAST_HOME: join(root, 'crewcast') };
    await fn(new Cli(() => {}, { ask, env, cwd }));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
const build = (cli: Cli, payload: string) => (cli as unknown as { buildHookOutput(p: string): Promise<string> }).buildHookOutput(payload);
const okAsk = async (r: SystemOneRequest) => ({ model: r.model, answers: ANSWERS });

test('a prompt under 8 words → empty output', async () => {
  await withCli(okAsk, async cli => assert.equal(await build(cli, JSON.stringify({ prompt: 'yes go ahead please' })), ''));
});

test('a non-JSON payload → empty output, no throw', async () => {
  await withCli(okAsk, async cli => assert.equal(await build(cli, 'not json at all'), ''));
});

test('a real prompt → hook JSON with additionalContext naming the mode', async () => {
  await withCli(okAsk, async cli => {
    const out = await build(cli, JSON.stringify({ prompt: 'fix the login redirect bug after the session expires' }));
    const parsed = JSON.parse(out);
    assert.equal(parsed.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
    assert.match(parsed.hookSpecificOutput.additionalContext, /mode=solo/);
  });
});

test('a team-phrase prompt → additionalContext carries the captain line', async () => {
  await withCli(okAsk, async cli => {
    const out = await build(cli, JSON.stringify({ prompt: 'please refactor the payment module across the codebase use team agents' }));
    const parsed = JSON.parse(out);
    assert.match(parsed.hookSpecificOutput.additionalContext, /mode=team/);
    assert.match(parsed.hookSpecificOutput.additionalContext, /captain/i);
  });
});

test('decide error (ask throws) → empty output', async () => {
  const ask = async () => { throw new BackendError('ollama_unreachable', 'down'); };
  await withCli(ask, async cli => assert.equal(await build(cli, JSON.stringify({ prompt: 'fix the login redirect bug after the session expires' })), ''));
});

test('timeout BackendError → empty output', async () => {
  const ask = async () => { throw new BackendError('timeout', 'slow'); };
  await withCli(ask, async cli => assert.equal(await build(cli, JSON.stringify({ prompt: 'fix the login redirect bug after the session expires' })), ''));
});

test('a slow decide → empty within the hook budget (no long stall)', { timeout: 2000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'cc-hook-'));
  try {
    const cwd = join(root, 'proj');
    await mkdir(cwd);
    const env = { USERPROFILE: join(root, 'home'), CREWCAST_HOME: join(root, 'crewcast') };
    const ask = (_r: SystemOneRequest) => new Promise<SystemOneResponse>(res => setTimeout(() => res({ model: 'x', answers: ANSWERS }), 400));
    const cli = new Cli(() => {}, { ask, env, cwd, hookTimeoutMs: 50 });
    const start = Date.now();
    assert.equal(await build(cli, JSON.stringify({ prompt: 'fix the login redirect bug after the session expires' })), ''); // 50ms deadline beat the 400ms decide
    assert.ok(Date.now() - start < 300);
    await new Promise(r => setTimeout(r, 450)); // let the slow ask settle so no promise dangles
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// --- live feed: the hook narrates its decision to the activity log ---
import { ActivityLog, type ActivityEvent } from '../src/activity.js';

async function hookHome(ask: (r: SystemOneRequest) => Promise<SystemOneResponse>, prompt: string, extraEnv: Record<string, string> = {}): Promise<ActivityEvent[]> {
  const root = await mkdtemp(join(tmpdir(), 'cc-hookact-'));
  try {
    const home = join(root, 'crewcast');
    const cwd = join(root, 'proj');
    await mkdir(cwd, { recursive: true });
    const cli = new Cli(() => {}, { ask, env: { USERPROFILE: join(root, 'home'), CREWCAST_HOME: home, ...extraEnv }, cwd });
    await build(cli, JSON.stringify({ prompt }));
    return await new ActivityLog(home).recent(10);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('hook narrates prompt-received then decided', async () => {
  const events = await hookHome(okAsk, 'please add google login to the settings page now');
  assert.deepEqual(events.map(e => e.kind), ['prompt-received', 'decided']);
  assert.equal((events[1] as Extract<ActivityEvent, { kind: 'decided' }>).mode, 'solo');
});

test('hook narrates decide-failed when the backend is unreachable (not silence)', async () => {
  const badAsk = async () => { throw new BackendError('ollama_unreachable', 'cannot reach ollama'); };
  const events = await hookHome(badAsk, 'please add google login to the settings page now');
  assert.deepEqual(events.map(e => e.kind), ['prompt-received', 'decide-failed']);
});

test('an orchestrated prompt (CREWCAST_RUN set) skips prompt-received, keeps decided', async () => {
  // A dispatched worker / captain run carries CREWCAST_RUN; prompt-received is for a human pressing enter, so it is skipped.
  const events = await hookHome(okAsk, 'please add google login to the settings page now', { CREWCAST_RUN: 'r1' });
  assert.deepEqual(events.map(e => e.kind), ['decided']);
});

test('the prompt text in the activity event is redacted', async () => {
  const events = await hookHome(okAsk, 'please set api_key=hunter2secretvalue in the config file now');
  const first = events[0] as Extract<ActivityEvent, { kind: 'prompt-received' }>;
  assert.ok(first.task.includes('***'), first.task);
  assert.ok(!first.task.includes('hunter2secretvalue'), first.task);
});
