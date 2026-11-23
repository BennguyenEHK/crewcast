import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Mailbox } from '../src/mailbox.js';
import { PostMessageTool } from '../src/mcp/post-message-tool.js';
import { ReadMessagesTool } from '../src/mcp/read-messages-tool.js';

async function withMbx(fn: (mbx: Mailbox) => Promise<void>) {
  const h = await mkdtemp(join(tmpdir(), 'cc-mbxtool-'));
  try { await fn(new Mailbox(h)); } finally { await rm(h, { recursive: true, force: true }); }
}

test('post_message writes and read_messages returns the message + cursor', async () => {
  await withMbx(async mailbox => {
    const post = new PostMessageTool({ mailbox });
    const read = new ReadMessagesTool({ mailbox });
    const p = await post.call({ run: 'r', from: 'w1', text: 'hi' });
    assert.ok(!p.isError, p.content[0].text);
    const r = await read.call({ run: 'r' });
    assert.ok(!r.isError);
    const payload = JSON.parse(r.content[0].text) as { messages: { seq: number; from: string; text: string }[]; cursor: number };
    assert.equal(payload.cursor, 1);
    assert.deepEqual(payload.messages.map(m => [m.seq, m.from, m.text]), [[1, 'w1', 'hi']]);
  });
});

test('read_messages honors since', async () => {
  await withMbx(async mailbox => {
    const post = new PostMessageTool({ mailbox });
    await post.call({ run: 'r', from: 'w', text: 'a' });
    await post.call({ run: 'r', from: 'w', text: 'b' });
    const r = await new ReadMessagesTool({ mailbox }).call({ run: 'r', since: 1 });
    assert.deepEqual((JSON.parse(r.content[0].text) as { messages: { text: string }[] }).messages.map(m => m.text), ['b']);
  });
});

test('bad args are reported as isError, never thrown', async () => {
  await withMbx(async mailbox => {
    assert.ok((await new PostMessageTool({ mailbox }).call({ run: 'r', from: 'w' })).isError);     // no text
    assert.ok((await new PostMessageTool({ mailbox }).call({ from: 'w', text: 'x' })).isError);     // no run
    assert.ok((await new ReadMessagesTool({ mailbox }).call({})).isError);                           // no run
    assert.ok((await new ReadMessagesTool({ mailbox }).call({ run: 'r', since: 'x' })).isError);     // since not a number
    assert.ok((await new PostMessageTool({ mailbox }).call({ run: '../x', from: 'w', text: 'y' })).isError); // guard throw → isError
  });
});
