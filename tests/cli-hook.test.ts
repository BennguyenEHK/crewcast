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
