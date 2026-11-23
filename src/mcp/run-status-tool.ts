import type { RunStatus } from '../dispatch/dispatcher.js';
import type { McpContent, McpTool } from './server.js';

// MCP tool: report a run — each worker's message count and, for a writer, whether its changed files stayed inside its owned set.
export class RunStatusTool implements McpTool {
  readonly name = 'run_status';
  readonly description = 'Report a team run: per-worker message counts and file-ownership check.';
  readonly inputSchema = { type: 'object', properties: { run: { type: 'string' } }, required: ['run'] };

  constructor(private readonly deps: { status: (run: string) => Promise<RunStatus> }) {}

  async call(args: Record<string, unknown>): Promise<McpContent> {
    const run = typeof args.run === 'string' && args.run ? args.run : undefined;
    if (!run) return err('run is required (a non-empty string)');
    try {
      return { content: [{ type: 'text', text: JSON.stringify(await this.deps.status(run)) }] };
    } catch (e) {
      return err((e as Error).message);
    }
  }
}

const err = (text: string): McpContent => ({ content: [{ type: 'text', text }], isError: true });
