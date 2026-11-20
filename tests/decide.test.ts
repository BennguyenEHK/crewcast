import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BackendError, type Answer, type SystemOneRequest, type SystemOneResponse } from '../src/backend/systemone.js';
import { Decider } from '../src/decide/decide.js';
import type { GitState } from '../src/decide/record.js';
import type { Skill } from '../src/catalog/skills.js';

const choice = (choiceValue: string, p: number, others: Record<string, number> = {}): Answer => ({
  type: 'choice',
  choice: choiceValue,
  probabilities: { [choiceValue]: p, ...others },
  confidence: p,
});
const noul = (value: number): Answer => ({ type: 'noul', noul: value });

// Defaults describe a clear, small docs task with no risk. Tests override what they need.
const baseAnswers = (over: Record<string, Answer> = {}): Record<string, Answer> => ({
  task_type: choice('docs', 0.9),
  writes_files: noul(0.95),
  risk_area: choice('none', 0.9),
  size: choice('one_file', 0.9),
  needs_web: noul(0.05),
  ...over,
});

// Fake ask: records each request and answers with the given answers.
const fakeAsk = (answers: Record<string, Answer>) => {
  const seen: SystemOneRequest[] = [];
  const ask = async (r: SystemOneRequest): Promise<SystemOneResponse> => {
    seen.push(r);
    return { model: 'systemone', answers };
  };
  return { ask, seen };
};

const skill = (name: string, description: string): Skill => ({ name, description, path: `/fake/${name}/SKILL.md` });
const repoOn = (branch: string, dirty: boolean): GitState => ({ isRepo: true, branch, defaultBranch: 'main', dirty });

test('one request per decision, with 5 signal questions + one per shortlisted skill', async () => {
  const { ask, seen } = fakeAsk(baseAnswers());
  const skills = [
    skill('login-helper', 'Debug login flows'),
    skill('unrelated', 'Gardening tips'),
    skill('bug-triage', 'Triage bug reports'),
  ];
  const rec = await new Decider({ ask, skills, git: null, model: 'systemone' }).decide('fix the login bug');

  assert.equal(seen.length, 1);
  assert.equal(seen[0].model, 'systemone');
  assert.equal(seen[0].state, 'fix the login bug');
  assert.equal(seen[0].keep_alive, '30m');
  // shortlist keeps the two skills that share a word with the task
  assert.deepEqual(
    Object.keys(seen[0].questions),
    ['task_type', 'writes_files', 'risk_area', 'size', 'needs_web', 'skill_0', 'skill_1'],
  );
  assert.equal(rec.mode, 'solo');
});

test('auth task: risk auth → mode team, review agent added, effort high when many_files', async () => {
  const { ask } = fakeAsk(baseAnswers({
    task_type: choice('fix', 0.9),
    risk_area: choice('auth', 0.9),
    size: choice('many_files', 0.9),
  }));
  const rec = await new Decider({ ask, skills: [], git: null, model: 'systemone' }).decide('fix the auth token refresh');

  assert.equal(rec.mode, 'team');
  assert.equal(rec.signals.risk_area.value, 'auth');
  assert.equal(rec.agents.length, 2);
  assert.deepEqual(rec.agents[0], { role: 'lead', engine: 'claude', model: 'default', effort: 'high', skills: [], mcps: [] });
  assert.deepEqual(rec.agents[1], { role: 'review', engine: 'copilot', model: 'gpt-5-mini', effort: null, skills: ['security-review'], mcps: [] });
});

test('small docs task: one_file, none → solo, single lead agent, effort null', async () => {
  const { ask } = fakeAsk(baseAnswers());
  const rec = await new Decider({ ask, skills: [], git: null, model: 'systemone' }).decide('document the config file');

  assert.equal(rec.mode, 'solo');
  assert.equal(rec.agents.length, 1);
  assert.equal(rec.agents[0].role, 'lead');
  assert.equal(rec.agents[0].effort, null);
});

