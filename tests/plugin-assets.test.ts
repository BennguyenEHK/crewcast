import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SkillCatalog } from '../src/catalog/skills.js';

test('plugin.json is valid JSON with a name and version', async () => {
  const m = JSON.parse(await readFile('.claude-plugin/plugin.json', 'utf8'));
  assert.equal(typeof m.name, 'string');
  assert.ok(m.name.length > 0);
  assert.equal(typeof m.version, 'string');
});

test('the crewcast SKILL.md frontmatter parses with name crewcast and a non-empty description', async () => {
  const fm = SkillCatalog.parseFrontmatter(await readFile('skills/crewcast/SKILL.md', 'utf8'));
  assert.ok(fm);
  assert.equal(fm.name, 'crewcast');
  assert.ok((fm.description ?? '').length > 0);
});
