import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SkillCatalog, type Skill } from './skills.js';

// Embedding shortlist: ranks skills by cosine similarity to the task, caching vectors so unchanged skills are embedded once.
export class SkillIndex {
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly home: string;
  private readonly fetchFn: typeof fetch;
  // mxbai-embed-large wants this on the query only; skills (documents) stay unprefixed. Override if the model changes.
  private readonly queryPrefix: string;

  constructor(opts: { baseUrl: string; model?: string; home: string; fetchFn?: typeof fetch; queryPrefix?: string }) {
    this.baseUrl = opts.baseUrl;
    this.model = opts.model ?? 'mxbai-embed-large';
    this.home = opts.home;
    this.fetchFn = opts.fetchFn ?? fetch;
    this.queryPrefix = opts.queryPrefix ?? 'Represent this sentence for searching relevant passages: ';
  }

  // On any embed failure (model not pulled, Ollama down, bad response) falls back to the keyword shortlist. Never throws.
  async top(task: string, skills: Skill[], k = 8): Promise<Skill[]> {
    if (skills.length === 0) return [];
    try {
      const cacheFile = join(this.home, 'skill-index.json');
      const cache = await SkillIndex.readCache(cacheFile);
      const keys = await Promise.all(skills.map(async s => `${s.path}:${(await stat(s.path)).mtimeMs}:${this.model}`));
      const next: Record<string, number[]> = {};
      for (let i = 0; i < skills.length; i++) if (keys[i] in cache) next[keys[i]] = cache[keys[i]];
      const missing = skills.map((_, i) => i).filter(i => !(keys[i] in next));
      if (missing.length) {
        const vecs = await this.embed(missing.map(i => `${skills[i].name}: ${skills[i].description}`));
        missing.forEach((i, j) => { next[keys[i]] = vecs[j]; });
      }
      const [taskVec] = await this.embed([this.queryPrefix + task]);
      // The cache holds only current skills' keys, so stale entries are pruned on write. A write failure keeps the result.
      await mkdir(this.home, { recursive: true }).catch(() => {});
      await writeFile(cacheFile, JSON.stringify(next)).catch(() => {});
      return skills
        .map((s, i) => ({ s, score: SkillIndex.cosine(taskVec, next[keys[i]]) }))
        .sort((a, b) => b.score - a.score || a.s.name.localeCompare(b.s.name))
        .slice(0, k)
        .map(x => x.s);
    } catch {
      return new SkillCatalog().shortlist(task, skills, k);
    }
  }

  private async embed(inputs: string[]): Promise<number[][]> {
    const res = await this.fetchFn(`${this.baseUrl}/api/embed`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: this.model, input: inputs }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`embed HTTP ${res.status}`);
    const body = (await res.json()) as { embeddings?: unknown };
    if (!Array.isArray(body.embeddings) || body.embeddings.length !== inputs.length) throw new Error('bad embed response');
    return body.embeddings as number[][];
  }

  private static cosine(a: number[], b: number[]): number {
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
    return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
  }

  private static async readCache(file: string): Promise<Record<string, number[]>> {
    try {
      const o = JSON.parse(await readFile(file, 'utf8'));
      return o && typeof o === 'object' ? o : {};
    } catch {
      return {};
    }
  }
}
