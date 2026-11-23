# Phase 2d/2e — Dispatch + Plan-Mode Hook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Start a team run from a `plan.md` allocation — each writing worker in its own worktree, each able to post to the mailbox — and let the plan-mode approval trigger it. The orchestration is unit-tested with a fake spawner; the real two-engine run is the owner's live acceptance gate (§8).

**Architecture:** A `Dispatcher` turns a `PlanAllocation` (2c) into worker processes: it creates a worktree (2b) per writing unit, builds a task card plus injected skill text, resolves the engine's headless command, launches each via an injected `spawn`, and writes a run-state file. `dispatch`/`run_status` MCP tools wrap it; `run_status` also reports per-writer file-ownership (2b). A Claude Code `PostToolUse`/`ExitPlanMode` hook path reads `plan.md` and calls dispatch (fail-open).

**Tech Stack:** Node ≥22, TypeScript strict, ESM/NodeNext, zero runtime deps. Tests: `node:test` via `npx tsx --test`, fakes only (fake `spawn`, temp git repo, temp `CREWCAST_HOME`).

**Spec:** `docs/superpowers/specs/2026-11-20-crewcast-design.md` (§7.7 dispatch/mailbox/worktrees, §7.8 skill delivery, §7.13 captain, §7.14 plan-mode trigger, §8). Overview: `docs/superpowers/plans/2026-11-22-phase2-overview.md`. Builds on `Mailbox` (2a), `WorktreeManager` (2b), `PlanAllocator`/`UnitAllocation` (2c), `EngineCatalog`/`Engine` (1b), the MCP server (1a).

## Global Constraints

- Zero runtime dependencies; Node ≥22; TypeScript strict; OOP one-class-per-module.
- **Confirmed headless invocations (research 2026-11-22):** Codex `codex exec "<task>"`; Copilot `copilot -p "<task>"` (+ its safe flags); Antigravity `agy -p "<task>"` (replaces the retired Gemini CLI). These are the `headless` templates already in `DEFAULT_ENGINES`. Claude is the captain (lead), not spawned as a worker.
- **Skills to workers (§7.8):** the chosen skills' text is injected into the worker's prompt (`skillText`), not a folder — the only path confirmed for all worker CLIs. Only the picked skills, so the prompt stays small.
- **Security (§3, §7.7):** `spawn` for a worker runs the trusted engine `bin` with the resolved catalog args; **never `shell:true`** (task text must never reach a shell), unlike the catalog's detection runner. Workers never run with permission checks off.
- **Antigravity on Windows:** `agy -p` can hang unless the child's stdin is closed — the default `spawn` closes stdin.

## Process model (RULING — safety invariant wins)

§7.7 says both "one process per engine group" *and* "no two writers ever share a folder." These conflict when several writing units share an engine. **Ruling:** one process **per writing unit**, each in its own worktree (the no-shared-folder rule is a stated safety invariant with a past-incident justification); read-only units (no owned files) are grouped one process per engine in the main repo. The "one Codex run uses its own subagents" optimization is deferred. Cost if wrong: more worker processes than the minimum; no correctness or safety loss. Say so to change it.

## Review Focus

1. **`spawn` must not use a shell.** Expected: the worker command is `bin` + trusted args + the prompt, never passed through a shell (task text injection). → Task 1 test asserts the fake spawn's `shell` is never true and the prompt is carried as stdin/arg, not interpolated into a command string.
2. **A writing unit gets its own worktree; a read-only unit does not.** Expected: writers → distinct worktree cwd; readers → repo root. → Task 1 test.
3. **A worker can reach its mailbox.** Expected: the task card carries the run id and the worker's launch has the per-run MCP config/env so `post_message` lands in that run. → Task 1 test (assert the card + env).
4. **`run_status` reports ownership violations.** Expected: a writer whose changed files leave its owned set shows `ok:false` + the outside files. → Task 2 test.
5. **The plan-mode hook is fail-open and fires only on `ExitPlanMode`.** Expected: a non-ExitPlanMode payload → no dispatch, exit 0; a malformed payload → no throw. → Task 4 test.

