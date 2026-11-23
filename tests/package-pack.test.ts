import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

// `crewcast setup` copies the crewcast skill from the installed package (cli.ts resolves <pkg>/skills/crewcast).
// If `skills/` isn't shipped in the tarball, setup crashes mid-install after npm i. Pin it to the real packed file list.
test('the published tarball ships the crewcast skill', async () => {
  const { stdout } = await execFileP('npm', ['pack', '--dry-run', '--json'], { cwd: process.cwd(), shell: true });
  const files = (JSON.parse(stdout) as { files: { path: string }[] }[])[0].files.map(f => f.path.replace(/\\/g, '/'));
  assert.ok(files.includes('skills/crewcast/SKILL.md'), `skill not in tarball; got: ${files.join(', ')}`);
});
