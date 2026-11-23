import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InstalledManifest, type Action } from '../src/install/manifest.js';

async function withHome(fn: (home: string) => Promise<void>) {
  const h = await mkdtemp(join(tmpdir(), 'cc-man-'));
  try { await fn(h); } finally { await rm(h, { recursive: true, force: true }); }
}

test('record is idempotent — the same action twice is stored once', async () => {
  await withHome(async home => {
    const m = new InstalledManifest(home);
    const a: Action = { kind: 'mcp', server: 'crewcast' };
    await m.record(a);
    await m.record(a);
    assert.deepEqual(await m.load(), [a]);
  });
});

test('load with no manifest → []', async () => {
  await withHome(async home => assert.deepEqual(await new InstalledManifest(home).load(), []));
});

test('load on a corrupt manifest → []', async () => {
  await withHome(async home => {
    await writeFile(join(home, 'installed.json'), '{bad', 'utf8');
    assert.deepEqual(await new InstalledManifest(home).load(), []);
  });
});

test('clear removes the manifest', async () => {
  await withHome(async home => {
    const m = new InstalledManifest(home);
    await m.record({ kind: 'dir', path: '/x' });
    await m.clear();
    assert.deepEqual(await m.load(), []);
  });
});