---

### Task 1: Dispatcher core

**Files:**
- Create: `src/dispatch/dispatcher.ts`
- Test: `tests/dispatcher.test.ts`

**Interfaces:**
- Consumes: `UnitAllocation`/`PlanAllocation` (2c), `Engine` (1b), `WorktreeManager`/`Worktree` (2b), `Mailbox` (2a).
- Produces:
  - `interface WorkerRecord { unit: string; engine: string; group: number; cwd: string; worktree: Worktree | null; files: string[]; pid: number }` (`files` = the unit's owned files, needed by Task 2's ownership check)
  - `interface RunState { run: string; startedAt: string; workers: WorkerRecord[] }`
  - `class Dispatcher` with `constructor(deps: { worktrees: WorktreeManager; mailbox: Mailbox; runsHome: string; spawn: (bin: string, args: string[], opts: { cwd: string; input: string; env: Record<string,string> }) => Promise<{ pid: number }>; skillText: (names: string[]) => Promise<string>; mcpConfig: (run: string) => Record<string,string>; now?: () => number })`
  - `dispatch(alloc: PlanAllocation, opts: { run: string; repoRoot: string; engines: Engine[] }): Promise<RunState>`

**Behavior:** per unit — writer (files.length>0) → `worktrees.create(engine, n)`, cwd = its path; reader → cwd = repoRoot, worktree null. Build `prompt` = task card (goal = description, owned files, done = "report via post_message to run <run>", mailbox run id) + `await skillText(unit.skills)`. Resolve command: look up the `Engine` by `unit.engine`, substitute `{task}` in `engine.headless` with the prompt, append `unit.args`; the result is `bin` + args (prompt may be passed as the `{task}` arg or via `opts.input` — pass via `opts.input` and keep `{task}` as a placeholder the engine reads from stdin where supported, else the arg). `spawn(bin, args, { cwd, input: prompt, env: mcpConfig(run) })`. Record the worker. Persist `RunState` to `<runsHome>/<run>/run.json`.

- [ ] **Step 1: Write the failing test** — fake `spawn` recording `(bin,args,opts)`, fake `skillText` returning `"<skill text>"`, a real `WorktreeManager` on a temp git repo, a `Mailbox` on temp home. Allocation of one writer (files) + one reader (no files). Assert: writer's `cwd` is a worktree path, reader's `cwd` is the repo root; `spawn` was never called with `shell:true`; the prompt (opts.input) contains the run id and the skill text; `run.json` written with both workers. (shortcut comment: prompt via stdin/arg, not shell interpolation.)
- [ ] **Step 2: Run, verify it fails** — module not found.
- [ ] **Step 3: Implement `src/dispatch/dispatcher.ts`.**
- [ ] **Step 4: Run, verify it passes.**
- [ ] **Step 5: Commit** — `feat(dispatch): Dispatcher — worktree per writer, task card + skills, spawn workers`.

---

### Task 2: Run state + ownership (`status`)

**Files:**
- Modify: `src/dispatch/dispatcher.ts`
- Test: `tests/dispatcher-status.test.ts`

**Interfaces:**
- Produces on `Dispatcher`:
  - `interface RunStatus { run: string; workers: (WorkerRecord & { messages: number; ownership: { ok: boolean; outside: string[] } | null })[] }`
  - `status(run: string): Promise<RunStatus>` — reads `<runsHome>/<run>/run.json`; for each worker, counts mailbox messages (`mailbox.read(run)` filtered by `from === unit`) and, for a writer, runs `worktrees.ownership(worktree, ownedFiles)`; a reader's `ownership` is `null`.

- [ ] **Step 1: Write the failing test** — after a dispatch, a writer worktree edits a file outside its owned list; `status(run)` shows that worker's `ownership.ok === false` with the outside file; a reader worker shows `ownership === null`; message counts reflect posts. (Uses `WorkerRecord.files` stored in `run.json` by Task 1.)
- [ ] **Step 2: Run, verify it fails.**
- [ ] **Step 3: Implement `status`.**
- [ ] **Step 4: Run, verify it passes.**
- [ ] **Step 5: Commit** — `feat(dispatch): run_status — mailbox counts + per-writer ownership`.

