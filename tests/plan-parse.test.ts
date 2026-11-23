import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePlan } from '../src/plan.js';

test('parses ## unit blocks into id, files and depends', () => {
  const md = `# Some Plan

## Add the mailbox store
files: src/mailbox.ts, tests/mailbox.test.ts
depends: none

## Wire the tools
files: src/cli.ts
depends: Add the mailbox store
`;
  const units = parsePlan(md);
  assert.equal(units.length, 2);
  assert.deepEqual(units[0], { id: 'Add the mailbox store', description: 'Add the mailbox store', files: ['src/mailbox.ts', 'tests/mailbox.test.ts'], depends: [] });
  assert.deepEqual(units[1], { id: 'Wire the tools', description: 'Wire the tools', files: ['src/cli.ts'], depends: ['Add the mailbox store'] });
});

test('a unit with no files/depends lines gets empty arrays; ### is body, not a unit', () => {
  const units = parsePlan('## Research options\nsome prose\n### a subheading\nmore prose\n');
  assert.equal(units.length, 1);
  assert.deepEqual(units[0].files, []);
  assert.deepEqual(units[0].depends, []);
});

test('depends split on commas, trimmed', () => {
  const units = parsePlan('## C\ndepends: A , B\n');
  assert.deepEqual(units[0].depends, ['A', 'B']);
});

test('a duplicate unit id throws', () => {
  assert.throws(() => parsePlan('## X\nfiles: a\n\n## X\nfiles: b\n'));
});

test('no units → empty list', () => {
  assert.deepEqual(parsePlan('# title only\njust prose\n'), []);
});
