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
  private readonly timeoutMs: number;

  constructor(opts: { baseUrl: string; model?: string; home: string; fetchFn?: typeof fetch; queryPrefix?: string; timeoutMs?: number }) {
    this.baseUrl = opts.baseUrl;
    this.model = opts.model ?? 'mxbai-embed-large';
    this.home = opts.home;
    this.fetchFn = opts.fetchFn ?? fetch;
    this.queryPrefix = opts.queryPrefix ?? 'Represent this sentence for searching relevant passages: ';
    this.timeoutMs = opts.timeoutMs ?? 30_000; // the hook passes a short budget so a cold embed can't stall the prompt
  }

  // On any embed failure (model not pulled, Ollama down, bad response) falls back to the keyword shortlist. Never throws.
  async top(task: string, skills: Skill[], k = 8): Promise<Skill[]> {
    if (skills.length === 0) return [];
    try {
      const { keys, vecs } = await this.vectors(skills);
      const [taskVec] = await this.embed([this.queryPrefix + task]);
      return skills
        .map((s, i) => ({ s, score: SkillIndex.cosine(taskVec, vecs[keys[i]]) }))
        .sort((a, b) => b.score - a.score || a.s.name.localeCompare(b.s.name))
        .slice(0, k)
        .map(x => x.s);
    } catch {
      return new SkillCatalog().shortlist(task, skills, k);
    }
  }

  // Pre-embed the whole catalog so the cache is warm — the 2 s hook can't afford a cold full-catalog embed and
  // can't warm itself within budget, so `crewcast setup`/`update` call this once (unbounded). Best-effort, never throws.
  async warm(skills: Skill[]): Promise<void> {
    if (skills.length === 0) return;
    try { await this.vectors(skills); } catch { /* the hook still falls back to keyword ranking until a later run warms it */ }
  }

  // Cached embedding per skill; embeds (and caches) any whose doc changed. Keyed by path:mtime:model:DOC_VERSION so an
  // older embed-text recipe (e.g. name+description only) is recomputed once. The cache holds only current keys → stale pruned.
  private async vectors(skills: Skill[]): Promise<{ keys: string[]; vecs: Record<string, number[]> }> {
    const cacheFile = join(this.home, 'skill-index.json');
    const cache = await SkillIndex.readCache(cacheFile);
    const keys = await Promise.all(skills.map(async s => `${s.path}:${(await stat(s.path)).mtimeMs}:${this.model}:d${SkillIndex.DOC_VERSION}`));
    const vecs: Record<string, number[]> = {};
    for (let i = 0; i < skills.length; i++) if (keys[i] in cache) vecs[keys[i]] = cache[keys[i]];
    const missing = skills.map((_, i) => i).filter(i => !(keys[i] in vecs));
    if (missing.length) {
      const embedded = await this.embed(await Promise.all(missing.map(i => this.doc(skills[i]))));
      missing.forEach((i, j) => { vecs[keys[i]] = embedded[j]; });
      await mkdir(this.home, { recursive: true }).catch(() => {});
      await writeFile(cacheFile, JSON.stringify(vecs)).catch(() => {}); // persist so a later cold call reuses what embedded here
    }
    return { keys, vecs };
  }

  private static readonly DOC_VERSION = 2; // bump when the doc() recipe changes, to recompute cached vectors
  private static readonly BODY_CAP = 1500; // chars of body to embed — well inside mxbai's ~512-token window, more signal than the one-line description

  // The text embedded for a skill: name + description + an excerpt of the SKILL.md body (the real ranking signal —
  // "when to use", triggers, substance). Falls back to name + description if the body can't be read.
  private async doc(s: Skill): Promise<string> {
    let body = '';
    try {
      const raw = (await readFile(s.path, 'utf8')).replace(/^﻿/, '');
      body = raw.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '').replace(/\s+/g, ' ').trim().slice(0, SkillIndex.BODY_CAP);
    } catch { /* unreadable body: rank on name + description alone */ }
    return body ? `${s.name}: ${s.description}\n\n${body}` : `${s.name}: ${s.description}`;
  }

  private async embed(inputs: string[]): Promise<number[][]> {
    const res = await this.fetchFn(`${this.baseUrl}/api/embed`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: this.model, input: inputs }),
      signal: AbortSignal.timeout(this.timeoutMs),
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
