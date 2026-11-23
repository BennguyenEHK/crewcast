import type { WatchRow, WatchStatus, WatchView } from './run-watch.js';
import { summarizeEvent, type ActivityEvent } from '../activity.js';

const MARK: Record<WatchStatus, string> = { ended: '●', running: '◐', queued: '○', failed: '✗' };
const trunc = (s: string, n: number): string => (s.length > n ? s.slice(0, n - 1) + '…' : s);

// One worker row, shared by the full-frame renderWatch and the streaming feed.
function renderRow(r: WatchRow): string {
  const detail = r.status === 'failed' ? `failed: ${r.error ?? ''}` : r.status;
  const latest = r.latest ? ` "${trunc(r.latest, 48)}"` : '';
  return `${MARK[r.status]} ${r.engine.padEnd(8)} ${r.unit.padEnd(14)} ${(r.files.join(',') || '(read-only)').padEnd(18)} ${detail}${latest}`;
}

// A plain multi-line frame (no ANSI — the caller adds any clear sequence) so it is testable as a string.
export function renderWatch(view: WatchView): string {
  const lines = [`crewcast · run ${view.run} · team · ${view.rows.length} units · ${Math.round(view.elapsedMs / 1000)}s`];
  for (const r of view.rows) lines.push(renderRow(r));
  return lines.join('\n');
}

// One feed line: HH:MM:SS from the event's own ts + the templated summary.
function feedLine(e: ActivityEvent): string {
  const t = e.ts.includes('T') ? e.ts.slice(11, 19) : e.ts; // HH:MM:SS from an ISO ts; a non-ISO ts prints as-is
  return `${t} ${summarizeEvent(e)}`.trim();
}

// The activity feed as a block: one summary per event, oldest first (newest at the bottom).
export function renderFeed(events: ActivityEvent[]): string {
  return events.map(feedLine).join('\n');
}

// Append-only watch cursor: how many events were already printed, and the last-printed signature per worker unit.
export interface FeedCursor { events: number; workers: Record<string, string> }

// Streaming watch: given all events and the current worker rows, emit only the lines new since `cursor` — every
// unprinted event, then one worker line per unit whose status/message/error changed. `now` is the HH:MM:SS stamp for
// the worker lines (worker rows carry no timestamp of their own). The terminal's own scrollback keeps the history.
export function appendLines(events: ActivityEvent[], rows: WatchRow[], cursor: FeedCursor, now: string): { lines: string[]; cursor: FeedCursor } {
  const lines = events.slice(cursor.events).map(feedLine);
  const workers = { ...cursor.workers };
  for (const r of rows) {
    const sig = `${r.status}|${r.latest}|${r.error ?? ''}`;
    if (workers[r.unit] !== sig) {
      workers[r.unit] = sig;
      lines.push(`${now} ${renderRow(r)}`);
    }
  }
  return { lines, cursor: { events: events.length, workers } };
}
