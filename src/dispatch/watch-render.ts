import type { WatchStatus, WatchView } from './run-watch.js';
import { summarizeEvent, type ActivityEvent } from '../activity.js';

const MARK: Record<WatchStatus, string> = { ended: '●', running: '◐', queued: '○', failed: '✗' };
const trunc = (s: string, n: number): string => (s.length > n ? s.slice(0, n - 1) + '…' : s);

// Minimal ANSI (zero-dep). Lines are built as plain text + a color, so truncation/padding is plain-string math and the
// color wraps the whole padded cell — no ANSI-width bookkeeping. noPaint keeps everything testable as a plain string.
const SGR = { reset: '\x1b[0m', dim: '\x1b[2m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m', gray: '\x1b[90m' } as const;
export type Color = Exclude<keyof typeof SGR, 'reset'>;
export type Paint = (code: Color, s: string) => string;
export const noPaint: Paint = (_c, s) => s;
export const ansiPaint: Paint = (c, s) => `${SGR[c]}${s}${SGR.reset}`;

// One rendered line: plain text (for sizing) + an optional whole-line color.
export interface Line { text: string; color?: Color }

const FEED_COLOR: Record<ActivityEvent['kind'], Color> = { 'prompt-received': 'cyan', decided: 'green', 'decide-failed': 'red', dispatch: 'yellow' };
const STATUS_COLOR: Record<WatchStatus, Color> = { ended: 'green', running: 'cyan', queued: 'gray', failed: 'red' };
const timeOf = (ts: string): string => (ts.includes('T') ? ts.slice(11, 19) : ts);

// Feed pane content: one colored line per event (colored by kind), oldest first.
export function feedLines(events: ActivityEvent[]): Line[] {
  return events.map(e => ({ text: `${timeOf(e.ts)} ${summarizeEvent(e)}`.trim(), color: FEED_COLOR[e.kind] }));
}

// Agents pane content (team run): one colored line per worker (colored by status), with model/effort and latest message.
export function agentLines(view: WatchView): Line[] {
  return view.rows.map(r => {
    const detail = r.status === 'failed' ? `failed ${r.error ?? ''}`.trim() : r.status;
    const latest = r.latest ? ` "${trunc(r.latest, 32)}"` : '';
    return {
      text: `${MARK[r.status]} ${r.engine.padEnd(7)} ${r.unit.padEnd(12)} ${detail.padEnd(8)} model=${r.model ?? 'default'} effort=${r.effort ?? '—'}${latest}`,
      color: STATUS_COLOR[r.status],
    };
  });
}

// Lower pane content in solo (no workers): the latest decision rendered as a single lead row + skills/branch/task.
export function decisionLines(d: Extract<ActivityEvent, { kind: 'decided' }>): Line[] {
  return [
    { text: `◆ ${d.mode}   branch ${d.branch}`, color: 'cyan' },
    { text: `  skills  ${d.skills.length ? d.skills.join(', ') : 'none'}`, color: 'dim' },
    { text: `  task    ${d.task}`, color: 'dim' },
  ];
}

// A two-pane bordered dashboard sized to cols×rows: feed on top, a lower pane below, each showing the last lines that
// fit (newest at the bottom). Redrawn in place each tick by the caller (which prepends the clear-screen sequence).
export function renderDashboard(opts: { feed: Line[]; feedTitle: string; lower: Line[]; lowerTitle: string; cols: number; rows: number; paint: Paint }): string {
  const { feed, feedTitle, lower, lowerTitle, paint } = opts;
  const cols = Math.max(24, opts.cols);
  const rows = Math.max(7, opts.rows);
  const inner = cols - 4; // "│ " + content + " │"
  const body = rows - 3; // minus top border, divider, bottom border
  const lowerH = Math.min(Math.max(lower.length, 1), Math.max(1, Math.floor(body / 2)));
  const feedH = Math.max(1, body - lowerH);
  const out = [edge('┌', feedTitle, cols, paint)];
  for (const l of fit(feed, feedH)) out.push(row(l, inner, paint));
  out.push(edge('├', lowerTitle, cols, paint));
  for (const l of fit(lower, lowerH)) out.push(row(l, inner, paint));
  out.push(paint('dim', `└${'─'.repeat(cols - 2)}┘`));
  return out.join('\n');
}

// Last h lines, padded with blanks to exactly h so the pane is full height.
function fit(lines: Line[], h: number): (Line | undefined)[] {
  const shown = lines.slice(-h);
  return [...Array(Math.max(0, h - shown.length)).fill(undefined), ...shown];
}

function row(l: Line | undefined, w: number, paint: Paint): string {
  const text = (l?.text ?? '').replace(/\t/g, ' ');
  const cell = text.length > w ? text.slice(0, w - 1) + '…' : text.padEnd(w);
  return `│ ${l?.color ? paint(l.color, cell) : cell} │`;
}

function edge(corner: '┌' | '├', title: string, cols: number, paint: Paint): string {
  const label = ` ${title} `;
  const dashes = '─'.repeat(Math.max(0, cols - 3 - label.length));
  return paint('dim', `${corner}─${label}${dashes}${corner === '┌' ? '┐' : '┤'}`);
}
