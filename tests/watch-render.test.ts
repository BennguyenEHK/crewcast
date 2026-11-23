import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderWatch, renderFeed, appendLines, renderAgentsBlock, ansiPaint, noPaint, type FeedCursor } from '../src/dispatch/watch-render.js';
import type { WatchRow, WatchView } from '../src/dispatch/run-watch.js';
import type { ActivityEvent } from '../src/activity.js';

test('renders a header and a line per worker, with status markers and a truncated latest message', () => {
  const view: WatchView = {
    run: 'r1', startedAt: '2026-11-22T00:00:00.000Z', elapsedMs: 5000,
    rows: [
      { unit: 'auth', engine: 'codex', files: ['a.ts'], skills: ['tdd'], status: 'running', latest: 'x'.repeat(100), messages: 3 },
      { unit: 'login', engine: 'agy', files: ['b.ts'], skills: [], status: 'ended', latest: 'done', messages: 1 },
      { unit: 'rev', engine: 'copilot', files: [], skills: [], status: 'failed', latest: '', messages: 0, error: 'ENOENT' },
    ],
  };
  const out = renderWatch(view);
  assert.match(out, /r1/);
  assert.match(out, /codex/); assert.match(out, /agy/); assert.match(out, /copilot/);
  assert.match(out, /◐/); assert.match(out, /●/); assert.match(out, /✗/); // running, ended, failed markers
  assert.match(out, /done/);        // ended row's latest message
  assert.match(out, /ENOENT/);      // failed row shows the error
  assert.ok(out.includes('…'), 'the 100-char latest is truncated');
});

test('renderFeed lists one summary per event, oldest first with a time prefix (newest at the bottom)', () => {
  const events: ActivityEvent[] = [
    { kind: 'decided', ts: '2026-11-22T10:00:00.000Z', mode: 'team', skills: ['tdd'], branch: 'feat/x', task: 'x' },
    { kind: 'dispatch', ts: '2026-11-22T10:00:05.000Z', run: 'r1', units: [{ unit: 'auth', engine: 'codex' }] },
  ];
  const out = renderFeed(events);
  assert.match(out, /decided.*team.*feat\/x/);
  assert.match(out, /dispatched.*codex.*auth/);
  assert.ok(out.indexOf('dispatched') > out.indexOf('decided'), 'newest (dispatch) is below');
  assert.match(out, /10:00:00/); // time prefix from the ISO ts
});

test('appendLines emits new events and a fresh agents block whenever a worker changes', () => {
  const e1: ActivityEvent = { kind: 'decided', ts: '2026-11-22T10:00:00.000Z', mode: 'team', skills: [], branch: 'feat/x', task: 'x' };
  const e2: ActivityEvent = { kind: 'dispatch', ts: '2026-11-22T10:00:03.000Z', run: 'r1', units: [{ unit: 'auth', engine: 'codex' }] };
  const running: WatchRow = { unit: 'auth', engine: 'codex', files: ['a.ts'], skills: [], model: 'gpt-5-codex', effort: 'high', status: 'running', latest: '', messages: 0 };
  const ended: WatchRow = { ...running, status: 'ended', latest: 'tests pass', messages: 3 };
  const view = (rows: WatchRow[]): WatchView => ({ run: 'r1', startedAt: '2026-11-22T10:00:00.000Z', elapsedMs: 41000, rows });

  // tick 1: both events + an agents block (header carries the current time + run elapsed; entry shows model/effort/files)
  let step = appendLines([e1, e2], view([running]), { events: 0, workers: {} }, '10:00:41');
  const frame = step.lines.join('\n');
  assert.match(frame, /decided.*team.*feat\/x/);
  assert.match(frame, /dispatched.*codex.*auth/);
  assert.match(frame, /agents @ 10:00:41 · 0:41/);
  assert.match(frame, /codex.*auth.*running.*model=gpt-5-codex effort=high/);
  assert.match(frame, /files {2}a\.ts/);

  // tick 2: nothing changed → no new lines
  step = appendLines([e1, e2], view([running]), step.cursor, '10:00:42');
  assert.deepEqual(step.lines, []);

  // tick 3: the worker ended → a fresh block (no event lines, events unchanged); latest message shown
  step = appendLines([e1, e2], view([ended]), step.cursor, '10:00:44');
  const block = step.lines.join('\n');
  assert.ok(!/decided|dispatched/.test(block), block); // no event lines this tick
  assert.match(block, /ended/);
  assert.match(block, /tests pass/);
});

test('ansiPaint colors the agents block; noPaint leaves it plain', () => {
  const view: WatchView = { run: 'r1', startedAt: '2026-11-22T10:00:00.000Z', elapsedMs: 5000, rows: [{ unit: 'ui', engine: 'agy', files: [], skills: [], status: 'running', latest: '', messages: 0 }] };
  const plain = renderAgentsBlock(view, '10:00:05', noPaint).join('\n');
  const colored = renderAgentsBlock(view, '10:00:05', ansiPaint).join('\n');
  assert.ok(!plain.includes('\x1b['), 'noPaint emits no ANSI');
  assert.ok(colored.includes('\x1b['), 'ansiPaint emits ANSI codes');
  assert.match(plain, /agy.*ui.*running/); // content identical, just uncolored
});
