import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PlanAllocator } from '../src/decide/allocate.js';
import type { WorkUnit } from '../src/plan.js';
import type { Engine } from '../src/engines/catalog.js';

const engine = (id: string, installed: boolean): Engine => ({
  id, bin: id, versionArgs: ['--version'], installed, headless: [], models: [`${id}-base`], strongModel: `${id}-strong`,
  modelFlag: '--model', effortArgs: ['--effort', '{effort}'], highEffort: 'high', parallelLimit: 2,
  writeFlags: ['--write'], readFlags: ['--read'], safeFlags: ['--safe'], autoMode: false,
} as Engine);

const ENGINES = [engine('claude', true), engine('codex', true), engine('gemini', true)];
const pickSkills = async (_text: string) => ['skill-a'];
const mk = () => new PlanAllocator({ engines: ENGINES, leadEngine: 'claude', pickSkills });

test('groups by dependency: two independent units are group 0, a dependent is group 1', async () => {
  const units: WorkUnit[] = [
    { id: 'A', description: 'A', files: ['a.ts'], depends: [] },
    { id: 'B', description: 'B', files: ['b.ts'], depends: [] },
    { id: 'C', description: 'C', files: ['c.ts'], depends: ['A', 'B'] },
  ];
  const { units: out } = await mk().allocate(units);
  assert.deepEqual(out.map(u => u.group), [0, 0, 1]);
});

test('writes_files drives write vs read flags; skills come from the shortlister', async () => {
  const out = (await mk().allocate([
    { id: 'W', description: 'W', files: ['x.ts'], depends: [] },
    { id: 'R', description: 'research the options', files: [], depends: [] },
  ])).units;
  assert.ok(out[0].args.includes('--write'), out[0].args.join(' '));
  assert.ok(out[1].args.includes('--read'), out[1].args.join(' '));
  assert.deepEqual(out[0].skills, ['skill-a']);
});

test('a risky unit gets the strong model and high effort', async () => {
  const out = (await mk().allocate([{ id: 'U', description: 'update the auth login flow', files: ['auth.ts'], depends: [] }])).units;
  assert.match(out[0].model, /strong$/);
  assert.equal(out[0].effort, 'high');
  assert.ok(out[0].args.includes('high'));
});

test('workers are assigned round-robin, never the lead', async () => {
  const out = (await mk().allocate([
    { id: 'A', description: 'A', files: ['a'], depends: [] },
    { id: 'B', description: 'B', files: ['b'], depends: [] },
    { id: 'C', description: 'C', files: ['c'], depends: [] },
  ])).units;
  const used = out.map(u => u.engine);
  assert.ok(!used.includes('claude'), `lead must not be a worker: ${used.join(',')}`);
  assert.deepEqual(new Set(used), new Set(['codex', 'gemini']));
});

test('with only the lead installed, it falls back to the lead and flags it', async () => {
  const alloc = new PlanAllocator({ engines: [engine('claude', true), engine('codex', false)], leadEngine: 'claude', pickSkills });
  const out = (await alloc.allocate([{ id: 'A', description: 'A', files: ['a'], depends: [] }])).units;
  assert.equal(out[0].engine, 'claude');
  assert.equal(out[0].leadFallback, true);
});

test('ordinary words like "results table" and "tokenize" are not graded risky', async () => {
  const out = (await mk().allocate([
    { id: 'T', description: 'add a results table component', files: ['ui.ts'], depends: [] },
    { id: 'K', description: 'tokenize the input', files: ['lex.ts'], depends: [] },
  ])).units;
  assert.ok(out[0].model.endsWith('-base'), `results table graded risky: ${out[0].model}`);
  assert.equal(out[0].effort, null);
  assert.ok(out[1].model.endsWith('-base'), `tokenize graded risky: ${out[1].model}`);
});

test('an unknown dependency and a cycle both throw', async () => {
  await assert.rejects(mk().allocate([{ id: 'A', description: 'A', files: [], depends: ['ghost'] }]));
  await assert.rejects(mk().allocate([
    { id: 'A', description: 'A', files: [], depends: ['B'] },
    { id: 'B', description: 'B', files: [], depends: ['A'] },
  ]));
});
