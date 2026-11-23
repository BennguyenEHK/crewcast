import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EngineCatalog, DEFAULT_ENGINES, type Engine } from '../src/engines/catalog.js';

const eng = (id: string, bin: string): Engine => ({
  id, bin, versionArgs: ['--version'], headless: ['-p', '{task}'],
  models: ['m1'], strongModel: 'm2', modelFlag: '--model', effortArgs: ['-e', '{effort}'], highEffort: 'high',
  parallelLimit: 1, writeFlags: ['--write'], readFlags: ['--read'], safeFlags: ['-s'], autoMode: false,
});

test('detect marks a CLI installed with its version when --version succeeds', async () => {
  const run = async (bin: string) => { if (bin === 'codex') return '1.2.3\n'; throw new Error('ENOENT'); };
  const out = await new EngineCatalog({ run }).detect([eng('codex', 'codex'), eng('gemini', 'gemini')]);
  const codex = out.find(e => e.id === 'codex')!;
  const gemini = out.find(e => e.id === 'gemini')!;
  assert.equal(codex.installed, true);
  assert.equal(codex.version, '1.2.3');
  assert.equal(gemini.installed, false);
  assert.equal(gemini.version, null);
});

test('a CLI not on PATH (run throws ENOENT) → installed false, no crash', async () => {
  const run = async () => { const e = new Error('spawn ENOENT') as NodeJS.ErrnoException; e.code = 'ENOENT'; throw e; };
  const out = await new EngineCatalog({ run }).detect([eng('codex', 'codex')]);
  assert.equal(out[0].installed, false);
  assert.equal(out[0].version, null);
});

test('one CLI failing does not stop detection of the rest', async () => {
  const run = async (bin: string) => { if (bin === 'bad') throw new Error('boom'); return '9.9\n'; };
  const out = await new EngineCatalog({ run }).detect([eng('bad', 'bad'), eng('ok', 'ok')]);
  assert.equal(out.find(e => e.id === 'bad')!.installed, false);
  assert.equal(out.find(e => e.id === 'ok')!.installed, true);
});

test('DEFAULT_ENGINES contains no permission-off flag', () => {
  const bad = /yolo|skip-permissions|allow-all-paths|dangerous/i;
  assert.ok(DEFAULT_ENGINES.length >= 5);
  for (const e of DEFAULT_ENGINES) {
    for (const f of [...e.writeFlags, ...e.readFlags, ...e.safeFlags, ...e.headless, ...e.effortArgs]) {
      assert.ok(!bad.test(f), `${e.id}: ${f}`);
    }
  }
});
