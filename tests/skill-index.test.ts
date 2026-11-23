import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SkillIndex } from '../src/catalog/skill-index.js';
import type { Skill } from '../src/catalog/skills.js';

// Fake /api/embed: records each call's inputs; a skill/task containing "deploy" is near [1,0], else near [0,1].
function fakeFetch() {
  const calls: string[][] = [];
  const fetchFn = (async (_url: string, init?: { body?: string }) => {
    const input = (JSON.parse(init!.body!) as { input: string[] }).input;
    calls.push(input);
    const embeddings = input.map(s => (s.includes('deploy') ? [1, 0] : [0, 1]));
    return { ok: true, json: async () => ({ embeddings }) } as unknown as Response;
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}

async function withSkills(fn: (ctx: { home: string; skills: Skill[]; touch: (name: string) => Promise<void> }) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'cc-index-'));
  try {
    const make = async (name: string, description: string): Promise<Skill> => {
      const folder = join(root, 'skills', name);
      await mkdir(folder, { recursive: true });
      const path = join(folder, 'SKILL.md');
      await writeFile(path, `---\nname: ${name}\ndescription: ${description}\n---\n`, 'utf8');
      return { name, description, path };
    };
    const skills = [await make('deployer', 'deploy the service'), await make('gardener', 'water the plants')];
    const touch = async (name: string) => {
      const t = new Date(Date.now() + 60_000);
      await utimes(join(root, 'skills', name, 'SKILL.md'), t, t);
    };
    await fn({ home: join(root, 'home'), skills, touch });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('top ranks by cosine similarity to the task', async () => {
  await withSkills(async ({ home, skills }) => {
    const { fetchFn } = fakeFetch();
    const picked = await new SkillIndex({ baseUrl: 'http://x', home, fetchFn }).top('deploy the app', skills, 2);
    assert.deepEqual(picked.map(s => s.name), ['deployer', 'gardener']);
  });
});

test('unchanged skills are not re-embedded: the second call embeds only the task', async () => {
  await withSkills(async ({ home, skills }) => {
    const { fetchFn, calls } = fakeFetch();
    const index = new SkillIndex({ baseUrl: 'http://x', home, fetchFn });
    await index.top('deploy the app', skills);
    calls.length = 0; // forget the first call's requests
    await index.top('deploy the app', skills);
    assert.equal(calls.length, 1); // only the task is embedded, no skill texts
    assert.equal(calls[0].length, 1);
    assert.match(calls[0][0], /deploy the app$/); // the task, carrying the query prefix
  });
});

test('a changed mtime re-embeds just that skill', async () => {
  await withSkills(async ({ home, skills, touch }) => {
    const { fetchFn, calls } = fakeFetch();
    const index = new SkillIndex({ baseUrl: 'http://x', home, fetchFn });
    await index.top('deploy the app', skills);
    await touch('gardener');
    calls.length = 0;
    await index.top('deploy the app', skills);
    assert.deepEqual(calls[0], ['gardener: water the plants']); // only the changed skill re-embedded
    assert.match(calls[1][0], /deploy the app$/); // then the task (with query prefix)
    assert.equal(calls.length, 2);
  });
});

test('the embed text includes the SKILL.md body, not just name + description', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cc-index-body-'));
  try {
    const folder = join(root, 'skills', 'ui-skill');
    await mkdir(folder, { recursive: true });
    const path = join(folder, 'SKILL.md');
    await writeFile(path, '---\nname: ui-skill\ndescription: short\n---\n\n# Overview\nUse this for SCROLLBAR and TERMINAL PANEL layout work.\n', 'utf8');
    const skill: Skill = { name: 'ui-skill', description: 'short', path };
    const { fetchFn, calls } = fakeFetch();
    await new SkillIndex({ baseUrl: 'http://x', home: join(root, 'home'), fetchFn }).top('design a panel', [skill]);
    const embedded = calls.flat().join('\n');
    assert.match(embedded, /ui-skill: short/);               // still carries name + description
    assert.match(embedded, /SCROLLBAR and TERMINAL PANEL/);  // and now the body text too
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('an embed error falls back to the keyword shortlist and never throws', async () => {
  await withSkills(async ({ home, skills }) => {
    const fetchFn = (async () => { throw new Error('ollama down'); }) as unknown as typeof fetch;
    const picked = await new SkillIndex({ baseUrl: 'http://x', home, fetchFn }).top('deploy the service', skills);
    assert.deepEqual(picked.map(s => s.name), ['deployer']); // keyword overlap on "deploy"/"service"
  });
});
