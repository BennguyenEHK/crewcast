import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Agreement } from '../src/agreement.js';
import type { DecisionRecord } from '../src/decide/record.js';

function rec(over: { mode?: DecisionRecord['mode']; skills?: string[]; ms?: number; uncertain?: boolean } = {}): DecisionRecord {
  const sig = (value: any, uncertain?: true) => ({ value, p: 0.9, ...(uncertain ? { uncertain } : {}) });
  return {
    version: 1,
    id: 'r',
    task: 't',
    mode: over.mode ?? 'solo',
    shadow: true,
    signals: {
      task_type: sig('fix'),
      writes_files: sig(true),
      risk_area: sig('none'),
      size: sig('one_file', over.uncertain ? true : undefined),
      needs_web: sig(false),
    },
    skills_uncertain: [],
    branch: { action: 'keep' },
    agents: [{ role: 'lead', engine: 'claude', model: 'm', effort: null, skills: over.skills ?? [], mcps: [] }],
    ms: over.ms ?? 100,
    backend: 'm@ollama',
  };
}

const LEAD = ['a', 'b', 'c', 'd', 'e'];
const agrees = (picked: string[], actual: string[]) =>
  new Agreement().agrees(rec({ skills: picked }), { mode: 'solo', skills: actual }).skills;

test('skills agree with 2 extras, disagree with 3 extras or a missing one', () => {
  assert.equal(agrees(['a', 'b', 'c', 'd'], ['a', 'b']), true);   // 2 extras (c, d)
  assert.equal(agrees(['a', 'b', 'c', 'd', 'e'], ['a', 'b']), false); // 3 extras
  assert.equal(agrees(['a', 'b'], ['a', 'c']), false);            // c missing from the lead
  assert.equal(agrees(LEAD, LEAD), true);
});

test('uncertain mode counts as disagreement', () => {
  const r = rec({ mode: 'uncertain' });
  assert.equal(new Agreement().agrees(r, { mode: 'solo', skills: [] }).mode, false);
  assert.equal(new Agreement().agrees(r, { mode: 'team', skills: [] }).mode, false);
});

test('report: 4 of 5 mode agree, 5 of 5 skills → mode 0.8, pass true', () => {
  const pairs = [0, 1, 2, 3, 4].map(i => ({
    rec: rec({ mode: i < 4 ? 'solo' : 'team', skills: ['a'] }),
    actual: { mode: 'solo' as const, skills: ['a'] },
  }));
  const r = new Agreement().report(pairs, 2);
  assert.equal(r.n, 5);
  assert.equal(r.mode, 0.8);
  assert.equal(r.skills, 1);
  assert.equal(r.pass, true);
  assert.equal(r.skipped, 2);
});

test('report counts uncertain signals per signal name', () => {
  const pairs = [rec({ uncertain: true }), rec({ uncertain: true }), rec()].map(r => ({ rec: r, actual: { mode: 'solo' as const, skills: [] } }));
  assert.deepEqual(new Agreement().report(pairs).uncertain, { size: 2 });
});

test('p95 nearest-rank on [100,200,300,400,1000] = 1000, p50 = 300', () => {
  const pairs = [100, 200, 300, 400, 1000].map(ms => ({ rec: rec({ ms }), actual: { mode: 'solo' as const, skills: [] } }));
  const r = new Agreement().report(pairs);
  assert.equal(r.p95ms, 1000);
  assert.equal(r.p50ms, 300);
});

test('report with no labelled pairs does not pass', () => {
  assert.equal(new Agreement().report([]).pass, false);
});
