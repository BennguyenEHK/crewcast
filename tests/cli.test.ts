import { mkdtemp, cp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Cli } from '../src/cli.js';

test('--version prints package version', async () => {
  const pkg = JSON.parse(await readFile(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8')) as { version: string };
  const lines: string[] = [];
  assert.equal(await new Cli(l => lines.push(l)).run(['--version']), 0);
  assert.equal(lines[0], pkg.version); // derive from package.json so a version bump never breaks this test
});

test('unknown command prints usage and returns 1', async () => {
  const lines: string[] = [];
  assert.equal(await new Cli(l => lines.push(l)).run(['nope']), 1);
  assert.match(lines.join('\n'), /usage: crewcast/);
});

test('skills lists each skill with its source dir, then the scan time', async () => {
  const home = await mkdtemp(join(tmpdir(), 'cc-cli-'));
  try {
    await cp(fileURLToPath(new URL('./fixtures/skills/user', import.meta.url)), join(home, '.claude', 'skills'), { recursive: true });
    const lines: string[] = [];
    const cli = new Cli(l => lines.push(l), { env: { USERPROFILE: home }, cwd: join(home, 'proj') });
    assert.equal(await cli.run(['skills']), 0);
    const out = lines.join('\n');
    assert.match(out, /folded-skill — .*\.claude[\\/]skills/);
    assert.match(out, /scan: \d+ ms/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
