import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Cli } from '../src/cli.js';

test('crewcast engines --json detects, saves, and prints the catalog', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cc-eng-cli-'));
  try {
    const cwd = join(root, 'proj');
    await mkdir(cwd);
    const crew = join(root, 'crewcast');
    const env = { USERPROFILE: join(root, 'home'), CREWCAST_HOME: crew };
    const run = async (bin: string) => { if (bin === 'claude' || bin === 'codex') return '1.0\n'; throw new Error('ENOENT'); };
    const lines: string[] = [];
    const code = await new Cli(l => lines.push(l), { env, cwd, run }).run(['engines', '--json']);
    assert.equal(code, 0);
    assert.equal(lines.length, 1);
    const engines = JSON.parse(lines[0]);
    const installed = engines.filter((e: { installed: boolean }) => e.installed).map((e: { id: string }) => e.id).sort();
    assert.deepEqual(installed, ['claude', 'codex']);
    const saved = JSON.parse(await readFile(join(crew, 'engine-catalog.json'), 'utf8'));
    assert.equal(saved.length, engines.length);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
