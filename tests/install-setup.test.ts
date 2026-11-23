import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Setup } from '../src/install/setup.js';
import { InstalledManifest } from '../src/install/manifest.js';

async function withHomes(fn: (crewHome: string, userHome: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'cc-setup-'));
  try { await fn(join(root, 'crew'), join(root, 'user')); } finally { await rm(root, { recursive: true, force: true }); }
}

function fakes() {
  const calls: string[][] = [];
  const copied: string[] = [];
  const warmed: string[] = [];
  return {
    calls, copied, warmed,
    run: async (bin: string, args: string[]) => { calls.push([bin, ...args]); return args[0] === 'mcp' ? '' : '1.0'; },
    copyDir: async (_from: string, to: string) => { copied.push(to); },
    warm: async (m: string) => { warmed.push(m); },
    installHook: async (userHome: string) => join(userHome, '.claude', 'settings.json'),
  };
}
const mk = (crewHome: string, userHome: string, f: ReturnType<typeof fakes>, over: Partial<ReturnType<typeof fakes>> = {}) =>
  new Setup({ crewHome, userHome, skillSource: '/repo/skills/crewcast', baseUrl: 'http://x', run: over.run ?? f.run, copyDir: over.copyDir ?? f.copyDir, warm: f.warm, installHook: f.installHook });

test('a clean setup registers mcp, installs the skill + hook, and pre-warms both models', async () => {
  await withHomes(async (crewHome, userHome) => {
    const f = fakes();
    const { steps } = await mk(crewHome, userHome, f).run();
    assert.ok(f.calls.some(c => c[0] === 'claude' && c[1] === 'mcp' && c[2] === 'add'));
    assert.ok(f.copied.includes(join(userHome, '.claude', 'skills', 'crewcast')));
    assert.deepEqual(f.warmed, ['mxbai-embed-large', 'kev:4b-q4_K_M']);
    const actions = await new InstalledManifest(crewHome).load();
    assert.ok(actions.some(a => a.kind === 'mcp'));
    assert.ok(actions.some(a => a.kind === 'skillCopy'));
    assert.ok(actions.some(a => a.kind === 'hook'));
    assert.ok(steps.length >= 4);
  });
});

test('setup run twice is idempotent — no duplicate manifest entries', async () => {
  await withHomes(async (crewHome, userHome) => {
    const f = fakes();
    await mk(crewHome, userHome, f).run();
    await mk(crewHome, userHome, f).run();
    const actions = await new InstalledManifest(crewHome).load();
    assert.equal(actions.filter(a => a.kind === 'mcp').length, 1);
    assert.equal(actions.filter(a => a.kind === 'skillCopy').length, 1);
    assert.equal(actions.filter(a => a.kind === 'hook').length, 1);
  });
});

test('a step failing after mcp succeeds still leaves the mcp recorded', async () => {
  await withHomes(async (crewHome, userHome) => {
    const f = fakes();
    const boomCopy = async () => { throw new Error('copy failed'); };
    await assert.rejects(mk(crewHome, userHome, f, { copyDir: boomCopy }).run(), /copy failed/);
    const actions = await new InstalledManifest(crewHome).load();
    assert.ok(actions.some(a => a.kind === 'mcp')); // what succeeded is recorded → uninstall can reverse it
  });
});
