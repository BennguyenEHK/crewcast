import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TranscriptReader } from '../src/transcript.js';

const fixture = (name: string) => join('tests', 'fixtures', 'transcripts', name);

test('solo fixture: skills extracted in order, mode solo', async () => {
  const s = await new TranscriptReader().summarize(fixture('solo.jsonl'));
  assert.equal(s.firstPrompt, 'Fix the login redirect bug');
  assert.deepEqual(s.actual.skills, ['systematic-debugging', 'test-driven-development']);
  assert.equal(s.actual.mode, 'solo');
  assert.deepEqual(s.actual.engines, ['claude']);
  assert.equal(s.cwd, 'D:\\dev\\demo');
  assert.equal(s.skipped, 0);
});

test('team fixture: general-purpose Agent → team', async () => {
  const s = await new TranscriptReader().summarize(fixture('team.jsonl'));
  assert.equal(s.actual.mode, 'team');
  assert.deepEqual(s.actual.skills, ['code-review']);
});

test('web-fetch-only fixture → solo', async () => {
  const s = await new TranscriptReader().summarize(fixture('webfetch-only.jsonl'));
  assert.equal(s.actual.mode, 'solo');
  assert.deepEqual(s.actual.skills, []);
});

test('background codex run → team with engine named', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cc-transcript-'));
  try {
    const file = join(dir, 't.jsonl');
    const bash = { type: 'tool_use', name: 'Bash', input: { command: 'codex exec "review"', run_in_background: true } };
    await writeFile(file, JSON.stringify({ type: 'assistant', message: { content: [bash] } }) + '\n', 'utf8');
    const s = await new TranscriptReader().summarize(file);
    assert.equal(s.actual.mode, 'team');
    assert.deepEqual(s.actual.engines, ['codex', 'claude']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('unknown line types and a corrupt line are skipped and counted', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cc-transcript-'));
  try {
    const file = join(dir, 't.jsonl');
    const lines = [
      '{"type":"summary","summary":"x"}',
      'not json',
      '{"type":"user","isSidechain":true,"message":{"content":"Side question"}}',
      '{"type":"user","message":{"content":"<command-name>/clear</command-name>"}}',
      '{"type":"user","message":{"content":"Real first prompt"}}',
    ];
    await writeFile(file, lines.join('\n') + '\n', 'utf8');
    const s = await new TranscriptReader().summarize(file);
    assert.equal(s.firstPrompt, 'Real first prompt');
    assert.equal(s.skipped, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
