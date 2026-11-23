# Phase 2a — Mailbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A per-run message log the captain and workers talk over, exposed as MCP tools `post_message` and `read_messages`.

**Architecture:** One JSONL file per run at `<crewHome>/runs/<run>/mailbox.jsonl`. `post` appends one redacted JSON line; `read` returns entries after a cursor. Sequence is the 1-based line index derived at read time, so concurrent writers never coordinate on a counter. Two thin `McpTool`s wrap the `Mailbox` class and register in the existing `buildMcpServer()`.

**Tech Stack:** Node ≥22, TypeScript strict, ESM/NodeNext, zero runtime deps. Tests: `node:test` via `npx tsx --test`, fakes only, `CREWCAST_HOME`=temp dir.

**Spec:** `docs/superpowers/specs/2026-11-20-crewcast-design.md` (§7.7). Overview: `docs/superpowers/plans/2026-11-22-phase2-overview.md`.

## Global Constraints

- Zero runtime dependencies; Node ≥22; ESM/NodeNext; TypeScript strict; OOP one-class-per-module.
- Reuse `ShadowLog.readJsonl<T>` (`src/shadow.ts:19`) for reading — it skips blank and corrupt lines and treats a missing file as empty.
- Crew home comes from `Config.home` (`src/paths.ts:7`), `CREWCAST_HOME` or `~/.crewcast`.
- `McpTool` interface (`src/mcp/server.ts:4`): `{ name, description, inputSchema, call(args) }`; `call` returns `McpContent` (`{ content: [{type:'text',text}], isError? }`). Follow `DecideTool` (`src/mcp/decide-tool.ts`) for shape and error style.
- Tool args arrive as `Record<string, unknown>` from JSON-RPC — validate every field at that boundary.

## Review Focus

1. **Path traversal via `run`** (`../../x`, absolute, or with a separator). Expected: rejected, nothing written outside `<crewHome>/runs/`. → Task 1 test.
2. **`read` with `since` past the end** (or an empty/missing run). Expected: `{ messages: [], cursor: <count> }`, no crash. → Task 1 test.
3. **A corrupt or hand-edited line in the file.** Expected: that line is skipped, the other messages still return, seq stays the 1-based index of the surviving lines. → Task 1 test.
4. **Redaction** — a real key-shaped token is masked; ordinary prose is left alone. Expected: `sk-…`, `Bearer …`, and `password=…` masked to `***`; a normal sentence unchanged. → Task 1 test.
5. **Missing tool args** (`post_message` with no `text`, `read_messages` with no `run`). Expected: `isError` with a clear message, no throw to the server. → Task 2 test.

---

### Task 1: Mailbox

**Files:**
- Create: `src/mailbox.ts`
- Test: `tests/mailbox.test.ts`

**Interfaces:**
- Produces:
  - `interface Message { ts: string; from: string; text: string }`
  - `interface MailboxEntry extends Message { seq: number }` (seq = 1-based line index)
  - `class Mailbox` with `constructor(home: string)` (home = crew home; file is `join(home,'runs',run,'mailbox.jsonl')`)
  - `post(run: string, from: string, text: string): Promise<void>` — validates `run`, `mkdir -p` the run dir, appends one line `JSON.stringify({ ts: new Date().toISOString(), from, text: Mailbox.redact(text) }) + '\n'`.
  - `read(run: string, since?: number): Promise<{ messages: MailboxEntry[]; cursor: number }>` — `since` default 0; reads via `ShadowLog.readJsonl<Message>`, assigns `seq` = 1-based index, returns entries with `seq > since` and `cursor` = total line count.
  - `static redact(text: string): string`
  - A private/exported `safeRun(run)` guard (throws on empty, absolute, `..`, or path separators).

- [ ] **Step 1: Write the failing test** — `tests/mailbox.test.ts`, `CREWCAST_HOME`=temp dir, covering:
  - post two messages to run `r1`; `read('r1')` → 2 entries, `seq` 1 and 2, `cursor` 2, `from`/`text` preserved, `ts` an ISO string.
  - `read('r1', 1)` → only the seq-2 entry; `read('r1', 2)` → `[]`, `cursor` 2.
  - `read('nope')` (no file) → `{ messages: [], cursor: 0 }`.
  - after writing a garbage line into the file by hand, `read` skips it and returns the valid entries with contiguous seq over the surviving lines.
  - `Mailbox.redact('token sk-ABCD1234efgh5678 and password=hunter2 ok')` masks the key and the pair to `***` but keeps the surrounding words; `redact('a normal sentence about keys and tokens')` is unchanged.
  - `post('../escape', …)` and `post('a/b', …)` reject (assert.rejects).

