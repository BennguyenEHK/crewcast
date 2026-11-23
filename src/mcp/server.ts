import { createInterface } from 'node:readline';

export interface McpContent { content: { type: 'text'; text: string }[]; isError?: boolean }
export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  call(args: Record<string, unknown>): Promise<McpContent>;
}

interface Request { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: Record<string, unknown> }
const PROTOCOL = '2025-06-18'; // shortcut: MCP stdio protocol version; bump if the spec moves (see plan "Left to the builder").

// Hand-rolled JSON-RPC 2.0 server over newline-delimited stdio. No SDK, so crewcast keeps zero runtime deps.
export class McpServer {
  private readonly tools: McpTool[];
  private readonly serverInfo: { name: string; version: string };

  constructor(deps: { tools: McpTool[]; serverInfo?: { name: string; version: string } }) {
    this.tools = deps.tools;
    this.serverInfo = deps.serverInfo ?? { name: 'crewcast', version: '0.0.0' };
  }

  // A parsed message in; a JSON-RPC response object out, or null for a notification (no id).
  async handle(msg: unknown): Promise<object | null> {
    if (typeof msg !== 'object' || msg === null || Array.isArray(msg)) return McpServer.error(null, -32600, 'invalid request');
    const { id, method } = msg as Request;
    const hasId = id !== undefined && id !== null;
    if (typeof method !== 'string') return hasId ? McpServer.error(id, -32600, 'invalid request') : null;
    const params = ((msg as Request).params ?? {}) as Record<string, unknown>;

    // A message with no id is a notification: run side effects (none here), answer nothing.
    if (!hasId) return null;

    switch (method) {
      case 'initialize':
        return McpServer.ok(id, { protocolVersion: PROTOCOL, capabilities: { tools: {} }, serverInfo: this.serverInfo });
      case 'ping':
        return McpServer.ok(id, {});
      case 'tools/list':
        return McpServer.ok(id, { tools: this.tools.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) });
      case 'tools/call': {
        const name = params.name;
        const tool = this.tools.find(t => t.name === name);
        if (!tool) return McpServer.ok(id, { content: [{ type: 'text', text: `unknown tool '${String(name)}'` }], isError: true });
        const args = (params.arguments ?? {}) as Record<string, unknown>;
        try {
          return McpServer.ok(id, await tool.call(args));
        } catch (err) {
          // A tool must never take down the session: surface its failure as an error result.
          return McpServer.ok(id, { content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }], isError: true });
        }
      }
      default:
        return McpServer.error(id, -32601, `method not found: ${method}`);
    }
  }

  // Reads one JSON message per line; writes one JSON response per line. Ends when input ends.
  async serve(input: NodeJS.ReadableStream, output: NodeJS.WritableStream): Promise<void> {
    const rl = createInterface({ input, crlfDelay: Infinity });
    for await (const raw of rl) {
      const line = raw.replace(/^﻿/, ''); // a client may prepend a UTF-8 BOM; strip it so the first message still parses
      if (line.trim() === '') continue;
      let msg: unknown;
      try {
        msg = JSON.parse(line);
      } catch {
        output.write(JSON.stringify(McpServer.error(null, -32700, 'parse error')) + '\n');
        continue;
      }
      let res: object | null;
      try {
        res = await this.handle(msg);
      } catch (err) {
        // Belt-and-suspenders: no exception from handle ends the read loop.
        output.write(JSON.stringify(McpServer.error((msg as { id?: unknown }).id ?? null, -32603, err instanceof Error ? err.message : 'internal error')) + '\n');
        continue;
      }
      if (res !== null) output.write(JSON.stringify(res) + '\n');
    }
  }

  private static ok(id: unknown, result: object): object {
    return { jsonrpc: '2.0', id, result };
  }

  private static error(id: unknown, code: number, message: string): object {
    return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
  }
}
