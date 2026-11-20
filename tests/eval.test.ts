import { mkdir, mkdtemp, readFile, rm, writeFile, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Cli } from '../src/cli.js';
import { Evaluator } from '../src/eval.js';
import type { SystemOneRequest, SystemOneResponse } from '../src/backend/systemone.js';

const ANSWERS: SystemOneResponse['answers'] = {
  task_type: { type: 'choice', choice: 'fix', probabilities: { fix: 0.9 }, confidence: 0.9 },
  writes_files: { type: 'noul', noul: 0.95 },
  risk_area: { type: 'choice', choice: 'none', probabilities: { none: 0.9 }, confidence: 0.9 },
  size: { type: 'choice', choice: 'one_file', probabilities: { one_file: 0.9 }, confidence: 0.9 },
  needs_web: { type: 'noul', noul: 0.05 },
};
const ask = async (r: SystemOneRequest) => ({ model: r.model, answers: ANSWERS });
const tasksFixture = join('tests', 'fixtures', 'eval', 'tasks.jsonl');
const transcriptsDir = join('tests', 'fixtures', 'transcripts');

async function withTemp(fn: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'cc-eval-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// Copies the transcript fixtures into <root>/projects/<project>/ with staggered mtimes, so newest-first is deterministic.
async function seedProjects(root: string): Promise<string> {
  const projects = join(root, 'projects', 'D--dev-demo');
  await mkdir(projects, { recursive: true });
  for (const [i, name] of ['solo.jsonl', 'team.jsonl', 'webfetch-only.jsonl'].entries()) {
    const file = join(projects, name);
    await writeFile(file, await readFile(join(transcriptsDir, name), 'utf8'), 'utf8');
    const t = new Date(Date.UTC(2026, 10, 1 + i));
    await utimes(file, t, t);
  }
  return join(root, 'projects');
}

test('run on 3 synthetic tasks with fake ask → Report with n 3', async () => {
  const report = await new Evaluator({ cwd: tmpdir() }).run(tasksFixture, { ask, skills: [], model: 'nimble' });
  assert.equal(report.n, 3);
  assert.equal(report.skipped, 0);
});

test('draft writes one row per transcript, newest first, with id = base name', async () => {
  await withTemp(async dir => {
    const projects = await seedProjects(dir);
    const out = join(dir, 'eval', 'tasks.jsonl');
    const { written } = await new Evaluator({ cwd: dir }).draft(projects, out);
    assert.equal(written, 3);
    const rows = (await readFile(out, 'utf8')).trim().split('\n').map(l => JSON.parse(l));
    assert.deepEqual(rows.map(r => r.id), ['webfetch-only', 'team', 'solo']);
    assert.equal(rows[2].task, 'Fix the login redirect bug');
    assert.deepEqual(rows[2].actual, { mode: 'solo', skills: ['systematic-debugging', 'test-driven-development'], engines: ['claude'] });
  });
});

test('draft refuses an outFile inside the cwd git repo', async () => {
  await withTemp(async dir => {
    execFileSync('git', ['init', '-q'], { cwd: dir });
    const projects = await seedProjects(dir);
    const out = join(dir, 'tasks.jsonl');
    await assert.rejects(new Evaluator({ cwd: dir }).draft(projects, out), /inside the git repo/);
    await assert.rejects(readFile(out, 'utf8'), { code: 'ENOENT' });
  });
});

test('eval CLI: 3 identical fake answers miss the thresholds → exit 3 and FAIL last', async () => {
  await withTemp(async dir => {
    const env = { USERPROFILE: join(dir, 'user'), CREWCAST_HOME: join(dir, 'crewcast') };
    const lines: string[] = [];
    const code = await new Cli(l => lines.push(l), { ask, env, cwd: dir }).run(['eval', tasksFixture]);
    assert.equal(code, 3);
    assert.match(lines.join('\n'), /labelled: 3/);
    assert.equal(lines.at(-1), 'FAIL');
  });
});

test('eval draft CLI prints the exact draft message', async () => {
  await withTemp(async dir => {
    const projects = await seedProjects(dir);
    const out = join(dir, 'tasks.jsonl');
    const env = { USERPROFILE: join(dir, 'user'), CREWCAST_HOME: join(dir, 'crewcast') };
    const lines: string[] = [];
    const code = await new Cli(l => lines.push(l), { env, cwd: dir }).run(['eval', 'draft', '--projects', projects, '--out', out]);
    assert.equal(code, 0);
    assert.deepEqual(lines, [`Drafted 3 tasks → ${out}. Open it and correct \`actual\` (mode, skills) for each line; delete lines that are not real tasks.`]);
  });
});

test('eval CLI: missing tasks file → one-line error and exit 1', async () => {
  await withTemp(async dir => {
    const env = { USERPROFILE: join(dir, 'user'), CREWCAST_HOME: join(dir, 'crewcast') };
    const lines: string[] = [];
    const code = await new Cli(l => lines.push(l), { ask, env, cwd: dir }).run(['eval', join(dir, 'nope.jsonl')]);
    assert.equal(code, 1);
    assert.equal(lines.length, 1);
  });
});
