import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ShadowLog } from './shadow.js';

export type ActivityEvent =
  | { kind: 'prompt-received'; ts: string; task: string }
  | { kind: 'decided'; ts: string; mode: string; skills: string[]; branch: string; task: string }
  | { kind: 'decide-failed'; ts: string; reason: string }
  | { kind: 'dispatch'; ts: string; run: string; units: { unit: string; engine: string }[] };

// crewcast's self-narration log: one event per action it takes, so `watch` can show the whole pipeline (§7 live feed).
const MAX_EVENTS = 500; // keep the feed bounded: watch re-reads the whole log each tick, and old narration has no value

export class ActivityLog {
  private readonly file: string;
  constructor(private readonly home: string) {
    this.file = join(home, 'activity.jsonl');
  }

  // Best-effort: a log-write failure must never break the fail-open hook, so this swallows its own errors.
  async append(e: ActivityEvent): Promise<void> {
    try {
      await mkdir(this.home, { recursive: true });
      await appendFile(this.file, JSON.stringify(e) + '\n', 'utf8');
      const rows = await this.all();
      if (rows.length > MAX_EVENTS) { // trim to the last MAX_EVENTS so the log can't grow unbounded
        await writeFile(this.file, rows.slice(-MAX_EVENTS).map(r => JSON.stringify(r)).join('\n') + '\n', 'utf8');
      }
    } catch { /* never throw out of a narration write */ }
  }

  // All events in order; a missing or unreadable log (e.g. home is a file) is just "no activity to show".
  async all(): Promise<ActivityEvent[]> {
    try {
      const { rows } = await ShadowLog.readJsonl<ActivityEvent>(this.file);
      return rows;
    } catch {
      return [];
    }
  }

  async recent(n: number): Promise<ActivityEvent[]> {
    return (await this.all()).slice(-n);
  }
}

// Templated plain-English summary (ASD-STE100), no AI, no tokens — crewcast formats facts it already has.
export function summarizeEvent(e: ActivityEvent): string {
  switch (e.kind) {
    case 'prompt-received': return 'prompt received';
    case 'decided': return `decided: ${e.mode} · ${e.skills.length ? `skills ${e.skills.join(', ')}` : 'no skills'} · branch ${e.branch}`;
    case 'decide-failed': return `decide failed: ${e.reason}`;
    case 'dispatch': return `dispatched: ${e.units.map(u => `${u.engine} → ${u.unit}`).join(', ')}`;
  }
}
