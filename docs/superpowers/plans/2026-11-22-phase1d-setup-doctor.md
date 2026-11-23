# Phase 1d — setup / doctor / uninstall Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `crewcast setup` makes crewcast work in Claude Code (engine catalog built, MCP server registered, skill + hook installed, model pre-warmed), recording everything to a manifest; `crewcast doctor` refreshes and verifies; `crewcast uninstall` reverses exactly what setup added.

**Architecture:** An `InstalledManifest` records each action setup takes (`~/.crewcast/installed.json`). `Setup` runs idempotent steps, each recorded. `Uninstall` reverses the manifest, newest first. `Doctor` re-detects engines, verifies each catalog flag against the CLI's `--help`, and pre-warms the models. Side effects (running `claude mcp add`, copying files) go through injected runners/fs so tests use fakes and temp dirs.

**Tech Stack:** Node ≥ 22, TypeScript (ESM, NodeNext, strict), built-ins only (`node:fs/promises`, `node:child_process`), `node:test` via `npx tsx --test`.

**Spec:** `docs/superpowers/specs/2026-11-20-crewcast-design.md` (§7.1 setup/doctor/uninstall + manifest, §7.5 catalogs, §7.6 doctor flag check, §7.8 skill copy, §7.11 model storage, §7.12 security, §10 verify vendor facts).

## Global Constraints

- Node `>= 22`; zero runtime dependencies; one class per module; ponytail.
- **No permission-off flags, no admin/elevation, no `postinstall`** (§7.12). Every machine change happens in `setup` and is recorded so `uninstall` reverses it.
- **`uninstall` touches only what the manifest records** — never a skill folder or config crewcast did not create (§7.12).
- **Setup is idempotent:** running it twice leaves the same state (§11).
- Tests: `node:test` + `node:assert/strict` via `npx tsx --test`; fakes only (injected `run` and a temp `CREWCAST_HOME`/home); no real `claude`, no real file outside temp dirs.
- The `claude mcp add` syntax, each CLI's skills-folder path (§7.8), and the hook-settings shape are **facts to verify** (§10); implement to the documented form and flag in Left-to-builder.
- Commits: conventional, ending with `Co-Authored-By: Claude Code <noreply@anthropic.com>`. **Do not push.**

## Review Focus

1. **`uninstall` with no manifest** (never set up, or already uninstalled). Expected: a clean "nothing to remove", exit 0, no crash. → Task 3 test.
2. **`setup` run twice.** Expected: idempotent — no duplicate manifest entries, no duplicate skill copies, same end state. → Task 2 test.
3. **A step fails mid-setup** (e.g. `claude mcp add` errors). Expected: what already succeeded is recorded so `uninstall` can still reverse it; the failure is reported, not swallowed into a half-state with no record. → Task 2 test.
4. **`doctor` on a CLI whose `--help` lacks a catalog flag.** Expected: that flag is reported stale, doctor still finishes the other checks. → Task 4 test.
5. **`uninstall` when a recorded file was already deleted by the user.** Expected: skip it, continue, no crash. → Task 3 test.

---

### Task 1: `InstalledManifest`

**Files:**
- Create: `src/install/manifest.ts`
- Test: `tests/install-manifest.test.ts`

**Interfaces:**
```ts
export type Action =
  | { kind: 'mcp'; server: string }          // registered with `claude mcp add <server>`
  | { kind: 'skillCopy'; dest: string }       // copied a skill folder to dest
  | { kind: 'dir'; path: string }             // created a dir
  | { kind: 'file'; path: string }            // wrote a file
  | { kind: 'hook'; settingsPath: string };   // added the hook to a settings file
export class InstalledManifest {
  constructor(home: string);
  async load(): Promise<Action[]>;            // missing file → []
  async record(action: Action): Promise<void>; // append, dedupe by deep-equal
  async clear(): Promise<void>;               // delete installed.json
}
```
Behaviour: persists `{ version: 1, actions: Action[] }` to `<home>/installed.json`. `record` loads, appends only if not already present (idempotency), saves. `load` on a missing/corrupt file → `[]`.

