import { test } from 'node:test';
import assert from 'node:assert/strict';
import { feedLines, agentLines, decisionLines, renderDashboard, ansiPaint, noPaint } from '../src/dispatch/watch-render.js';
import type { WatchView } from '../src/dispatch/run-watch.js';
import type { ActivityEvent } from '../src/activity.js';

test('feedLines colors each event by kind and keeps the HH:MM:SS prefix', () => {
  const evs: ActivityEvent[] = [
    { kind: 'prompt-received', ts: '2026-11-23T10:00:00.000Z', task: 'x' },
    { kind: 'decided', ts: '2026-11-23T10:00:01.000Z', mode: 'solo', skills: [], branch: 'keep', task: 'x' },
    { kind: 'decide-failed', ts: '2026-11-23T10:00:02.000Z', reason: 'down' },
    { kind: 'dispatch', ts: '2026-11-23T10:00:03.000Z', run: 'r1', units: [{ unit: 'a', engine: 'codex' }] },
  ];
  const ls = feedLines(evs);
  assert.deepEqual(ls.map(l => l.color), ['cyan', 'green', 'red', 'yellow']);
  assert.match(ls[0].text, /^10:00:00 prompt received/);
});

test('agentLines colors by status and carries model/effort + latest message', () => {
  const view: WatchView = { run: 'r1', startedAt: '', elapsedMs: 0, rows: [
    { unit: 'auth', engine: 'codex', files: [], skills: [], model: 'gpt-5-codex', effort: 'high', status: 'running', latest: 'writing', messages: 1 },
    { unit: 'ui', engine: 'agy', files: [], skills: [], status: 'ended', latest: '', messages: 0 },
  ] };
  const ls = agentLines(view);
  assert.equal(ls[0].color, 'cyan'); assert.equal(ls[1].color, 'green');
  assert.match(ls[0].text, /codex.*auth.*running.*model=gpt-5-codex effort=high.*writing/);
  assert.match(ls[1].text, /agy.*ui.*ended.*model=default effort=—/); // older run.json without model/effort → defaults
});

test('decisionLines renders the solo decision as a lead row + skills + task', () => {
  const ls = decisionLines({ kind: 'decided', ts: 't', mode: 'solo', skills: ['frontend-design', 'lock-in'], branch: 'keep', task: 'add a panel' });
  const text = ls.map(l => l.text).join('\n');
  assert.match(text, /◆ solo.*branch keep/);
  assert.match(text, /skills.*frontend-design, lock-in/);
  assert.match(text, /task.*add a panel/);
});

test('renderDashboard frames two titled panes to the given width, content inside', () => {
  const feed = feedLines([
    { kind: 'prompt-received', ts: '2026-11-23T10:00:00.000Z', task: 'x' },
    { kind: 'decided', ts: '2026-11-23T10:00:01.000Z', mode: 'team', skills: [], branch: 'feat/x', task: 'x' },
  ]);
  const lower = decisionLines({ kind: 'decided', ts: 't', mode: 'team', skills: ['tdd'], branch: 'feat/x', task: 'x' });
  const out = renderDashboard({ feed, feedTitle: 'live feed', lower, lowerTitle: 'decision · team', cols: 50, rows: 12, paint: noPaint });
  const lines = out.split('\n');
  assert.ok(lines[0].startsWith('┌─ live feed ') && lines[0].endsWith('┐'), lines[0]);
  assert.ok(lines.some(l => l.includes('├─ decision · team ') && l.endsWith('┤')));
  assert.ok(lines.at(-1)!.startsWith('└') && lines.at(-1)!.endsWith('┘'));
  assert.equal(lines[0].length, 50);          // framed to the requested width
  assert.ok(out.includes('decided: team'));   // feed content
  assert.ok(out.includes('◆ team'));          // lower (decision) content
});

test('renderDashboard colors with ansiPaint and stays plain with noPaint', () => {
  const feed = feedLines([{ kind: 'decided', ts: '2026-11-23T10:00:00.000Z', mode: 'solo', skills: [], branch: 'keep', task: 'x' }]);
  const plain = renderDashboard({ feed, feedTitle: 'f', lower: [], lowerTitle: 'l', cols: 40, rows: 10, paint: noPaint });
  const colored = renderDashboard({ feed, feedTitle: 'f', lower: [], lowerTitle: 'l', cols: 40, rows: 10, paint: ansiPaint });
  assert.ok(!plain.includes('\x1b['), 'noPaint emits no ANSI');
  assert.ok(colored.includes('\x1b['), 'ansiPaint emits ANSI codes');
});
