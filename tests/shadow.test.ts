import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Cli } from '../src/cli.js';
import { ShadowLog } from '../src/shadow.js';
import type { SystemOneResponse } from '../src/backend/systemone.js';

const ANSWERS: SystemOneResponse['answers'] = {
  task_type: { type: 'choice', choice: 'fix', probabilities: { fix: 0.9 }, confidence: 0.9 },
  writes_files: { type: 'noul', noul: 0.95 },
  risk_area: { type: 'choice', choice: 'none', probabilities: { none: 0.9 }, confidence: 0.9 },
  size: { type: 'choice', choice: 'one_file', probabilities: { one_file: 0.9 }, confidence: 0.9 },
  needs_web: { type: 'noul', noul: 0.05 },
};

async function withSandbox(fn: (sandbox: { env: NodeJS.ProcessEnv; cwd: string; home: string }) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'cc-shadow-'));
  try {
    const home = join(root, 'crewcast');
    await fn({ env: { USERPROFILE: join(root, 'user'), CREWCAST_HOME: home }, cwd: join(root, 'proj'), home });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const ask = async (r: { model: string }) => ({ model: r.model, answers: ANSWERS });

test('readJsonl skips a corrupt line and counts it', async () => {
  await withSandbox(async ({ home }) => {
    const file = join(home, 'x.jsonl');
    await mkdir(home, { recursive: true });
    await writeFile(file, '{"id":"1"}\nnot json\n\n{"id":"2"}\n', 'utf8');
    const { rows, skipped } = await ShadowLog.readJsonl<{ id: string }>(file);
    assert.deepEqual(rows, [{ id: '1' }, { id: '2' }]);
    assert.equal(skipped, 1);
  });
});

test('readJsonl of a missing file → no rows, nothing skipped', async () => {
  await withSandbox(async ({ home }) => {
    assert.deepEqual(await ShadowLog.readJsonl(join(home, 'nope.jsonl')), { rows: [], skipped: 0 });
  });
});

test('last label for an id wins', async () => {
  await withSandbox(async ({ env, cwd, home }) => {
    // The shadow row says solo; the first label says team, the later label says solo.
    const decide = new Cli(() => {}, { ask, env, cwd });
    assert.equal(await decide.run(['decide', 'fix', 'it']), 0);
    const { rows } = await ShadowLog.readJsonl<{ id: string }>(join(home, 'shadow.jsonl'));
    const id = rows[0].id;
    const lines: string[] = [];
    const cli = new Cli(l => lines.push(l), { env, cwd });
    assert.equal(await cli.run(['label', id, '--mode', 'team', '--skills', '']), 0);
    assert.equal(await cli.run(['label', id, '--mode', 'solo', '--skills', '']), 0);
    lines.length = 0;
    assert.equal(await cli.run(['stats']), 0);
    assert.match(lines.join('\n'), /mode agreement: 1\.00/);
    assert.match(lines.join('\n'), /unlabelled: 0/);
  });
});

test('decide appends a shadow row; an unlabelled row is counted by stats', async () => {
  await withSandbox(async ({ env, cwd, home }) => {
    assert.equal(await new Cli(() => {}, { ask, env, cwd }).run(['decide', 'fix', 'it']), 0);
    const { rows } = await ShadowLog.readJsonl<{ mode: string }>(join(home, 'shadow.jsonl'));
    assert.equal(rows.length, 1);
    const lines: string[] = [];
    assert.equal(await new Cli(l => lines.push(l), { env, cwd }).run(['stats']), 0);
    assert.match(lines.join('\n'), /unlabelled: 1/);
    assert.match(lines.join('\n'), /^(PASS|FAIL)$/m);
  });
});

test('label with a bad mode or missing --skills → usage and exit 1', async () => {
  await withSandbox(async ({ env, cwd }) => {
    const lines: string[] = [];
    const cli = new Cli(l => lines.push(l), { env, cwd });
    assert.equal(await cli.run(['label', 'x', '--mode', 'both', '--skills', 'a']), 1);
    assert.equal(await cli.run(['label', 'x', '--mode', 'solo']), 1);
    assert.match(lines.join('\n'), /usage: crewcast/);
  });
});

test('stats skips null and wrong-shape shadow and label lines, counting them as skipped', async () => {
  await withSandbox(async ({ env, cwd, home }) => {
    assert.equal(await new Cli(() => {}, { ask, env, cwd }).run(['decide', 'fix', 'it']), 0);
    await writeFile(join(home, 'shadow.jsonl'), (await readFile(join(home, 'shadow.jsonl'), 'utf8')) + 'null\n{}\n', 'utf8');
    await writeFile(join(home, 'labels.jsonl'), 'null\n{"id":"x"}\n', 'utf8');
    const lines: string[] = [];
    assert.equal(await new Cli(l => lines.push(l), { env, cwd }).run(['stats']), 0);
    assert.match(lines.join('\n'), /skipped lines: 4/);
    assert.match(lines.join('\n'), /unlabelled: 1/);
  });
});

test('label prints labelled <id>; an id not in the shadow log also gets a warning, and is still saved', async () => {
  await withSandbox(async ({ env, cwd, home }) => {
    assert.equal(await new Cli(() => {}, { ask, env, cwd }).run(['decide', 'fix', 'it']), 0);
    const { rows } = await ShadowLog.readJsonl<{ id: string }>(join(home, 'shadow.jsonl'));
    const lines: string[] = [];
    const cli = new Cli(l => lines.push(l), { env, cwd });
    assert.equal(await cli.run(['label', rows[0].id, '--mode', 'solo', '--skills', '']), 0);
    assert.deepEqual(lines, [`labelled ${rows[0].id}`]);
    lines.length = 0;
    assert.equal(await cli.run(['label', 'nope', '--mode', 'team', '--skills', 'a']), 0);
    assert.deepEqual(lines, ['labelled nope', 'warning: nope is not in the shadow log']);
    const labels = await readFile(join(home, 'labels.jsonl'), 'utf8');
    assert.match(labels, /"id":"nope"/);
  });
});
