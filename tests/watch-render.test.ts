import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderWatch, renderFeed, appendLines, type FeedCursor } from '../src/dispatch/watch-render.js';
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

test('appendLines emits only events and worker changes new since the cursor', () => {
  const e1: ActivityEvent = { kind: 'decided', ts: '2026-11-22T10:00:00.000Z', mode: 'team', skills: [], branch: 'feat/x', task: 'x' };
  const e2: ActivityEvent = { kind: 'dispatch', ts: '2026-11-22T10:00:03.000Z', run: 'r1', units: [{ unit: 'auth', engine: 'codex' }] };
  const running: WatchRow = { unit: 'auth', engine: 'codex', files: ['a.ts'], skills: [], status: 'running', latest: '', messages: 0 };
  const ended: WatchRow = { ...running, status: 'ended', latest: 'done', messages: 1 };

  // tick 1: both events + the running worker line (worker line carries the current time, not an event ts)
  let step = appendLines([e1, e2], [running], { events: 0, workers: {} }, '10:00:05');
  assert.match(step.lines.join('\n'), /decided.*team.*feat\/x/);
  assert.match(step.lines.join('\n'), /dispatched.*codex.*auth/);
  assert.ok(step.lines.some(l => /10:00:05/.test(l) && /running/.test(l) && /auth/.test(l)), step.lines.join('\n'));

  // tick 2: nothing changed → no new lines
  step = appendLines([e1, e2], [running], step.cursor, '10:00:06');
  assert.deepEqual(step.lines, []);

  // tick 3: the worker ended → one worker line, no event lines (events unchanged)
  step = appendLines([e1, e2], [ended], step.cursor, '10:00:40');
  assert.equal(step.lines.length, 1);
  assert.match(step.lines[0], /auth/);
  assert.match(step.lines[0], /ended|done/);
});
