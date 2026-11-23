import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderWatch, renderFeed } from '../src/dispatch/watch-render.js';
import type { WatchView } from '../src/dispatch/run-watch.js';
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