- [ ] **Step 1: Write failing tests** — record is idempotent (same action twice → one entry); load missing → []; load corrupt → []; clear removes the file.
- [ ] **Step 2:** `npx tsx --test tests/install-manifest.test.ts` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Same → PASS.
- [ ] **Step 5: Commit** — `feat(install): installed.json manifest (record, idempotent, reverse source)`

### Task 2: `Setup`

**Files:**
- Create: `src/install/setup.ts`
- Test: `tests/install-setup.test.ts`

**Interfaces:**
- Consumes: `InstalledManifest` (Task 1); `EngineCatalog` (`src/engines/catalog.ts`); `SkillCatalog` (`src/catalog/skills.ts`); `Config` (`src/paths.ts`).
```ts
export class Setup {
  constructor(deps: {
    home: string; cwd: string; baseUrl: string;
    run: (bin: string, args: string[]) => Promise<string>;        // for `claude mcp add`
    copyDir: (from: string, to: string) => Promise<void>;         // skill copy (injected fs)
    warm: (model: string) => Promise<void>;                       // pre-warm a model (ping with keep_alive)
  });
  async run(opts?: { skillTargets?: string[] }): Promise<{ steps: string[] }>; // idempotent; records every change
}
```
Behaviour (each step idempotent, each change recorded in the manifest before/after it succeeds):
1. Detect engines and save the engine catalog (`EngineCatalog.detect` + `save`).
2. Register the MCP server: `run('claude', ['mcp','add','--scope','user','crewcast','--','crewcast','mcp'])`; record `{kind:'mcp',server:'crewcast'}`. If already recorded, skip (idempotent).
3. Install the crewcast skill: `copyDir(<repo>/skills/crewcast, <home>/.claude/skills/crewcast)`; record `skillCopy`.
4. Copy selected skills to other installed CLIs' skill dirs (§7.8); record each.
5. Pre-warm: `warm('mxbai-embed-large')` and `warm('kev:4b-q4_K_M')` (closes the cold-start gap found in 1c).
6. Return the list of steps done. On a step error, the steps already recorded stay in the manifest, and `run` rejects with the failing step named (Review Focus 3).

- [ ] **Step 1: Write failing tests** (fake `run`/`copyDir`/`warm`, temp home) — a clean run records mcp+skillCopy+…; **run twice → no duplicate manifest entries** (Review Focus 2); a failing `claude mcp add` → rejects naming the step, but the engine-catalog step before it is still recorded (Review Focus 3); `warm` is called for both models.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** — `feat(install): crewcast setup — catalogs, MCP register, skill+hook, pre-warm (idempotent)`

### Task 3: `Uninstall`

**Files:**
- Create: `src/install/uninstall.ts`
- Test: `tests/install-uninstall.test.ts`

**Interfaces:**
- Consumes: `InstalledManifest` (Task 1).
```ts
export class Uninstall {
  constructor(deps: { home: string; run: (bin: string, args: string[]) => Promise<string>; rmDir: (path: string) => Promise<void> });
  async run(): Promise<{ removed: string[] }>; // reverse the manifest newest-first, then clear it
}
```
Behaviour: load the manifest; reverse each action newest-first — `mcp` → `run('claude',['mcp','remove','crewcast'])`; `skillCopy`/`dir` → `rmDir(path)`; `hook` → remove the hook entry; `file` → delete. A target already gone is skipped (Review Focus 5). An empty/missing manifest → `{ removed: [] }`, no crash (Review Focus 1). Then `clear()` the manifest.

- [ ] **Step 1: Write failing tests** — reverses recorded actions newest-first; missing manifest → `{removed:[]}`; an already-deleted target is skipped, the rest still removed.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** — `feat(install): crewcast uninstall — reverse the manifest exactly`

