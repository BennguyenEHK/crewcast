import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveLauncher } from '../src/dispatch/launcher.js';

test('an npm .cmd/.ps1 shim resolves to node <cli.js> (so shell:false can launch it)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cc-launch-'));
  try {
    await mkdir(join(dir, 'node_modules', 'pkg', 'bin'), { recursive: true });
    await writeFile(join(dir, 'node_modules', 'pkg', 'bin', 'foo.js'), '// cli\n', 'utf8');
    await writeFile(join(dir, 'foo.cmd'), '@node "%~dp0\\node_modules\\pkg\\bin\\foo.js" %*\n', 'utf8');
    const { cmd, prefixArgs } = await resolveLauncher('foo', { path: dir, pathext: '.CMD' });
    assert.equal(cmd, process.execPath); // node
    assert.equal(prefixArgs.length, 1);
    assert.ok(prefixArgs[0].replace(/\\/g, '/').endsWith('node_modules/pkg/bin/foo.js'), prefixArgs[0]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a real .exe is launched directly (no node wrapper)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cc-launch2-'));
  try {
    await writeFile(join(dir, 'bar.exe'), 'MZ', 'utf8'); // stand-in binary
    const { cmd, prefixArgs } = await resolveLauncher('bar', { path: dir, pathext: '.EXE' });
    assert.ok(cmd.replace(/\\/g, '/').endsWith('/bar.exe'));
    assert.deepEqual(prefixArgs, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('an unresolved command falls back to the bare name (spawn then fails → recorded worker)', async () => {
  const { cmd, prefixArgs } = await resolveLauncher('nope-xyz', { path: join(tmpdir(), 'empty-xyz'), pathext: '.EXE' });
  assert.equal(cmd, 'nope-xyz');
  assert.deepEqual(prefixArgs, []);
});
