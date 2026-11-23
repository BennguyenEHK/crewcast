import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Cli } from '../src/cli.js';
import type { SystemOneRequest } from '../src/backend/systemone.js';

test('crewcast mcp server exposes exactly decide and catalog', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cc-climcp-'));
  try {
    const cwd = join(root, 'proj');
    await mkdir(cwd);
    const env = { USERPROFILE: join(root, 'home'), CREWCAST_HOME: join(root, 'crewcast') };
    const ask = async (r: SystemOneRequest) => ({ model: r.model, answers: {} });
    const cli = new Cli(() => {}, { ask, env, cwd });
    const server = await (cli as unknown as { buildMcpServer(): Promise<{ handle(m: unknown): Promise<unknown> }> }).buildMcpServer();
    const res = (await server.handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' })) as { result: { tools: { name: string }[] } };
    assert.deepEqual(res.result.tools.map(t => t.name), ['decide', 'catalog']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
