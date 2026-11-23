import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Cli } from '../src/cli.js';

test('crewcast update runs git pull, then npm build', async () => {
  const calls: string[][] = [];
  const run = async (bin: string, args: string[]) => { calls.push([bin, ...args]); return ''; };
  const code = await new Cli(() => {}, { run }).run(['update']);
  assert.equal(code, 0);
  const gitPull = calls.findIndex(c => c[0] === 'git' && c.includes('pull'));
  const npmBuild = calls.findIndex(c => c[0] === 'npm' && c.includes('build'));
  assert.ok(gitPull >= 0, `git pull called: ${JSON.stringify(calls)}`);
  assert.ok(npmBuild > gitPull, `npm build ran after git pull: ${JSON.stringify(calls)}`);
});

test('a failing git pull exits non-zero with a message (not a crash)', async () => {
  const run = async (bin: string) => { if (bin === 'git') throw new Error('local changes would be overwritten'); return ''; };
  const lines: string[] = [];
  const code = await new Cli(l => lines.push(l), { run }).run(['update']);
  assert.notEqual(code, 0);
  assert.ok(lines.some(l => /local changes|error/i.test(l)), lines.join('\n'));
});