---

### Task 3: `dispatch` / `run_status` MCP tools

**Files:**
- Create: `src/mcp/dispatch-tool.ts`, `src/mcp/run-status-tool.ts`
- Modify: `src/cli.ts` (`buildMcpServer`)
- Test: `tests/mcp-dispatch-tools.test.ts`, extend `tests/cli-mcp.test.ts`

**Interfaces:**
- `class DispatchTool implements McpTool` — `name='dispatch'`, input `{ plan: string (path or markdown), run?: string }`; parses + allocates (reusing `parsePlan`/`PlanAllocator`) and calls `Dispatcher.dispatch`; returns the `RunState` JSON; bad input → `isError`.
- `class RunStatusTool implements McpTool` — `name='run_status'`, input `{ run: string }`; returns `Dispatcher.status(run)` JSON; bad input → `isError`.
- `buildMcpServer` constructs a `Dispatcher` (with the default real `spawn`/`skillText`/`mcpConfig`) and adds both tools. `tools/list` now has six tools.

- [ ] **Step 1: Write the failing test** — tool-level: a `DispatchTool` over fakes dispatches a 1-unit plan and returns a `run`; `RunStatusTool` returns its status. cli-mcp: `tools/list` includes `dispatch` and `run_status`.
- [ ] **Step 2: Run, verify it fails.**
- [ ] **Step 3: Implement the tools + registration.** Default `spawn`: `child_process.spawn(bin, args, { cwd, stdio: ['pipe','ignore','ignore'], detached: true })`, write `input` to stdin then end it (closes stdin — the agy Windows fix), `unref()`. Default `skillText`: read each picked skill's `SKILL.md` and concatenate. Default `mcpConfig(run)`: env that points a worker's crewcast MCP at this run (e.g. `CREWCAST_RUN=<run>`).
- [ ] **Step 4: Run, verify it passes.**
- [ ] **Step 5: Commit** — `feat(mcp): dispatch and run_status tools`.

---

### Task 4: Plan-mode dispatch hook (2e)

**Files:**
- Modify: `src/cli.ts` (the `hook` path)
- Test: `tests/cli-plan-hook.test.ts`

**Interfaces:**
- Extend the existing `crewcast hook` handler: if the hook payload is a `PostToolUse` event whose `tool_name === 'ExitPlanMode'`, read `plan.md` from the cwd (or the plan path in the payload), allocate, and dispatch; otherwise fall through to the existing UserPromptSubmit behavior. Fail-open: any error or a non-matching payload → emit nothing, exit 0.

- [ ] **Step 1: Write the failing test** — feed a `PostToolUse`/`ExitPlanMode` JSON payload on stdin with a plan.md present (inject a fake dispatch seam); assert dispatch was called with the plan. Feed a non-ExitPlanMode payload → dispatch not called, exit 0. Feed malformed JSON → no throw, exit 0.
- [ ] **Step 2: Run, verify it fails.**
- [ ] **Step 3: Implement.** Add the `ExitPlanMode` branch to the hook. Keep it fail-open. (Live check, owner: confirm the event fires and its payload shape on the owner's Claude Code version — §7.14.)
- [ ] **Step 4: Run the whole suite** — `npx tsx --test tests/*.test.ts`; then `npm run typecheck && npm run build`.
- [ ] **Step 5: Commit** — `feat(cli): dispatch on plan-mode approval (ExitPlanMode hook)`.

## Live acceptance (owner-run, not unit-testable)

After merge, the owner runs the §8 gate: a trivial two-unit `plan.md` (one Codex unit, one Antigravity unit), approves the plan, and watches both workers post progress to the mailbox mid-task. This confirms (a) the `ExitPlanMode` hook fires, (b) the real headless commands and allow flags are right, and (c) the mailbox round-trip works — none of which the fake-spawner unit tests can prove.
