import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Doctor } from '../src/install/doctor.js';
import type { Engine } from '../src/engines/catalog.js';

const E = (id: string, bin: string): Engine => ({
  id, bin, versionArgs: ['--version'], headless: [], models: ['default'], strongModel: null,
  modelFlag: '--model', effortArgs: ['-c', 'effort={effort}'], highEffort: 'high', parallelLimit: 1,
  writeFlags: ['--sandbox', 'workspace-write'], readFlags: ['--sandbox', 'read-only'], safeFlags: ['--json'], autoMode: false,
});

test('a flag present in --help is not stale; an absent one is listed stale', async () => {
  const warmed: string[] = [];
  const run = async (_bin: string, args: string[]) => {
    if (args[0] === '--version') return '1.0';
    if (args[0] === '--help') return 'usage: codex --model M --sandbox S'; // has --model, --sandbox; lacks --json and -c
    return '';
  };
  const report = await new Doctor({ baseUrl: 'http://x', run, warm: async m => { warmed.push(m); } }).run([E('codex', 'codex')]);
  const codex = report.engines.find(e => e.id === 'codex')!;
  assert.equal(codex.installed, true);
  assert.ok(codex.staleFlags.includes('--json'));
  assert.ok(codex.staleFlags.includes('-c'));
  assert.ok(!codex.staleFlags.includes('--model'));
  assert.ok(!codex.staleFlags.includes('--sandbox'));
  assert.deepEqual(warmed, ['mxbai-embed-large', 'kev:4b-q4_K_M']);
});

test('a CLI whose --help errors is skipped (no stale list), others still checked', async () => {
  const run = async (bin: string, args: string[]) => {
    if (args[0] === '--version') return '1.0';
    if (args[0] === '--help' && bin === 'bad') throw new Error('help failed');
    if (args[0] === '--help') return '--model --sandbox --json -c';
    return '';
  };
  const report = await new Doctor({ baseUrl: 'http://x', run, warm: async () => {} }).run([E('bad', 'bad'), E('ok', 'ok')]);
  assert.deepEqual(report.engines.find(e => e.id === 'bad')!.staleFlags, []);
  assert.deepEqual(report.engines.find(e => e.id === 'ok')!.staleFlags, []);
});
