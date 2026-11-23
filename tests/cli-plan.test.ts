import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Cli } from '../src/cli.js';
import type { Engine } from '../src/engines/catalog.js';

const engine = (id: string, installed: boolean): Engine => ({
  id, bin: id, versionArgs: ['--version'], installed, headless: [], models: [`${id}-base`], strongModel: `${id}-strong`,
  modelFlag: '--model', effortArgs: ['--effort', '{effort}'], highEffort: 'high', parallelLimit: 2,
  writeFlags: ['--write'], readFlags: ['--read'], safeFlags: ['--safe'], autoMode: false,
} as Engine);

async function sandbox(): Promise<{ home: string; cwd: string; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), 'cc-plan-'));
  const home = join(root, 'crewcast');
  await mkdir(home, { recursive: true });
  await writeFile(join(home, 'engine-catalog.json'), JSON.stringify([engine('claude', true), engine('codex', true)]), 'utf8');
  return { home, cwd: join(root, 'proj'), cleanup: () => rm(root, { recursive: true, force: true }) };
}

test('crewcast plan --json prints a per-unit allocation', async () => {
  const { home, cwd, cleanup } = await sandbox();
  try {
    const planFile = join(home, 'plan.md');
    await writeFile(planFile, '## A\nfiles: a.ts\ndepends: none\n\n## B\nfiles: b.ts\ndepends: A\n', 'utf8');
    const lines: string[] = [];
    const cli = new Cli(l => lines.push(l), { env: { CREWCAST_HOME: home }, cwd, pickSkills: async () => ['skill-x'] });
    assert.equal(await cli.run(['plan', planFile, '--json']), 0);
    const payload = JSON.parse(lines.join('\n')) as { units: { id: string; group: number; engine: string }[] };
    assert.equal(payload.units.length, 2);
    assert.deepEqual(payload.units.map(u => [u.id, u.group]), [['A', 0], ['B', 1]]);
    assert.ok(payload.units.every(u => typeof u.engine === 'string' && u.engine.length));
  } finally {
    await cleanup();
  }
});

test('a missing plan file exits non-zero with a message', async () => {
  const { home, cwd, cleanup } = await sandbox();
  try {
    const lines: string[] = [];
    const cli = new Cli(l => lines.push(l), { env: { CREWCAST_HOME: home }, cwd, pickSkills: async () => [] });
    assert.notEqual(await cli.run(['plan', join(home, 'nope.md')]), 0);
    assert.ok(lines.some(l => /not|error|no such|ENOENT/i.test(l)), lines.join('\n'));
  } finally {
    await cleanup();
  }
});
