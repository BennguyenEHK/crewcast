import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable, Writable } from 'node:stream';
import { McpServer, type McpTool } from '../src/mcp/server.js';

const echo: McpTool = {
  name: 'echo',
  description: 'echoes args',
  inputSchema: { type: 'object', properties: {} },
  async call(args) {
    return { content: [{ type: 'text', text: JSON.stringify(args) }] };
  },
};
const server = () => new McpServer({ tools: [echo], serverInfo: { name: 'crewcast', version: '9.9.9' } });

test('initialize returns protocolVersion, tools capability and serverInfo', async () => {
  const res = (await server().handle({ jsonrpc: '2.0', id: 1, method: 'initialize' })) as any;
  assert.equal(res.id, 1);
  assert.equal(typeof res.result.protocolVersion, 'string');
  assert.ok(res.result.capabilities.tools);
  assert.deepEqual(res.result.serverInfo, { name: 'crewcast', version: '9.9.9' });
});

test('tools/list returns the injected tools name+description+inputSchema', async () => {
  const res = (await server().handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' })) as any;
  assert.deepEqual(res.result.tools, [{ name: 'echo', description: 'echoes args', inputSchema: { type: 'object', properties: {} } }]);
});

test('tools/call routes to the named tool and returns its content', async () => {
  const res = (await server().handle({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'echo', arguments: { a: 1 } } })) as any;
  assert.equal(res.result.content[0].text, '{"a":1}');
});

test('tools/call with an unknown name returns isError content, does not throw', async () => {
  const res = (await server().handle({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'nope' } })) as any;
  assert.equal(res.result.isError, true);
  assert.match(res.result.content[0].text, /unknown tool 'nope'/);
});

test('a notification (no id) returns null — no response', async () => {
  const res = await server().handle({ jsonrpc: '2.0', method: 'notifications/initialized' });
  assert.equal(res, null);
});

test('an unknown method returns JSON-RPC error -32601', async () => {
  const res = (await server().handle({ jsonrpc: '2.0', id: 5, method: 'foo/bar' })) as any;
  assert.equal(res.error.code, -32601);
});

test('a non-object message returns error -32600', async () => {
  const res = (await server().handle(42)) as any;
  assert.equal(res.error.code, -32600);
  assert.equal(res.id, null);
});

test('serve reads newline JSON, answers each, and reports a bad line as -32700', async () => {
  const input = Readable.from(['{"jsonrpc":"2.0","id":7,"method":"tools/list"}\n', '{bad json\n']);
  const chunks: string[] = [];
  const output = new Writable({ write(c, _e, cb) { chunks.push(c.toString()); cb(); } });
  await server().serve(input, output);
  const lines = chunks.join('').trim().split('\n').map(l => JSON.parse(l));
  assert.equal(lines[0].id, 7);
  assert.ok(Array.isArray(lines[0].result.tools));
  assert.equal(lines[1].error.code, -32700);
  assert.equal(lines[1].id, null);
});

test('a tool that throws becomes isError content, and serve keeps serving', async () => {
  const boom: McpTool = { name: 'boom', description: 'throws', inputSchema: { type: 'object', properties: {} }, async call() { throw new Error('kaboom'); } };
  const s = new McpServer({ tools: [boom, echo] });
  // handle: a throwing tool is an isError result, not a rejected promise
  const r = (await s.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'boom' } })) as any;
  assert.equal(r.result.isError, true);
  assert.match(r.result.content[0].text, /kaboom/);
  // serve: a throwing-tool call followed by tools/list — the session survives and answers the second
  const input = Readable.from([
    '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"boom"}}\n',
    '{"jsonrpc":"2.0","id":2,"method":"tools/list"}\n',
  ]);
  const chunks: string[] = [];
  const output = new Writable({ write(c, _e, cb) { chunks.push(c.toString()); cb(); } });
  await s.serve(input, output);
  const lines = chunks.join('').trim().split('\n').map(l => JSON.parse(l));
  assert.equal(lines[0].result.isError, true);
  assert.equal(lines[1].id, 2);
  assert.ok(Array.isArray(lines[1].result.tools));
});