### Task 4: `Doctor`

**Files:**
- Create: `src/install/doctor.ts`
- Test: `tests/install-doctor.test.ts`

**Interfaces:**
- Consumes: `EngineCatalog`, `Engine` (`src/engines/catalog.ts`).
```ts
export interface DoctorReport { engines: { id: string; installed: boolean; staleFlags: string[] }[]; warmed: string[] }
export class Doctor {
  constructor(deps: { baseUrl: string; run: (bin: string, args: string[]) => Promise<string>; warm: (model: string) => Promise<void> });
  async run(engines?: Engine[]): Promise<DoctorReport>;
}
```
Behaviour: for each installed engine, run `<bin> --help`; a catalog flag token (the first token of each of `writeFlags`/`readFlags`/`modelFlag`/`effortArgs`/`safeFlags`) that does not appear in the help text is a `staleFlag` (closes the 1b vendor-fact gap). Pre-warm `mxbai-embed-large` and `kev:4b-q4_K_M` via `warm`. A CLI whose `--help` errors → `installed:false`, no stale list, continue (Review Focus 4).

- [ ] **Step 1: Write failing tests** (fake `run` returning fake help text) — a flag present in help → not stale; a flag absent → listed stale; help errors → engine skipped, others still checked; both models warmed.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** — `feat(install): crewcast doctor — verify catalog flags via --help, pre-warm models`

### Task 5: wire `setup` / `doctor` / `uninstall`

**Files:**
- Modify: `src/cli.ts`
- Test: `tests/cli-install.test.ts`

**Interfaces:**
- Consumes: `Setup`, `Doctor`, `Uninstall`, `InstalledManifest`, `Config`, `EngineCatalog`. Default `run` = execFile (shell:true), `copyDir`/`rmDir` = `fs.cp`/`fs.rm`, `warm` = POST `/api/embed` or `/v1/systemone` with `keep_alive:'30m'`.
- Produces: `crewcast setup`, `crewcast doctor`, `crewcast uninstall`. Add each to `USAGE`.

Behaviour: each command builds the class with real default deps and the paths from `Config`, runs it, and prints a short ASD-STE100 summary (steps done / report / removed). Factor the builders so a test injects fakes (as `buildMcpServer` is tested).

- [ ] **Step 1: Write failing test** — in a sandbox with fakes, `setup` then `uninstall` round-trips: after setup the manifest has entries; after uninstall it is gone and the fake `run` saw `mcp add` then `mcp remove`.
- [ ] **Step 2:** `npx tsx --test tests/cli-install.test.ts` → FAIL.
- [ ] **Step 3:** Implement the three routes + default deps.
- [ ] **Step 4:** `npm test && npm run typecheck && npm run build` → all PASS. Smoke (manual, owner's machine, reversible): `node dist/bin.js doctor` reports the real CLIs + stale flags; `node dist/bin.js setup` then `node dist/bin.js uninstall`.
- [ ] **Step 5: Commit** — `feat(cli): crewcast setup / doctor / uninstall`

## Left to the builder

- **Verify vendor facts** (§10): the exact `claude mcp add` invocation and scope flag; each non-Claude CLI's skills-folder path for skill-copy (§7.8); the Claude Code hook-settings shape for the `hook` action (how setup installs the UserPromptSubmit hook — a settings.json entry vs the plugin manifest). Implement to the documented form; the manifest makes every change reversible, so a wrong path is recorded and undone, not left behind.
- **Model storage / `OLLAMA_MODELS`** checks (§7.11) are a doctor enhancement; add if the owner wants the free-space guidance now, else defer.
- **MCP catalog of other servers** (§7.5 — start each configured MCP server, read its tools, save a one-line description) is a separable decider-input feature, **carved out of 1d** to keep the install lifecycle focused; track it as a follow-up (1e) or fold into Phase 2's catalog needs. It does not block setup/doctor/uninstall.
