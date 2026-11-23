import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DecideTool } from '../src/mcp/decide-tool.js';
import { BackendError, type SystemOneRequest, type SystemOneResponse } from '../src/backend/systemone.js';

const ANSWERS: SystemOneResponse['answers'] = {
  task_type: { type: 'choice', choice: 'fix', probabilities: { fix: 0.9 }, confidence: 0.9 },
  writes_files: { type: 'noul', noul: 0.95 },
  risk_area: { type: 'choice', choice: 'none', probabilities: { none: 0.9 }, confidence: 0.9 },
  size: { type: 'choice', choice: 'one_file', probabilities: { one_file: 0.9 }, confidence: 0.9 },
  needs_web: { type: 'noul', noul: 0.05 },
};

async function withHome(fn: (home: string) => Promise<void>) {
  const home = await mkdtemp(join(tmpdir(), 'cc-mcp-'));
  try { await fn(home); } finally { await rm(home, { recursive: true, force: true }); }
}
const tool = (home: string, ask: (r: SystemOneRequest) => Promise<SystemOneResponse>) =>
  new DecideTool({ ask, skills: [], git: null, home, baseUrl: 'http://127.0.0.1:11434', defaultModel: 'kev:4b-q4_K_M' });

test('decide tool returns a DecisionRecord JSON for a task', async () => {
  await withHome(async home => {
    const ask = async (r: SystemOneRequest) => ({ model: r.model, answers: ANSWERS });
    const res = await tool(home, ask).call({ task: 'fix the login' });
    assert.ok(!res.isError);
    const rec = JSON.parse(res.content[0].text);
    assert.equal(rec.version, 1);
    assert.equal(rec.task, 'fix the login');
    assert.equal(rec.mode, 'solo');
  });
});

test('missing task → isError content', async () => {
  await withHome(async home => {
    const ask = async (r: SystemOneRequest) => ({ model: r.model, answers: ANSWERS });
    const res = await tool(home, ask).call({});
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /task/i);
  });
});

test('a BackendError (ollama_unreachable) → isError content, no throw', async () => {
  await withHome(async home => {
    const ask = async () => { throw new BackendError('ollama_unreachable', 'cannot reach'); };
    const res = await tool(home, ask).call({ task: 'fix the login' });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /not reachable/i);
  });
});
