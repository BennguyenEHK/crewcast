import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Mailbox } from '../mailbox.js';
import type { RunState } from './dispatcher.js';

export type WatchStatus = 'failed' | 'running' | 'ended' | 'queued';
export interface WatchRow { unit: string; engine: string; files: string[]; skills: string[]; status: WatchStatus; latest: string; messages: number; error?: string }
export interface WatchView { run: string; startedAt: string; elapsedMs: number; rows: WatchRow[] }

// Derives a live view of a team run from its run.json + mailbox (§7.7): each worker's status, latest message, count, and elapsed.
export class RunWatch {
  constructor(private readonly deps: { runsHome: string; mailbox: Mailbox; alive: (pid: number) => boolean; now?: () => number }) {}

  async view(run: string): Promise<WatchView> {
    const state = JSON.parse(await readFile(join(this.deps.runsHome, 'runs', run, 'run.json'), 'utf8')) as RunState;
    const { messages } = await this.deps.mailbox.read(run);
    const now = (this.deps.now ?? Date.now)();
    const rows: WatchRow[] = state.workers.map(w => {
      const mine = messages.filter(m => m.from === w.unit);
      const status: WatchStatus =
        w.error || w.pid === null ? 'failed'
        : w.pid === undefined ? 'queued'
        : this.deps.alive(w.pid) ? 'running'
        : 'ended';
      return {
        unit: w.unit, engine: w.engine, files: w.files, skills: (w as { skills?: string[] }).skills ?? [], // Task 2 adds skills to WorkerRecord; read defensively so this compiles alone
        status, latest: mine.at(-1)?.text ?? '', messages: mine.length,
        ...(w.error ? { error: w.error } : {}),
      };
    });
    return { run, startedAt: state.startedAt, elapsedMs: now - Date.parse(state.startedAt), rows };
  }
}
