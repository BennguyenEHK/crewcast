import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Cli } from '../src/cli.js';

test('setup then uninstall round-trips: mcp add→remove, skill installed→removed, manifest cleared', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cc-inst-'));
  try {
    const userHome = join(root, 'user');
    const crew = join(root, 'crewcast');
    const cwd = join(root, 'proj');
    await mkdir(cwd, { recursive: true });
    const env = { USERPROFILE: userHome, CREWCAST_HOME: crew };
    const runCalls: string[][] = [];
    const run = async (_bin: string, args: string[]) => { runCalls.push([_bin, ...args]); return args[0] === '--version' ? '1.0' : ''; };
    const warm = async () => {};
    const cli = new Cli(() => {}, { env, cwd, run, warm });

    assert.equal(await cli.run(['setup']), 0);
    assert.ok(runCalls.some(c => c[1] === 'mcp' && c[2] === 'add'), 'mcp add called');
    await stat(join(userHome, '.claude', 'skills', 'crewcast', 'SKILL.md')); // skill copied
    await stat(join(crew, 'installed.json')); // manifest written

    assert.equal(await cli.run(['uninstall']), 0);
    assert.ok(runCalls.some(c => c[1] === 'mcp' && c[2] === 'remove'), 'mcp remove called');
    await assert.rejects(stat(join(userHome, '.claude', 'skills', 'crewcast', 'SKILL.md'))); // skill removed
    await assert.rejects(stat(join(crew, 'installed.json'))); // manifest cleared
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('doctor runs and reports engines (fake run), exit 0', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cc-doc-'));
  try {
    const env = { USERPROFILE: join(root, 'user'), CREWCAST_HOME: join(root, 'crewcast') };
    const run = async (_bin: string, args: string[]) => (args[0] === '--version' ? '1.0' : '--model --sandbox --json -c');
    const lines: string[] = [];
    assert.equal(await new Cli(l => lines.push(l), { env, cwd: root, run, warm: async () => {} }).run(['doctor']), 0);
    assert.ok(lines.length > 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
