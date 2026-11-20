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

// Fake ask: no real Ollama. Empty home and cwd keep the real skill folders out of the scan.
async function withSandbox(fn: (sandbox: { env: NodeJS.ProcessEnv; cwd: string }) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'cc-decide-'));
  try {
    const home = join(root, 'home');
    const cwd = join(root, 'proj');
    await mkdir(cwd);
    await fn({ env: { USERPROFILE: home, CREWCAST_HOME: join(root, 'crewcast') }, cwd });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('decide --json with fake ask prints a parseable record', async () => {
  await withSandbox(async ({ env, cwd }) => {
    const seen: SystemOneRequest[] = [];
    const ask = async (r: SystemOneRequest) => { seen.push(r); return { model: r.model, answers: ANSWERS }; };
    const lines: string[] = [];
    const code = await new Cli(l => lines.push(l), { ask, env, cwd }).run(['decide', '--json', 'fix', 'the', 'login']);
    assert.equal(code, 0);
    assert.equal(seen[0].model, 'nimble');
    assert.equal(seen[0].state, 'fix the login');
    assert.equal(lines.length, 1);
    const rec = JSON.parse(lines[0]);
    assert.equal(rec.version, 1);
    assert.equal(rec.task, 'fix the login');
    assert.equal(rec.mode, 'solo');
  });
});

test('decide without --json prints mode, skills, branch and ms lines', async () => {
  await withSandbox(async ({ env, cwd }) => {
    const ask = async (r: SystemOneRequest) => ({ model: r.model, answers: ANSWERS });
    const lines: string[] = [];
    assert.equal(await new Cli(l => lines.push(l), { ask, env, cwd }).run(['decide', 'fix', 'it']), 0);
    assert.equal(lines.length, 4);
    assert.match(lines[0], /^mode: solo$/);
    assert.match(lines[1], /^skills: /);
    assert.match(lines[2], /^branch: keep$/);
    assert.match(lines[3], /^ms: \d+$/);
  });
});

test('ollama_unreachable → exit 2 and the exact one-line message', async () => {
  await withSandbox(async ({ env, cwd }) => {
    const ask = async () => { throw new BackendError('ollama_unreachable', 'cannot reach'); };
    const lines: string[] = [];
    const code = await new Cli(l => lines.push(l), { ask, env: { ...env, OLLAMA_HOST: '127.0.0.1:9999' }, cwd }).run(['decide', 'x']);
    assert.equal(code, 2);
    assert.deepEqual(lines, ['Ollama not reachable at http://127.0.0.1:9999 — start Ollama']);
  });
});

test('model_missing → exit 2 and the exact one-line message', async () => {
  await withSandbox(async ({ env, cwd }) => {
    const ask = async () => { throw new BackendError('model_missing', 'not pulled'); };
    const lines: string[] = [];
    const code = await new Cli(l => lines.push(l), { ask, env, cwd }).run(['decide', '--model', 'qwen', 'x']);
    assert.equal(code, 2);
    assert.deepEqual(lines, ["model 'qwen' not found — run: ollama pull qwen"]);
  });
});

test('timeout → exit 2 and one line naming the base URL', async () => {
  await withSandbox(async ({ env, cwd }) => {
    const ask = async () => { throw new BackendError('timeout', 'slow'); };
    const lines: string[] = [];
    const code = await new Cli(l => lines.push(l), { ask, env: { ...env, OLLAMA_HOST: '127.0.0.1:9999' }, cwd }).run(['decide', 'x']);
    assert.equal(code, 2);
    assert.equal(lines.length, 1);
    assert.match(lines[0], /http:\/\/127\.0\.0\.1:9999/);
  });
});

test('bad_response → exit 2 and one error line', async () => {
  await withSandbox(async ({ env, cwd }) => {
    const ask = async () => { throw new BackendError('bad_response', 'response has no answers'); };
    const lines: string[] = [];
    const code = await new Cli(l => lines.push(l), { ask, env, cwd }).run(['decide', 'x']);
    assert.equal(code, 2);
    assert.deepEqual(lines, ['error: response has no answers']);
  });
});

test('decide without a task → usage and exit 1', async () => {
  await withSandbox(async ({ env, cwd }) => {
    const lines: string[] = [];
    assert.equal(await new Cli(l => lines.push(l), { env, cwd }).run(['decide']), 1);
    assert.match(lines.join('\n'), /usage: crewcast/);
  });
});
