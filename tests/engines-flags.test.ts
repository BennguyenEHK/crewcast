import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Engine } from '../src/engines/catalog.js';
import { resolveFlags, type ResolveSignals } from '../src/engines/flags.js';

const E: Engine = {
  id: 'codex', bin: 'codex', versionArgs: ['--version'], headless: ['exec', '{task}'],
  models: ['base'], strongModel: 'strong', modelFlag: '--model',
  effortArgs: ['-c', 'effort={effort}'], highEffort: 'high', parallelLimit: 2,
  writeFlags: ['--sandbox', 'workspace-write'], readFlags: ['--sandbox', 'read-only'],
  safeFlags: ['--json'], autoMode: false,
};
const K: Engine = { ...E, id: 'kiro', modelFlag: null, effortArgs: [], highEffort: null, safeFlags: ['--safe'], autoMode: true };

test('risky task → strong model, high effort, write sandbox', () => {
  const s: ResolveSignals = { writes_files: true, risk_area: 'auth', size: null };
  const r = resolveFlags(E, s);
  assert.equal(r.model, 'strong');
  assert.equal(r.effort, 'high');
  assert.deepEqual(r.args, ['--json', '--sandbox', 'workspace-write', '--model', 'strong', '-c', 'effort=high']);
});

test('writes_files false → read-only flags, not write flags', () => {
  const r = resolveFlags(E, { writes_files: false, risk_area: 'none', size: 'one_file' });
  assert.ok(r.args.includes('read-only'));
  assert.ok(!r.args.includes('workspace-write'));
  assert.equal(r.effort, null);
  assert.equal(r.model, 'base');
});

test('many_files size → high effort even when risk is none', () => {
  const r = resolveFlags(E, { writes_files: true, risk_area: 'none', size: 'many_files' });
  assert.equal(r.effort, 'high');
  assert.equal(r.model, 'base');
});

test('auto-mode engine → model default, effort null, only safe flags', () => {
  const r = resolveFlags(K, { writes_files: true, risk_area: 'auth', size: 'many_files' });
  assert.deepEqual(r, { model: 'default', effort: null, args: ['--safe'] });
});

test('resolveFlags emits no flag outside the engine recipe', () => {
  const r = resolveFlags(E, { writes_files: true, risk_area: 'auth', size: 'many_files' });
  const allowed = new Set([...E.safeFlags, ...E.writeFlags, ...E.readFlags, E.modelFlag, 'strong', 'base', ...E.effortArgs.map(a => a.replace('{effort}', 'high'))]);
  for (const a of r.args) assert.ok(allowed.has(a), `unexpected arg: ${a}`);
});
