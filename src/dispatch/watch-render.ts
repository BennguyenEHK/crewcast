import type { WatchRow, WatchStatus, WatchView } from './run-watch.js';
import { summarizeEvent, type ActivityEvent } from '../activity.js';

const MARK: Record<WatchStatus, string> = { ended: '●', running: '◐', queued: '○', failed: '✗' };
const trunc = (s: string, n: number): string => (s.length > n ? s.slice(0, n - 1) + '…' : s);

// Minimal ANSI (zero-dep). The renderers take a Paint so they stay plain-string testable (noPaint) and the live loop
// passes ansiPaint only on a TTY without NO_COLOR. Color is semantic — status marker, dim timestamps/detail, red errors.
const SGR = { reset: '\x1b[0m', dim: '\x1b[2m', red: '\x1b[31m', green: '\x1b[32m', cyan: '\x1b[36m', gray: '\x1b[90m' } as const;
export type Paint = (code: Exclude<keyof typeof SGR, 'reset'>, s: string) => string;
export const noPaint: Paint = (_c, s) => s;
export const ansiPaint: Paint = (c, s) => `${SGR[c]}${s}${SGR.reset}`;

const STATUS_COLOR: Record<WatchStatus, Exclude<keyof typeof SGR, 'reset'>> = { ended: 'green', running: 'cyan', queued: 'gray', failed: 'red' };
// Painted marker sits before the padded columns, so its (zero-width) color codes never break alignment.
const mark = (status: WatchStatus, paint: Paint): string => paint(STATUS_COLOR[status], MARK[status]);
const fmtElapsed = (ms: number): string => `${Math.floor(Math.max(0, ms) / 60000)}:${String(Math.floor(Math.max(0, ms) / 1000) % 60).padStart(2, '0')}`;

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

// One feed line: HH:MM:SS from the event's own ts (dim) + the templated summary.
function feedLine(e: ActivityEvent, paint: Paint = noPaint): string {
  const t = e.ts.includes('T') ? e.ts.slice(11, 19) : e.ts; // HH:MM:SS from an ISO ts; a non-ISO ts prints as-is
  return `${paint('dim', t)} ${summarizeEvent(e)}`.trim();
}

// The activity feed as a block: one summary per event, oldest first (newest at the bottom).
export function renderFeed(events: ActivityEvent[]): string {
  return events.map(e => feedLine(e)).join('\n');
}

// The streaming "agents" detail block: a run-elapsed header, then per worker — status marker, engine · unit, status,
// model/effort, owned files, and latest message. Returned as lines so the watch loop appends them to the scroll.
export function renderAgentsBlock(view: WatchView, now: string, paint: Paint = noPaint): string[] {
  const lines = [paint('dim', `  — agents @ ${now} · ${fmtElapsed(view.elapsedMs)} —`)];
  for (const r of view.rows) {
    const detail = r.status === 'failed' ? 'failed' : r.status;
    lines.push(`  ${mark(r.status, paint)} ${r.engine.padEnd(8)} ${r.unit.padEnd(14)} ${detail.padEnd(8)} model=${r.model ?? 'default'} effort=${r.effort ?? '—'}`);
    lines.push(paint('dim', `       files  ${r.files.join(', ') || '(read-only)'}`));
    if (r.error) lines.push(`       ${paint('red', `error  ${r.error}`)}`);
    if (r.latest) lines.push(paint('dim', `       last   "${trunc(r.latest, 60)}"${r.messages ? `  (${r.messages} msg${r.messages > 1 ? 's' : ''})` : ''}`));
  }
  return lines;
}

// Append-only watch cursor: how many events were already printed, and the last-printed signature per worker unit.
export interface FeedCursor { events: number; workers: Record<string, string> }

// Streaming watch: emit only the lines new since `cursor` — every unprinted event, then (if any worker's
// status/message/error changed) one fresh agents block for the whole run. `now` is the HH:MM:SS stamp for the block;
// `paint` colors it on a TTY. The terminal's own scrollback keeps the history.
export function appendLines(events: ActivityEvent[], view: WatchView | null, cursor: FeedCursor, now: string, paint: Paint = noPaint): { lines: string[]; cursor: FeedCursor } {
  const lines = events.slice(cursor.events).map(e => feedLine(e, paint));
  const workers = { ...cursor.workers };
  let changed = false;
  for (const r of view?.rows ?? []) {
    const sig = `${r.status}|${r.latest}|${r.error ?? ''}`;
    if (workers[r.unit] !== sig) { workers[r.unit] = sig; changed = true; }
  }
  if (changed && view) lines.push(...renderAgentsBlock(view, now, paint));
  return { lines, cursor: { events: events.length, workers } };
}
