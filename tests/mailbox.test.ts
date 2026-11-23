import { appendFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Mailbox } from '../src/mailbox.js';

async function withHome(fn: (home: string) => Promise<void>) {
  const h = await mkdtemp(join(tmpdir(), 'cc-mbx-'));
  try { await fn(h); } finally { await rm(h, { recursive: true, force: true }); }
}

test('post then read: entries carry a 1-based seq and the cursor is the total', async () => {
  await withHome(async home => {
    const mbx = new Mailbox(home);
    await mbx.post('r1', 'w1', 'first');
    await mbx.post('r1', 'w2', 'second');
    const { messages, cursor } = await mbx.read('r1');
    assert.equal(cursor, 2);
    assert.equal(messages.length, 2);
    assert.deepEqual(messages.map(m => m.seq), [1, 2]);
    assert.deepEqual(messages.map(m => [m.from, m.text]), [['w1', 'first'], ['w2', 'second']]);
    assert.match(messages[0].ts, /^\d{4}-\d\d-\d\dT/); // ISO timestamp
  });
});

test('read since a cursor returns only newer entries; past the end is empty', async () => {
  await withHome(async home => {
    const mbx = new Mailbox(home);
    await mbx.post('r1', 'w1', 'a');
    await mbx.post('r1', 'w1', 'b');
    assert.deepEqual((await mbx.read('r1', 1)).messages.map(m => m.text), ['b']);
    assert.deepEqual(await mbx.read('r1', 2), { messages: [], cursor: 2 });
  });
});

test('read on a run with no file is empty, not a crash', async () => {
  await withHome(async home => {
    assert.deepEqual(await new Mailbox(home).read('nope'), { messages: [], cursor: 0 });
  });
});

test('a corrupt line is skipped; surviving lines keep contiguous seq', async () => {
  await withHome(async home => {
    const mbx = new Mailbox(home);
    await mbx.post('r1', 'w1', 'good1');
    await appendFile(join(home, 'runs', 'r1', 'mailbox.jsonl'), 'not json\n', 'utf8');
    await mbx.post('r1', 'w1', 'good2');
    const { messages, cursor } = await mbx.read('r1');
    assert.deepEqual(messages.map(m => [m.seq, m.text]), [[1, 'good1'], [2, 'good2']]);
    assert.equal(cursor, 2);
  });
});

test('redaction masks key-shaped tokens but leaves prose', async () => {
  assert.equal(
    Mailbox.redact('token sk-ABCD1234efgh5678 and password=hunter2 ok'),
    'token *** and *** ok',
  );
  assert.match(Mailbox.redact('Authorization: Bearer abcdef123456789'), /\*\*\*/);
  assert.equal(Mailbox.redact('a normal sentence about keys and tokens'), 'a normal sentence about keys and tokens');
});

test('a run id that escapes the runs dir is rejected', async () => {
  await withHome(async home => {
    const mbx = new Mailbox(home);
    await assert.rejects(mbx.post('../escape', 'w', 'x'));
    await assert.rejects(mbx.post('a/b', 'w', 'x'));
    await assert.rejects(mbx.post('', 'w', 'x'));
  });
});
