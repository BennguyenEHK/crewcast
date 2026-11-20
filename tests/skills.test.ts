import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SkillCatalog } from '../src/catalog/skills.js';

const FIX = fileURLToPath(new URL('./fixtures/skills', import.meta.url));
const catalog = new SkillCatalog();

test('parses CRLF frontmatter', () =>
  assert.deepEqual(
    SkillCatalog.parseFrontmatter('---\r\nname: a\r\ndescription: b\r\n---\r\n\r\nbody'),
    { name: 'a', description: 'b' },
  ));

test('parses folded description block', () =>
  assert.equal(
    SkillCatalog.parseFrontmatter('---\nname: x\ndescription: >\n  line one\n  line two\n---')?.description,
    'line one line two',
  ));

test('strips quotes', () =>
  assert.deepEqual(
    SkillCatalog.parseFrontmatter(`---\nname: 'a'\ndescription: "b c"\n---`),
    { name: 'a', description: 'b c' },
  ));

test('no frontmatter gives null', () =>
  assert.equal(SkillCatalog.parseFrontmatter('# no block\n---\nname: a\n---'), null));

test('missing dir is ignored', async () =>
  assert.deepEqual(await catalog.load([{ dir: join(FIX, 'nope') }]), []));

test('skill without frontmatter is skipped', async () => {
  const names = (await catalog.load([{ dir: join(FIX, 'user') }])).map(s => s.name);
  assert.ok(!names.includes('no-frontmatter'));
  assert.ok(names.includes('folded-skill'));
});

test('plugin skill gets plugin: prefix', async () => {
  const [s] = await catalog.load([{ dir: join(FIX, 'plugin', 'skills'), prefix: 'superpowers' }]);
  assert.equal(s.name, 'superpowers:brainstorming');
});

test('defaultDirs: only enabled plugins at installPath; missing json gives no plugin dirs', async () => {
  const home = await mkdtemp(join(tmpdir(), 'cc-home-'));
  try {
    const userDirs = [{ dir: join('/proj', '.claude', 'skills') }, { dir: join(home, '.claude', 'skills') }];
    assert.deepEqual(await SkillCatalog.defaultDirs(home, '/proj'), userDirs);

    await mkdir(join(home, '.claude', 'plugins'), { recursive: true });
    await writeFile(join(home, '.claude', 'plugins', 'installed_plugins.json'), JSON.stringify({ plugins: {
      'superpowers@official': [{ installPath: join(FIX, 'plugin'), version: '1' }],
      'off@official': [{ installPath: join(FIX, 'plugin'), version: '1' }],
    } }));
    await writeFile(join(home, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: {
      'superpowers@official': true,
      'off@official': false,
    } }));
    assert.deepEqual(await SkillCatalog.defaultDirs(home, '/proj'), [
      ...userDirs,
      { dir: join(FIX, 'plugin', 'skills'), prefix: 'superpowers' },
    ]);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('linked skill folder is followed', async t => {
  const tmp = await mkdtemp(join(tmpdir(), 'cc-link-'));
  try {
    await mkdir(join(tmp, 'skills'));
    try {
      await symlink(join(FIX, 'user', 'folded-skill'), join(tmp, 'skills', 'folded-link'), 'junction');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EPERM') return t.skip('cannot create junction (EPERM)');
      throw err;
    }
    const skills = await catalog.load([{ dir: join(tmp, 'skills') }]);
    assert.deepEqual(skills.map(s => s.name), ['folded-skill']);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('same skill name in two dirs counts once; first dir wins', async () => {
  const skills = await catalog.load([{ dir: join(FIX, 'user') }, { dir: join(FIX, 'shadow') }]);
  const hits = skills.filter(s => s.name === 'security-review');
  assert.equal(hits.length, 1);
  assert.match(hits[0].description, /^Review pending/);
});

test('shortlist ranks by overlap and drops zero', async () => {
  const skills = await catalog.load([
    { dir: join(FIX, 'user') },
    { dir: join(FIX, 'plugin', 'skills'), prefix: 'superpowers' },
  ]);
  const top = catalog.shortlist('review security of auth code', skills);
  assert.equal(top[0].name, 'security-review');
  assert.ok(!top.some(s => s.name === 'superpowers:brainstorming'));
  assert.ok(!top.some(s => s.name === 'folded-skill'));
});
