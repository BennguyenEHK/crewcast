import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DispatchTool } from '../src/mcp/dispatch-tool.js';
import { RunStatusTool } from '../src/mcp/run-status-tool.js';
import type { RunState, RunStatus } from '../src/dispatch/dispatcher.js';

test('dispatch tool allocates+dispatches the plan and returns the run state', async () => {
  const seen: { plan: string; run: string }[] = [];
  const dispatch = async (plan: string, run: string): Promise<RunState> => {
    seen.push({ plan, run });
    return { run, startedAt: 't', workers: [{ unit: 'A', engine: 'codex', group: 0, cwd: '/wt', worktree: null, files: ['a.ts'], skills: [], pid: 7 }] };
  };
  const res = await new DispatchTool({ dispatch, newRun: () => 'run-x' }).call({ plan: '## A\nfiles: a.ts\n' });
  assert.ok(!res.isError, res.content[0].text);
  const state = JSON.parse(res.content[0].text) as RunState;
  assert.equal(state.run, 'run-x');
  assert.equal(seen[0].plan, '## A\nfiles: a.ts\n');
});

test('dispatch tool: missing plan → isError', async () => {
  const res = await new DispatchTool({ dispatch: async () => ({ run: 'r', startedAt: 't', workers: [] }), newRun: () => 'r' }).call({});
  assert.ok(res.isError);
});

test('run_status tool returns the status; missing run → isError', async () => {
  const status = async (run: string): Promise<RunStatus> => ({ run, workers: [] });
  const ok = await new RunStatusTool({ status }).call({ run: 'r1' });
  assert.equal((JSON.parse(ok.content[0].text) as RunStatus).run, 'r1');
  assert.ok((await new RunStatusTool({ status }).call({})).isError);
});
