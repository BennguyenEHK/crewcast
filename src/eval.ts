import { execFile } from 'node:child_process';
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import type { SystemOneRequest, SystemOneResponse } from './backend/systemone.js';
import type { Skill } from './catalog/skills.js';
import { Decider } from './decide/decide.js';
import { Agreement, type Report } from './agreement.js';
import { ShadowLog, type Actual } from './shadow.js';
import { TranscriptReader } from './transcript.js';

export interface EvalTask { id: string; task: string; actual: Actual }

const run = promisify(execFile);

export class Evaluator {
  constructor(private readonly deps: { cwd: string }) {}

  async draft(projectsDir: string, outFile: string, limit = 80, force = false): Promise<{ written: number }> {
    const out = resolve(outFile);
    const top = await this.repoRoot();
    if (top && Evaluator.isInside(top, out)) throw new Error(`refusing to write eval tasks inside the git repo at ${top}`);

    const rows: EvalTask[] = [];
    for (const file of await this.transcripts(projectsDir)) {
      if (rows.length >= limit) break;
      const s = await new TranscriptReader().summarize(file);
      if (s.firstPrompt === null) continue;
      rows.push({ id: basename(file, '.jsonl'), task: s.firstPrompt, actual: s.actual });
    }
    await mkdir(dirname(out), { recursive: true });
    // 'wx' refuses to replace a file the owner may have hand-labelled; --force opts in to overwrite.
    try {
      await writeFile(out, rows.map(r => `${JSON.stringify(r)}\n`).join(''), { encoding: 'utf8', flag: force ? 'w' : 'wx' });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(`${out} exists — pass --force to overwrite`);
      throw err;
    }
    return { written: rows.length };
  }

  async run(tasksFile: string, deps: { ask: (r: SystemOneRequest) => Promise<SystemOneResponse>; skills: Skill[]; model: string }): Promise<Report> {
    await stat(tasksFile); // readJsonl treats a missing file as empty; a typo should fail, not report FAIL on 0 tasks
    const parsed = await ShadowLog.readJsonl<unknown>(tasksFile);
    const tasks = parsed.rows.filter(Evaluator.isTask);
    // A valid JSON line of the wrong shape is skipped and counted, never sent to decide.
    const skipped = parsed.skipped + parsed.rows.length - tasks.length;
    const decider = new Decider({ ...deps, git: null, shadow: false });
    const pairs = [];
    // Sequential: Ollama has one slot.
    for (const t of tasks) pairs.push({ rec: await decider.decide(t.task), actual: t.actual });
    return new Agreement().report(pairs, skipped);
  }

  private static isTask(row: unknown): row is EvalTask {
    const r = row as Partial<EvalTask> | null;
    return typeof r?.task === 'string' && (r.actual?.mode === 'solo' || r.actual?.mode === 'team') && Array.isArray(r.actual.skills);
  }

  // Transcripts are <projectsDir>/<project>/<session>.jsonl, newest first.
  private async transcripts(projectsDir: string): Promise<string[]> {
    const found: { file: string; mtime: number }[] = [];
    for (const project of await readdir(projectsDir, { withFileTypes: true })) {
      if (!project.isDirectory()) continue;
      const dir = join(projectsDir, project.name);
      for (const name of await readdir(dir)) {
        if (!name.endsWith('.jsonl')) continue;
        const file = join(dir, name);
        found.push({ file, mtime: (await stat(file)).mtimeMs });
      }
    }
    return found.sort((a, b) => b.mtime - a.mtime).map(f => f.file);
  }

  // shortcut: without git on PATH the repo guard cannot run, so the draft is written anywhere.
  private async repoRoot(): Promise<string | null> {
    try {
      return (await run('git', ['rev-parse', '--show-toplevel'], { cwd: this.deps.cwd })).stdout.trim();
    } catch {
      return null; // not inside a repo, or git missing
    }
  }

  private static isInside(top: string, file: string): boolean {
    const rel = relative(top, file);
    return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
  }
}
