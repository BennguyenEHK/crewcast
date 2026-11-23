import type { Mailbox } from '../mailbox.js';
import type { McpContent, McpTool } from './server.js';

// MCP tool: read a run's mailbox from a cursor, so the captain gets only new messages (§7.7).
export class ReadMessagesTool implements McpTool {
  readonly name = 'read_messages';
  readonly description = 'Read messages from a run mailbox, optionally only those after a cursor.';
  readonly inputSchema = {
    type: 'object',
    properties: { run: { type: 'string' }, since: { type: 'number' } },
    required: ['run'],
  };

  constructor(private readonly deps: { mailbox: Mailbox }) {}

  async call(args: Record<string, unknown>): Promise<McpContent> {
    const run = typeof args.run === 'string' && args.run ? args.run : undefined;
    if (!run) return err('run is required (a non-empty string)');
    if (args.since !== undefined && typeof args.since !== 'number') return err('since must be a number');
    try {
      const result = await this.deps.mailbox.read(run, args.since as number | undefined);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    } catch (e) {
      return err((e as Error).message);
    }
  }
}

const err = (text: string): McpContent => ({ content: [{ type: 'text', text }], isError: true });
