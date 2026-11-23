import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderWatch } from '../src/dispatch/watch-render.js';
import type { WatchView } from '../src/dispatch/run-watch.js';

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