- [ ] **Step 2: Run the test, verify it fails** — `npx tsx --test tests/mailbox.test.ts` → FAIL (module not found / undefined).

- [ ] **Step 3: Implement `src/mailbox.ts`.** `post`/`read` as above. `redact`: a small high-confidence set applied in order — provider prefixes (`sk`, `ghp`, `github_pat`, `gho|ghu|ghs|ghr`, `xox[baprs]`, `AKIA`) followed by `[-_][A-Za-z0-9_-]{8,}`; `Bearer <token>`; `\b(password|passwd|secret|token|api[_-]?key|apikey|auth)\b\s*[:=]\s*\S+`; and a trailing catch for a standalone opaque run `\b[A-Za-z0-9+/_-]{32,}={0,2}\b`. Each match → `***`. Add the comment `// shortcut: pattern-based key redaction, not an entropy scanner; tighten the ≥32 catch if it masks non-secret ids`.

- [ ] **Step 4: Run the test, verify it passes.**

- [ ] **Step 5: Commit** — `feat(mailbox): per-run JSONL message log with redaction and a read cursor`.

---

### Task 2: post_message / read_messages MCP tools

**Files:**
- Create: `src/mcp/post-message-tool.ts`, `src/mcp/read-messages-tool.ts`
- Test: `tests/mcp-mailbox-tools.test.ts`

**Interfaces:**
- Consumes: `Mailbox` (Task 1), `McpTool`/`McpContent` (`src/mcp/server.ts`).
- Produces:
  - `class PostMessageTool implements McpTool` — `name='post_message'`, `inputSchema` requires `run`, `from`, `text` (all strings); `constructor(deps:{ mailbox: Mailbox })`; `call` validates the three strings (non-empty), `post`s, returns `{ content:[{type:'text',text:'ok'}] }`; a missing/empty field or a thrown guard → `isError` content with the reason.
  - `class ReadMessagesTool implements McpTool` — `name='read_messages'`, `inputSchema` requires `run` (string), optional `since` (number); `constructor(deps:{ mailbox: Mailbox })`; `call` validates `run`, coerces `since` (default 0, reject a non-number that is present), returns `{ content:[{type:'text',text:JSON.stringify(await mailbox.read(run,since))}] }`; bad args → `isError`.

- [ ] **Step 1: Write the failing test** — construct each tool with a `Mailbox` on a temp home. `post_message` with `{run:'r',from:'w1',text:'hi'}` → ok, then `read_messages` `{run:'r'}` → parsed `{messages:[{seq:1,from:'w1',text:'hi',ts}],cursor:1}`. `post_message` `{run:'r',from:'w1'}` (no text) → `isError`. `read_messages` `{}` (no run) → `isError`. `read_messages` `{run:'r',since:'x'}` → `isError`.

- [ ] **Step 2: Run, verify it fails.**

- [ ] **Step 3: Implement both tool modules.** Mirror `DecideTool`'s validate-then-call-then-catch shape; one static `err(text)` helper per class.

- [ ] **Step 4: Run, verify it passes.**

- [ ] **Step 5: Commit** — `feat(mcp): post_message and read_messages tools over the mailbox`.

---

### Task 3: Register the tools in the MCP server

**Files:**
- Modify: `src/cli.ts` (`buildMcpServer`, ~line 130)
- Test: `tests/cli-mcp.test.ts` (extend the existing file)

**Interfaces:**
- Consumes: `PostMessageTool`, `ReadMessagesTool` (Task 2), `Mailbox` (Task 1).
- Produces: `buildMcpServer` constructs a `Mailbox(this.crewcastHome())` and adds both tools to the `tools` array.

- [ ] **Step 1: Write the failing test** — drive `buildMcpServer()` (as the existing cli-mcp test does): `tools/list` includes `post_message` and `read_messages` alongside `decide` and `catalog`; a `tools/call` `post_message` then `tools/call` `read_messages` round-trips one message through `server.handle`.

- [ ] **Step 2: Run, verify it fails** (only `decide`/`catalog` listed).

- [ ] **Step 3: Implement** — add `const mailbox = new Mailbox(crewHome);` and `new PostMessageTool({ mailbox })`, `new ReadMessagesTool({ mailbox })` to the `tools` array.

- [ ] **Step 4: Run the whole suite** — `npx tsx --test tests/*.test.ts` → all pass; then `npm run typecheck && npm run build`.

- [ ] **Step 5: Commit** — `feat(mcp): register mailbox tools in the crewcast MCP server`.
