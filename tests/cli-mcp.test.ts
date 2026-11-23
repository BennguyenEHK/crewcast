import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Cli } from '../src/cli.js';
import type { SystemOneRequest } from '../src/backend/systemone.js';

type Server = { handle(m: unknown): Promise<unknown> };
async function build(root: string): Promise<Server> {
  const cwd = join(root, 'proj');
  await mkdir(cwd);
  const env = { USERPROFILE: join(root, 'home'), CREWCAST_HOME: join(root, 'crewcast') };
  const ask = async (r: SystemOneRequest) => ({ model: r.model, answers: {} });
  const cli = new Cli(() => {}, { ask, env, cwd });
  return (cli as unknown as { buildMcpServer(): Promise<Server> }).buildMcpServer();
}

test('crewcast mcp server exposes decide, catalog and the mailbox tools', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cc-climcp-'));
  try {
    const server = await build(root);
    const res = (await server.handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' })) as { result: { tools: { name: string }[] } };
    assert.deepEqual(res.result.tools.map(t => t.name).sort(), ['catalog', 'decide', 'post_message', 'read_messages']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('post_message then read_messages round-trips through the server', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cc-climcp-rt-'));
  try {
    const server = await build(root);
    const call = (name: string, args: Record<string, unknown>) =>
      server.handle({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } });
    await call('post_message', { run: 'r1', from: 'w1', text: 'progress' });
    const res = (await call('read_messages', { run: 'r1' })) as { result: { content: { text: string }[] } };
    const payload = JSON.parse(res.result.content[0].text) as { messages: { from: string; text: string }[]; cursor: number };
    assert.equal(payload.cursor, 1);
    assert.deepEqual(payload.messages.map(m => [m.from, m.text]), [['w1', 'progress']]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
