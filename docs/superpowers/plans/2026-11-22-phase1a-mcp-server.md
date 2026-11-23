# Phase 1a — MCP server (`crewcast mcp`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `crewcast mcp` runs a stdio MCP server that exposes two tools — `decide` (the existing decider) and `catalog` (the skill list) — so Claude Code and other CLIs can call them as MCP tools.

**Architecture:** A hand-rolled JSON-RPC 2.0 server over newline-delimited stdio (no SDK — zero runtime deps). One `McpServer` class owns the protocol and a pure `handle(message)` method; tools are injected as `McpTool` objects, each in its own module, so each is tested without stdio. The `decide` tool reuses the built decide path (`SkillCatalog` → `SkillIndex` → `GitInspector` → `SystemOneClient` → `Decider`) unchanged.

**Tech Stack:** Node ≥ 22, TypeScript (ESM, NodeNext, strict), built-ins only (`readline`, `process`), `node:test` via `npx tsx --test`.

**Spec:** `docs/superpowers/specs/2026-11-20-crewcast-design.md` (§7.2 the parts / MCP tools, §7.4 decision record, §7.12 security — stdio only).

## Global Constraints

- Node `>= 22`; `"type": "module"`; the npm bin `crewcast` → `dist/bin.js`.
- **No runtime dependencies. No MCP SDK. No `postinstall`.** The MCP protocol is hand-rolled.
- **MCP over stdio only — no network port** (§7.12). The only network call anywhere is the Ollama base URL, reached by the reused decide path.
- One class per module; data stays plain types; smallest complete change (ponytail).
- Tests: `node:test` + `node:assert/strict` via `npx tsx --test`; fakes only (no real Ollama, no real MCP client); `CREWCAST_HOME` = a temp dir.
- Never log secrets. The server writes only JSON-RPC to stdout; diagnostics (if any) go to stderr.
- Default model `kev:4b-q4_K_M`; a tool `arguments.model` overrides it.
- Commits: conventional, ending with `Co-Authored-By: Claude Code <noreply@anthropic.com>`. **Do not push.**

## Review Focus

1. **A malformed line on stdin** (not JSON, or JSON that is not an object). Expected: a JSON-RPC parse error (`-32700`), the server keeps reading, no crash. → Task 1 test.
2. **A notification** (a message with no `id`, e.g. `notifications/initialized`). Expected: handled, **no response written** (a response to a notification is a protocol violation). → Task 1 test.
3. **`tools/call` with an unknown tool name.** Expected: a result with `isError: true` and a text message, not a thrown exception and not a JSON-RPC error. → Task 1 test.
4. **`decide` when Ollama is unreachable or the model is missing.** Expected: the tool returns `isError: true` with the one-line backend message; the server does not crash and keeps serving. → Task 2 test.
5. **An unknown JSON-RPC method.** Expected: a JSON-RPC error `-32601` (method not found), server keeps serving. → Task 1 test.

---

### Task 1: `McpServer` — JSON-RPC over stdio

**Files:**
- Create: `src/mcp/server.ts`
- Test: `tests/mcp-server.test.ts`

**Interfaces:**
- Consumes: nothing from crewcast yet (protocol only).
- Produces:

```ts
export interface McpContent { content: { type: 'text'; text: string }[]; isError?: boolean }
export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;              // JSON Schema for arguments
  call(args: Record<string, unknown>): Promise<McpContent>;
}
export class McpServer {
  constructor(deps: { tools: McpTool[]; serverInfo?: { name: string; version: string } });
  // Pure core: a parsed JSON-RPC message in, a response object out, or null for a notification / no-reply.
  handle(msg: unknown): Promise<object | null>;
  // Reads newline-delimited JSON from input, writes one JSON line per response to output. Ends when input ends.
  serve(input: NodeJS.ReadableStream, output: NodeJS.WritableStream): Promise<void>;
}
```

Behaviour (hand-rolled, per JSON-RPC 2.0 + MCP):
- `handle` dispatches by `method`:
  - `initialize` → `{ protocolVersion, capabilities: { tools: {} }, serverInfo }`. Use protocol version `"2025-06-18"` (builder verifies against the current MCP spec; see Left to the builder).
  - `ping` → `{}`.
  - `tools/list` → `{ tools: [{ name, description, inputSchema } …] }` from the injected tools.
  - `tools/call` → find the tool by `params.name`, run `tool.call(params.arguments ?? {})`, return its `McpContent`. Unknown name → `{ content: [{type:'text', text:"unknown tool '<name>'"}], isError: true }` (a result, not an error).
  - any other method → JSON-RPC error `-32601`.
