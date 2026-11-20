import { open, readdir, readFile, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { createInterface } from 'node:readline';

export interface Skill { name: string; description: string; path: string }
export interface SkillDir { dir: string; prefix?: string }

const STOP = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'you', 'your', 'are', 'not', 'but', 'use', 'how', 'what', 'when', 'can', 'all', 'any', 'about', 'have', 'will', 'should', 'make', 'need', 'want', 'please', 'some', 'out', 'its', 'our']);

export class SkillCatalog {
  static parseFrontmatter(text: string): { name?: string; description?: string } | null {
    const m = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
    if (!m) return null;
    const out: Record<string, string> = {};
    const lines = m[1].split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const kv = /^([\w-]+):\s*(.*)$/.exec(lines[i]);
      if (!kv) continue;
      let value = kv[2].trim();
      if (/^[>|][-+]?$/.test(value)) {
        const parts: string[] = [];
        while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) parts.push(lines[++i].trim());
        value = parts.join(' ');
      } else {
        value = value.replace(/^(['"])(.*)\1$/, '$2');
      }
      out[kv[1]] = value;
    }
    return { name: out.name, description: out.description };
  }

  static async defaultDirs(home: string, cwd: string): Promise<SkillDir[]> {
    const dirs: SkillDir[] = [{ dir: join(cwd, '.claude', 'skills') }, { dir: join(home, '.claude', 'skills') }];
    const installed = await SkillCatalog.readJson(join(home, '.claude', 'plugins', 'installed_plugins.json'));
    const settings = await SkillCatalog.readJson(join(home, '.claude', 'settings.json'));
    for (const [key, entries] of Object.entries(installed?.plugins ?? {})) {
      if (settings?.enabledPlugins?.[key] !== true || !Array.isArray(entries)) continue;
      for (const entry of entries) {
        if (typeof entry?.installPath === 'string') dirs.push({ dir: join(entry.installPath, 'skills'), prefix: key.split('@')[0] });
      }
    }
    return dirs;
  }

  // shortcut: re-reads all skill frontmatter per decide (~0.2–0.5 s measured), add an mtime-stamped index if Task 8 p95 misses 1.5 s.
  async load(dirs: SkillDir[]): Promise<Skill[]> {
    const found = (await Promise.all(dirs.map(d => SkillCatalog.loadDir(d)))).flat();
    const seen = new Set<string>();
    const out: Skill[] = [];
    for (const skill of found) {
      if (seen.has(skill.name)) continue;
      seen.add(skill.name);
      out.push(skill);
    }
    return out;
  }

  // shortcut: word overlap misses synonyms; upgrade to embeddings if eval shows skill recall is the failing metric.
  shortlist(task: string, skills: Skill[], k = 20): Skill[] {
    const want = [...SkillCatalog.words(task)].filter(w => !STOP.has(w));
    return skills
      .map(s => {
        const have = SkillCatalog.words(`${s.name} ${s.description}`);
        return { s, score: want.filter(w => have.has(w)).length };
      })
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score || a.s.name.localeCompare(b.s.name))
      .slice(0, k)
      .map(x => x.s);
  }

  private static words(text: string): Set<string> {
    return new Set(text.toLowerCase().match(/[a-z]{3,}/g) ?? []);
  }

  private static absent(err: unknown): boolean {
    return (err as NodeJS.ErrnoException).code === 'ENOENT';
  }

  private static async readJson(file: string): Promise<any> {
    try {
      return JSON.parse(await readFile(file, 'utf8'));
    } catch {
      return null;
    }
  }

  private static async loadDir({ dir, prefix }: SkillDir): Promise<Skill[]> {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch (err) {
      if (SkillCatalog.absent(err)) return [];
      throw err;
    }
    const skills = await Promise.all(entries.map(entry => SkillCatalog.loadOne(join(dir, entry), prefix)));
    return skills.filter((s): s is Skill => s !== null);
  }

  private static async loadOne(folder: string, prefix?: string): Promise<Skill | null> {
    const file = join(folder, 'SKILL.md');
    try {
      // stat (not lstat) follows linked skill folders
      if (!(await stat(folder)).isDirectory()) return null;
      const fm = SkillCatalog.parseFrontmatter(await SkillCatalog.head(file));
      if (!fm) return null;
      const name = fm.name ?? basename(folder);
      return { name: prefix ? `${prefix}:${name}` : name, description: fm.description ?? '', path: file };
    } catch (err) {
      if (SkillCatalog.absent(err)) return null;
      throw err;
    }
  }

  // Reads lines only up to the closing --- of the frontmatter, not the whole file.
  private static async head(file: string): Promise<string> {
    const fh = await open(file, 'r');
    const input = fh.createReadStream();
    const rl = createInterface({ input, crlfDelay: Infinity });
    const lines: string[] = [];
    try {
      for await (const line of rl) {
        lines.push(line);
        if (lines.length === 1 ? line !== '---' : line === '---') break;
      }
    } finally {
      input.destroy();
    }
    return lines.join('\n');
  }
}
