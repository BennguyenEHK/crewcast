import type { WatchStatus, WatchView } from './run-watch.js';
import { summarizeEvent, type ActivityEvent } from '../activity.js';

const MARK: Record<WatchStatus, string> = { ended: '●', running: '◐', queued: '○', failed: '✗' };
const trunc = (s: string, n: number): string => (s.length > n ? s.slice(0, n - 1) + '…' : s);

// A plain multi-line frame (no ANSI — the loop adds the clear sequence) so it is testable as a string.
export function renderWatch(view: WatchView): string {
  const lines = [`crewcast · run ${view.run} · team · ${view.rows.length} units · ${Math.round(view.elapsedMs / 1000)}s`];
  for (const r of view.rows) {
    const detail = r.status === 'failed' ? `failed: ${r.error ?? ''}` : r.status;
    const latest = r.latest ? ` "${trunc(r.latest, 48)}"` : '';
    lines.push(`${MARK[r.status]} ${r.engine.padEnd(8)} ${r.unit.padEnd(14)} ${(r.files.join(',') || '(read-only)').padEnd(18)} ${detail}${latest}`);
  }
  return lines.join('\n');
}

// The activity feed: one plain summary per event, oldest first (newest at the bottom), each with a short HH:MM:SS prefix.
export function renderFeed(events: ActivityEvent[]): string {
  return events.map(e => {
    const t = e.ts.includes('T') ? e.ts.slice(11, 19) : e.ts; // HH:MM:SS from an ISO ts; a non-ISO ts prints as-is
    return `${t} ${summarizeEvent(e)}`.trim();
  }).join('\n');
}