- A message with no `id` is a **notification**: run any side effect, return `null` (no response).
- A non-object message, or missing `jsonrpc`/`method`, → error `-32600` (or `-32700` when `serve` cannot parse the line).
- `serve` reads with `readline` (`crlfDelay: Infinity`), parses each line; a parse failure writes a `-32700` error with `id: null` and continues. Each response is `JSON.stringify(resp) + "\n"`.

- [ ] **Step 1: Write failing tests** (`tests/mcp-server.test.ts`, driving `handle` directly with a fake tool)

```ts
test('initialize returns protocolVersion, tools capability and serverInfo', ...)      // handle({jsonrpc,id:1,method:'initialize'})
test('tools/list returns the injected tools name+description+inputSchema', ...)
test('tools/call routes to the named tool and returns its content', ...)              // fake tool echoes args
test('tools/call with an unknown name returns isError content, does not throw', ...)  // Review Focus 3
test('a notification (no id) returns null — no response', ...)                         // Review Focus 2
test('an unknown method returns JSON-RPC error -32601', ...)                           // Review Focus 5
test('a non-object message returns error -32600', ...)
```

- [ ] **Step 2:** `npx tsx --test tests/mcp-server.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3:** Implement `McpServer` in `src/mcp/server.ts` as specified. `serve` wraps `handle` with a `readline` loop; `handle` holds all protocol logic.
- [ ] **Step 4:** Add one `serve` test: feed a `Readable` of two JSON lines (one valid `tools/list`, one garbage), collect the `Writable`; expect one `tools/list` result line and one `-32700` line (Review Focus 1). Run the file. Expected: PASS.
- [ ] **Step 5: Commit** — `feat(mcp): hand-rolled JSON-RPC stdio server (no SDK, zero deps)`

### Task 2: `decide` tool

**Files:**
- Create: `src/mcp/decide-tool.ts`
- Test: `tests/mcp-decide-tool.test.ts`

**Interfaces:**
- Consumes: `McpTool`, `McpContent` (Task 1); `Decider` (`src/decide/decide.ts`); `SystemOneClient`, `BackendError`, `SystemOneRequest`, `SystemOneResponse` (`src/backend/systemone.ts`); `SkillCatalog`, `Skill` (`src/catalog/skills.ts`); `SkillIndex` (`src/catalog/skill-index.ts`); `GitInspector` (`src/git.ts`); `ShadowLog` (`src/shadow.ts`); `Config` (`src/paths.ts`).
- Produces:

```ts
export class DecideTool implements McpTool {
  name = 'decide';
  description: string;                 // "Decide how AI coding work runs (mode, skills, branch, agents) — local, no AI tokens."
  inputSchema: Record<string, unknown>; // { type:'object', properties:{ task:{type:'string'}, model:{type:'string'} }, required:['task'] }
  constructor(deps: {
    ask: (r: SystemOneRequest) => Promise<SystemOneResponse>;
    skills: Skill[];
    git: GitState | null;
    home: string;          // crewcast home, for the shadow log
    baseUrl: string;       // Ollama base, for SkillIndex
    defaultModel: string;  // 'kev:4b-q4_K_M'
  });
  call(args: Record<string, unknown>): Promise<McpContent>;
}
```

Behaviour:
- `call` reads `args.task` (a non-empty string; otherwise `isError` "task is required") and optional `args.model`.
- It runs `new Decider({ ask, skills, git, model, shortlist: (t,s) => new SkillIndex({ baseUrl, home }).top(t,s) }).decide(task)` — the same wiring as `Cli.decide`.
- If `rec.shadow`, append it with `new ShadowLog(home).append(rec)`.
- Returns `{ content: [{ type:'text', text: JSON.stringify(rec) }] }`.
- A `BackendError` from `decide` → `{ content: [{type:'text', text: <one-line message, same wording as the CLI>}], isError: true }`. Never throws out of `call` (Review Focus 4).

- [ ] **Step 1: Write failing tests** (fake `ask`, `CREWCAST_HOME` = temp, `skills: []`)

```ts
test('decide tool returns a DecisionRecord JSON for a task', ...)        // parse content[0].text, assert mode/version
test('missing task → isError content', ...)
test('a BackendError (ollama_unreachable) → isError content, no throw', ...)  // Review Focus 4
```

- [ ] **Step 2:** `npx tsx --test tests/mcp-decide-tool.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `DecideTool`.
- [ ] **Step 4:** Same command. Expected: PASS.
- [ ] **Step 5: Commit** — `feat(mcp): decide tool wrapping the decider`