test('size probability 0.5 → size uncertain → mode uncertain, value null', async () => {
  const { ask } = fakeAsk(baseAnswers({ size: choice('few_files', 0.5, { one_file: 0.5 }) }));
  const rec = await new Decider({ ask, skills: [], git: null, model: 'systemone' }).decide('document the config file');

  assert.equal(rec.mode, 'uncertain');
  assert.deepEqual(rec.signals.size, { value: null, p: 0.5, uncertain: true });
});

test('skill noul 0.9 picked, 0.5 → skills_uncertain, 0.1 → dropped', async () => {
  // all three match "deploy tool" equally, so the shortlist order is by name: alpha, beta, gamma
  const { ask } = fakeAsk(baseAnswers({
    skill_0: noul(0.9),
    skill_1: noul(0.5),
    skill_2: noul(0.1),
  }));
  const skills = [
    skill('alpha-skill', 'deploy tool'),
    skill('beta-skill', 'deploy tool'),
    skill('gamma-skill', 'deploy tool'),
  ];
  const rec = await new Decider({ ask, skills, git: null, model: 'systemone' }).decide('deploy the tool');

  assert.deepEqual(rec.agents[0].skills, ['alpha-skill']);
  assert.deepEqual(rec.skills_uncertain, ['beta-skill']);
});

test('branch new only on default branch + writes_files + (dirty or team); slug ≤ 40 chars', async () => {
  const decideWith = async (task: string, git: GitState | null, over: Record<string, Answer> = {}) => {
    const { ask } = fakeAsk(baseAnswers(over));
    return new Decider({ ask, skills: [], git, model: 'systemone' }).decide(task);
  };

  // on default, writes files, dirty → new branch from the first 4 task words
  assert.deepEqual(
    (await decideWith('Add the new login flow', repoOn('main', true))).branch,
    { action: 'new', name: 'feat/add-the-new-login' },
  );
  // team mode on a clean default branch also gets a new branch
  const team = await decideWith('Add the new login flow', repoOn('main', false), { risk_area: choice('auth', 0.9) });
  assert.equal(team.branch.action, 'new');
  // clean, solo → keep
  assert.deepEqual((await decideWith('Add the new login flow', repoOn('main', false))).branch, { action: 'keep' });
  // not on default branch → keep
  assert.deepEqual((await decideWith('Add the new login flow', repoOn('feat/x', true))).branch, { action: 'keep' });
  // writes no files → keep
  assert.deepEqual(
    (await decideWith('Add the new login flow', repoOn('main', true), { writes_files: noul(0.05) })).branch,
    { action: 'keep' },
  );
  // not a repo → keep
  assert.deepEqual((await decideWith('Add the new login flow', null)).branch, { action: 'keep' });
  // long words: name is capped at 40 chars and stays slugged
  const long = await decideWith('Implementation-of-extraordinarily-long-identifiers-everywhere now', repoOn('main', true));
  assert.equal(long.branch.action, 'new');
  assert.ok(long.branch.name!.length <= 40);
  assert.match(long.branch.name!, /^feat\/[a-z0-9-]+$/);
});

test('too_large backend error → all-uncertain record with error, no throw', async () => {
  const ask = async (): Promise<SystemOneResponse> => {
    throw new BackendError('too_large', 'request body over 64 KiB');
  };
  const rec = await new Decider({ ask, skills: [], git: null, model: 'systemone' }).decide('document the config file');

  assert.equal(rec.mode, 'uncertain');
  assert.equal(rec.error, 'request body over 64 KiB');
  assert.deepEqual(rec.agents, []);
  assert.deepEqual(rec.branch, { action: 'keep' });
  for (const s of Object.values(rec.signals)) assert.deepEqual(s, { value: null, p: 0, uncertain: true });
});

test('ollama_unreachable is re-thrown', async () => {
  const ask = async (): Promise<SystemOneResponse> => {
    throw new BackendError('ollama_unreachable', 'cannot reach http://localhost:11434');
  };
  await assert.rejects(
    new Decider({ ask, skills: [], git: null, model: 'systemone' }).decide('document the config file'),
    { code: 'ollama_unreachable' },
  );
});
