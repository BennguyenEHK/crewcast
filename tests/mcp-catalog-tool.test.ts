import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CatalogTool } from '../src/mcp/catalog-tool.js';
import type { Skill } from '../src/catalog/skills.js';

const skills: Skill[] = [
  { name: 'ponytail:ponytail', description: 'lazy senior dev', path: '/x/a/SKILL.md' },
  { name: 'neon:neon', description: 'postgres backend', path: '/x/b/SKILL.md' },
];

test('catalog tool lists the injected skills name and description', async () => {
  const res = await new CatalogTool({ skills }).call({});
  assert.ok(!res.isError);
  const list = JSON.parse(res.content[0].text);
  assert.deepEqual(list, [
    { name: 'ponytail:ponytail', description: 'lazy senior dev' },
    { name: 'neon:neon', description: 'postgres backend' },
  ]);
});
