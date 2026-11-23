import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Uninstall } from '../src/install/uninstall.js';
import { InstalledManifest } from '../src/install/manifest.js';

async function withHome(fn: (home: string) => Promise<void>) {
  const h = await mkdtemp(join(tmpdir(), 'cc-uninst-'));
  try { await fn(h); } finally { await rm(h, { recursive: true, force: true }); }
}

test('uninstall reverses the recorded actions and clears the manifest', async () => {
  await withHome(async home => {
    const m = new InstalledManifest(home);
    await m.record({ kind: 'mcp', server: 'crewcast' });
    await m.record({ kind: 'skillCopy', dest: '/u/.claude/skills/crewcast' });
    await m.record({ kind: 'hook', settingsPath: '/u/.claude/settings.json' });
    const runCalls: string[][] = [];
    const removed: string[] = [];
    const hooks: string[] = [];
    const u = new Uninstall({
      home,
      run: async (bin, args) => { runCalls.push([bin, ...args]); return ''; },
      remove: async p => { removed.push(p); },
      removeHook: async p => { hooks.push(p); },
    });
    const res = await u.run();
    assert.ok(runCalls.some(c => c[1] === 'mcp' && c[2] === 'remove' && c[3] === 'crewcast'));
    assert.ok(removed.includes('/u/.claude/skills/crewcast'));
    assert.ok(hooks.includes('/u/.claude/settings.json'));
    assert.equal(res.removed.length, 3);
    assert.deepEqual(await m.load(), []); // manifest cleared
  });
});

test('uninstall with no manifest → nothing removed, no crash', async () => {
  await withHome(async home => {
    const u = new Uninstall({ home, run: async () => '', remove: async () => {}, removeHook: async () => {} });
    assert.deepEqual((await u.run()).removed, []);
  });
});

test('an already-deleted target is skipped; the rest are still removed', async () => {
  await withHome(async home => {
    const m = new InstalledManifest(home);
    await m.record({ kind: 'mcp', server: 'crewcast' });
    await m.record({ kind: 'skillCopy', dest: '/gone' });
    const removed: string[] = [];
    const u = new Uninstall({
      home,
      run: async () => '',
      remove: async p => { if (p === '/gone') throw new Error('ENOENT'); removed.push(p); },
      removeHook: async () => {},
    });
    const res = await u.run(); // must not throw
    assert.ok(res.removed.some(r => r.includes('mcp')));
    assert.deepEqual(await m.load(), []);
  });
});
