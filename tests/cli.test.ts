import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Cli } from '../src/cli.js';

test('--version prints package version', async () => {
  const lines: string[] = [];
  assert.equal(await new Cli(l => lines.push(l)).run(['--version']), 0);
  assert.equal(lines[0], '0.0.0');
});

test('unknown command prints usage and returns 1', async () => {
  const lines: string[] = [];
  assert.equal(await new Cli(l => lines.push(l)).run(['nope']), 1);
  assert.match(lines.join('\n'), /usage: crewcast/);
});
