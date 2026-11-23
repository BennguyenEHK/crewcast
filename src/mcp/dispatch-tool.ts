import type { RunState } from '../dispatch/dispatcher.js';
import type { McpContent, McpTool } from './server.js';

// MCP tool: start a team run from a plan.md (path or markdown). The CLI supplies the allocate+dispatch pipeline as `dispatch`.
export class DispatchTool implements McpTool {
  readonly name = 'dispatch';
  readonly description = 'Start a team run from an approved plan.md: allocate the crew and launch the workers.';
  readonly inputSchema = {
    type: 'object',
    properties: { plan: { type: 'string' }, run: { type: 'string' } },
    required: ['plan'],
  };

  constructor(private readonly deps: { dispatch: (plan: string, run: string) => Promise<RunState>; newRun: () => string }) {}

  async call(args: Record<string, unknown>): Promise<McpContent> {
    const plan = typeof args.plan === 'string' && args.plan.trim() ? args.plan : undefined;
    if (!plan) return err('plan is required (a plan.md path or its markdown)');
    const run = typeof args.run === 'string' && args.run ? args.run : this.deps.newRun();
    try {
      return { content: [{ type: 'text', text: JSON.stringify(await this.deps.dispatch(plan, run)) }] };
    } catch (e) {
      return err((e as Error).message);
    }
  }
}

const err = (text: string): McpContent => ({ content: [{ type: 'text', text }], isError: true });
