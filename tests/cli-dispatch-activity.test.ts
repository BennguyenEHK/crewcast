import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Cli } from '../src/cli.js';
import { ActivityLog } from '../src/activity.js';
import { EngineCatalog, type Engine } from '../src/engines/catalog.js';
import type { SystemOneRequest } from '../src/backend/systemone.js';

type Server = { handle(m: unknown): Promise<unknown> };

const codex: Engine = {
  id: 'codex', bin: 'codex', versionArgs: ['--version'], installed: true, headless: ['exec', '{task}'],
  models: ['default'], strongModel: null, modelFlag: '--model', effortArgs: [], highEffort: null,
  parallelLimit: 2, writeFlags: [], readFlags: [], safeFlags: [], autoMode: false,
};

test('dispatch narrates the run to the activity log (run + unit engine)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cc-dispact-'));
  try {
    const cwd = join(root, 'proj');
    await mkdir(cwd);
    const crewHome = join(root, 'crewcast');
    // codex is the only worker and the lead 'claude' is absent, so the single unit is allocated to codex;
    // seeding an installed catalog also skips the live `detect()` probe.
    await new EngineCatalog().save([codex], crewHome);
    const ask = async (r: SystemOneRequest) => ({ model: r.model, answers: {} });
    const cli = new Cli(() => {}, {
      ask,
      env: { USERPROFILE: join(root, 'home'), CREWCAST_HOME: crewHome },
      cwd,
      pickSkills: async () => [],
      spawn: async () => ({ pid: 1 }),
    });
    const server = await (cli as unknown as { buildMcpServer(): Promise<Server> }).buildMcpServer();
    const res = (await server.handle({
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'dispatch', arguments: { plan: '## Alpha\n' } },
    })) as { result?: { content: { text: string }[] }; error?: unknown };
    assert.ok(res.result, JSON.stringify(res.error));

    const events = await new ActivityLog(crewHome).recent(10);
    const d = events.find(e => e.kind === 'dispatch');
    assert.ok(d, 'a dispatch event was written');
    if (d && d.kind === 'dispatch') {
      assert.ok(d.run.length > 0, 'the event names the run');
      assert.deepEqual(d.units, [{ unit: 'Alpha', engine: 'codex' }]);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