### Task 3: `catalog` tool

**Files:**
- Create: `src/mcp/catalog-tool.ts`
- Test: `tests/mcp-catalog-tool.test.ts`

**Interfaces:**
- Consumes: `McpTool`, `McpContent` (Task 1); `Skill` (`src/catalog/skills.ts`).
- Produces:

```ts
export class CatalogTool implements McpTool {
  name = 'catalog';
  description: string;                 // "List the skills crewcast can choose from (name, description, source)."
  inputSchema: Record<string, unknown>; // { type:'object', properties:{} }
  constructor(deps: { skills: Skill[] });
  call(args: Record<string, unknown>): Promise<McpContent>;
}
```

Behaviour: `call` returns `{ content: [{ type:'text', text: JSON.stringify(skills.map(s => ({ name: s.name, description: s.description }))) }] }`. (MCP-server catalog is Phase 1c; 1a lists skills only.)

- [ ] **Step 1: Write failing test** — `catalog tool lists the injected skills' name and description`. 
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Implement `CatalogTool`.
- [ ] **Step 4:** Run it. Expected: PASS.
- [ ] **Step 5: Commit** — `feat(mcp): catalog tool listing skills`

### Task 4: wire `crewcast mcp`

**Files:**
- Modify: `src/cli.ts` (route `mcp`)
- Test: `tests/cli-mcp.test.ts`

**Interfaces:**
- Consumes: `McpServer` (Task 1), `DecideTool` (Task 2), `CatalogTool` (Task 3); `SystemOneClient`, `SkillCatalog`, `GitInspector`, `Config` (existing).
- Produces: the `mcp` subcommand. Add `'  mcp'` to `USAGE`.

Behaviour of `Cli.run(['mcp'])`:
- Load skills (`SkillCatalog.defaultDirs` + `load`), git (`GitInspector().state(cwd)`), `baseUrl`/`home` from `Config`, an `ask` from `SystemOneClient` (or the injected `this.deps.ask`).
- Build `new McpServer({ tools: [ new DecideTool({...}), new CatalogTool({ skills }) ], serverInfo: { name:'crewcast', version } })`.
- Call `server.serve(process.stdin, process.stdout)` and resolve its exit code 0 when stdin ends.
- So the mcp path can be tested without real stdio, factor the server build into a private `buildMcpServer(): Promise<McpServer>` and test **that** (assert it exposes `decide` + `catalog` via `handle({method:'tools/list'})`), rather than driving process stdio.

- [ ] **Step 1: Write failing test** — in a sandbox (`CREWCAST_HOME` temp, empty cwd/home so no real skills), build the server via the Cli and assert `tools/list` returns exactly `['decide','catalog']`.
- [ ] **Step 2:** `npx tsx --test tests/cli-mcp.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the `mcp` route and `buildMcpServer`.
- [ ] **Step 4:** `npm test && npm run typecheck && npm run build`, then a real smoke test: `printf '%s\n%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize"}' '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | node dist/bin.js mcp` prints two JSON lines, the second listing `decide` and `catalog`. Expected: all PASS.
- [ ] **Step 5: Commit** — `feat(cli): crewcast mcp — stdio MCP server exposing decide and catalog`

## Left to the builder

- Confirm the current **MCP stdio protocol version** and framing (newline-delimited JSON) against the MCP spec; adjust the `initialize` `protocolVersion` string if it has moved. The server's shape (initialize / tools/list / tools/call) is stable; only the version string is a fact to check.
- Whether `decide` over MCP should also honour a `shadow:false` argument (default keeps shadow logging on). Add only if a caller needs it — YAGNI until then.
- The exact one-line backend-error wording: reuse `Cli.backendLine`'s phrasing so CLI and MCP match; factor it to a shared helper if that avoids duplication.
