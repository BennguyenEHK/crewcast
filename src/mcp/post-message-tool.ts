import type { Mailbox } from '../mailbox.js';
import type { McpContent, McpTool } from './server.js';

// MCP tool: a worker or the captain posts one line to a run's mailbox (§7.7).
export class PostMessageTool implements McpTool {
  readonly name = 'post_message';
  readonly description = 'Post a message to a run mailbox so the team can read it.';
  readonly inputSchema = {
    type: 'object',
    properties: { run: { type: 'string' }, from: { type: 'string' }, text: { type: 'string' } },
    required: ['run', 'from', 'text'],
  };

  constructor(private readonly deps: { mailbox: Mailbox; defaultRun?: () => string | undefined }) {}

  async call(args: Record<string, unknown>): Promise<McpContent> {
    const run = str(args.run) ?? this.deps.defaultRun?.(), from = str(args.from), text = str(args.text);
    if (!run || !from || text === undefined) return err('run, from and text are required (non-empty strings)');
    try {
      await this.deps.mailbox.post(run, from, text);
      return { content: [{ type: 'text', text: 'ok' }] };
    } catch (e) {
      return err((e as Error).message);
    }
  }
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
const err = (text: string): McpContent => ({ content: [{ type: 'text', text }], isError: true });
