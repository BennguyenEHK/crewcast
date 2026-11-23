import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ActivityLog, summarizeEvent, type ActivityEvent } from '../src/activity.js';

test('append then recent returns the last n events in order; missing file is empty', async () => {
  const home = await mkdtemp(join(tmpdir(), 'cc-act-'));
  try {
    const log = new ActivityLog(home);
    await log.append({ kind: 'prompt-received', ts: 't1', task: 'a' });
    await log.append({ kind: 'decided', ts: 't2', mode: 'solo', skills: [], branch: 'keep', task: 'a' });
    await log.append({ kind: 'dispatch', ts: 't3', run: 'r1', units: [{ unit: 'u', engine: 'codex' }] });
    const last2 = await log.recent(2);
    assert.deepEqual(last2.map(e => e.kind), ['decided', 'dispatch']);
    assert.deepEqual((await new ActivityLog(join(home, 'nope')).recent(10)), []);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('summarizeEvent renders each kind with its key facts', () => {
  const cases: [ActivityEvent, RegExp][] = [
    [{ kind: 'prompt-received', ts: 't', task: 'x' }, /prompt received/i],
    [{ kind: 'decided', ts: 't', mode: 'team', skills: ['tdd', 'auth'], branch: 'feat/x', task: 'x' }, /team.*tdd.*auth.*feat\/x/],
    [{ kind: 'decide-failed', ts: 't', reason: 'Ollama not reachable' }, /decide failed.*Ollama/],
    [{ kind: 'dispatch', ts: 't', run: 'r1', units: [{ unit: 'auth', engine: 'codex' }, { unit: 'ui', engine: 'agy' }] }, /codex.*auth.*agy.*ui/],
  ];
  for (const [e, re] of cases) assert.match(summarizeEvent(e), re);
});

test('append never throws, even when the log location cannot be written', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cc-act2-'));
  try {
    const asFile = join(root, 'blocker');
    await writeFile(asFile, 'x', 'utf8'); // a file where ActivityLog expects a home directory
    await new ActivityLog(asFile).append({ kind: 'prompt-received', ts: 't', task: 'a' }); // must resolve, not throw
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
