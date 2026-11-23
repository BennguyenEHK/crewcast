# Phase 1b — engine catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the engine catalog — detect the installed CLIs and hold, per CLI, the facts and the flags-by-rules needed to launch it: working models, effort flag, parallel limit, safe auto-approve flags, and a resolver that turns decision signals into the model/effort/flags to use.

**Architecture:** `EngineCatalog` detects CLIs by probing `<bin> --version` through an injected runner (fakes in tests). A seed data table `DEFAULT_ENGINES` carries the per-CLI recipes from spec §7.6 (vendor facts, verified by the builder / later by `doctor`). A pure `resolveFlags(engine, signals, task)` turns a decision's signals into `{ model, effort, args }` — this is the *definition* of how flags are chosen; Phase 2 *applies* it per work unit. The catalog persists to `~/.crewcast/engine-catalog.json`.

**Tech Stack:** Node ≥ 22, TypeScript (ESM, NodeNext, strict), built-ins only (`node:child_process` `execFile`, `node:fs/promises`), `node:test` via `npx tsx --test`.

**Spec:** `docs/superpowers/specs/2026-11-20-crewcast-design.md` (§7.6 engine catalog + flags-by-rules, §7.3 model/effort/mode in v1, §10 "verify vendor facts", §7.12 no unsafe flags).

## Global Constraints

- Node `>= 22`; `"type": "module"`; zero runtime dependencies; one class per module; ponytail (smallest complete change).
- Tests: `node:test` + `node:assert/strict` via `npx tsx --test`; fakes only — the CLI runner is injected, so no real CLI is spawned in tests; `CREWCAST_HOME` = a temp dir.
- **A model never picks a flag.** `resolveFlags` chooses only from the engine's own recipe fields; it can never emit `--yolo`, `--dangerously-skip-permissions`, `--allow-all-paths` or similar (§7.12). Those strings appear nowhere in `DEFAULT_ENGINES`.
- The per-CLI recipes in `DEFAULT_ENGINES` are **seed facts to verify** (§10); `doctor` (Phase 1d) checks each flag against `<cli> --help`. 1b does not block on their exactness.
- Default decision model `kev:4b-q4_K_M` is unrelated here — this is about the *worker* CLIs' models.
- Commits: conventional, ending with `Co-Authored-By: Claude Code <noreply@anthropic.com>`. **Do not push.**

## Review Focus

1. **A CLI not on PATH** (its `--version` throws ENOENT). Expected: `installed: false`, no version, no crash; detection continues to the next CLI. → Task 1 test.
2. **A CLI whose `--version` errors or prints garbage.** Expected: `installed: false` (or installed with `version: null`), never a throw. → Task 1 test.
3. **A CLI with its own auto mode** (Kiro, `autoMode: true`). Expected: `resolveFlags` does not choose a model or effort — it defers to the CLI (§7.3). → Task 2 test.
4. **A corrupt or missing `engine-catalog.json`.** Expected: `load` returns `DEFAULT_ENGINES`, never throws. → Task 3 test.
5. **A risky task** (`risk_area` other than `none`). Expected: `resolveFlags` picks the engine's `strongModel` and high effort (§7.3). → Task 2 test.

---

### Task 1: Engine types, seed data, and detection

**Files:**
- Create: `src/engines/catalog.ts`
- Test: `tests/engines-catalog.test.ts`

**Interfaces:**
- Consumes: nothing from crewcast.
- Produces:

```ts
export interface Engine {
  id: string;                 // 'claude' | 'gemini' | 'codex' | 'copilot' | 'kiro'
  bin: string;                // executable on PATH, e.g. 'codex'
  versionArgs: string[];      // e.g. ['--version']
  headless: string[];         // run template with a {task} token, e.g. ['-p', '{task}']
  models: string[];           // working models (seed; first is the default)
  strongModel: string | null; // model for risky tasks, or null
  modelFlag: string | null;   // e.g. '--model', or null if model is not a flag
  effortFlag: string | null;  // e.g. '-c model_reasoning_effort={effort}', or null
  highEffort: string | null;  // the value for high effort, e.g. 'high'
  parallelLimit: number;      // concurrent runs this CLI allows
  writeFlags: string[];       // sandbox/write flags, e.g. ['--sandbox','workspace-write']
  readFlags: string[];        // read-only flags
  safeFlags: string[];        // always-on safe flags (never permission-off)
  autoMode: boolean;          // CLI has its own auto mode → crewcast stops choosing model/effort
  installed?: boolean;
  version?: string | null;
}
export const DEFAULT_ENGINES: Engine[];   // claude, gemini, codex, copilot, kiro — seeded from spec §7.6
export class EngineCatalog {
  constructor(deps?: { run?: (bin: string, args: string[]) => Promise<string> }); // run resolves stdout; default = execFile
  detect(engines?: Engine[]): Promise<Engine[]>;  // probes each bin's versionArgs; sets installed + version
}
```

Behaviour:
- `DEFAULT_ENGINES` seeds the five CLIs with the §7.6 recipes, e.g. codex `writeFlags: ['--sandbox','workspace-write']`, `readFlags: ['--sandbox','read-only']`, `modelFlag: '--model'`, `effortFlag: "-c model_reasoning_effort={effort}"`, `highEffort: 'high'`; kiro `autoMode: true`. No permission-off flag anywhere.
- `detect` runs `run(bin, versionArgs)` per engine; success → `installed: true`, `version` = the trimmed first line; failure (throw/ENOENT/non-zero) → `installed: false`, `version: null`. One engine's failure never aborts the rest.

- [ ] **Step 1: Write failing tests** (fake `run`)

```ts
test('detect marks a CLI installed with its version when --version succeeds', ...)  // fake run returns "1.2.3" for 'codex'
test('a CLI not on PATH (run throws ENOENT) → installed false, no crash', ...)       // Review Focus 1
test('a CLI whose --version throws → installed false, version null, others still detected', ...) // Review Focus 2
test('DEFAULT_ENGINES contains no permission-off flag', ...)  // assert none of writeFlags/readFlags/safeFlags match /yolo|skip-permissions|allow-all-paths|dangerous/i
```

- [ ] **Step 2:** `npx tsx --test tests/engines-catalog.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `Engine`, `DEFAULT_ENGINES`, `EngineCatalog.detect`. Default `run` wraps `execFile` (promisified), returning stdout.
- [ ] **Step 4:** Same command. Expected: PASS.
- [ ] **Step 5: Commit** — `feat(engines): engine catalog types, seed recipes and CLI detection`

### Task 2: `resolveFlags` — signals → model, effort, flags

**Files:**
- Create: `src/engines/flags.ts`
- Test: `tests/engines-flags.test.ts`

**Interfaces:**
- Consumes: `Engine` (Task 1); `RiskArea`, `Size` (`src/decide/record.ts`).
- Produces:

```ts
export interface ResolveSignals { writes_files: boolean | null; risk_area: RiskArea | null; size: Size | null }
export interface Resolved { model: string; effort: string | null; args: string[] }  // args = sandbox + model + effort + safe, NOT the task
export function resolveFlags(engine: Engine, signals: ResolveSignals): Resolved;
```

Behaviour (the flags-by-rules definition, §7.6/§7.3):
- **Auto-mode CLI** (`engine.autoMode`): `model: 'default'`, `effort: null`, `args: [...engine.safeFlags]`. crewcast chooses nothing else (Review Focus 3).
- Otherwise:
  - `risky = signals.risk_area !== null && signals.risk_area !== 'none'`.
  - `model = risky && engine.strongModel ? engine.strongModel : (engine.models[0] ?? 'default')`.
  - `effort = (risky || signals.size === 'many_files') ? engine.highEffort : null`.
  - `args`: start with `engine.safeFlags`; append `writeFlags` when `writes_files === true`, else `readFlags`; append `modelFlag model` when `modelFlag` and a non-'default' model; append the `effortFlag` with `{effort}` filled when `effort` and `effortFlag`.
- Pure and deterministic; it emits only strings drawn from `engine`'s own fields.

- [ ] **Step 1: Write failing tests**

```ts
test('risky task → strong model and high effort', ...)                 // Review Focus 5: codex + risk auth
test('writes_files true → write sandbox flags; false → read-only flags', ...)
test('many_files size → high effort even when risk none', ...)
test('auto-mode engine (kiro) → model default, effort null, only safe flags', ...)  // Review Focus 3
test('resolveFlags emits no flag outside the engine recipe', ...)       // every arg is in engine.{safe,write,read,model,effort}-derived set
```

- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Implement `resolveFlags`.
- [ ] **Step 4:** Run it. Expected: PASS.
- [ ] **Step 5: Commit** — `feat(engines): resolveFlags — decision signals to model, effort and flags`

### Task 3: persist and load the catalog

**Files:**
- Modify: `src/engines/catalog.ts` (add `save` / `load`)
- Test: `tests/engines-catalog.test.ts` (extend)

**Interfaces:**
- Produces (added to `EngineCatalog`):

```ts
save(engines: Engine[], home: string): Promise<void>;   // writes <home>/engine-catalog.json
static load(home: string): Promise<Engine[]>;           // reads it; missing/corrupt → DEFAULT_ENGINES
```

Behaviour: `save` writes pretty JSON (mkdir -p home first). `load` parses `<home>/engine-catalog.json`; a missing file or a parse error returns `DEFAULT_ENGINES` (Review Focus 4), never throws.

- [ ] **Step 1: Write failing tests** (`CREWCAST_HOME` temp)

```ts
test('save then load round-trips the detected engines', ...)
test('load with no file returns DEFAULT_ENGINES', ...)
test('load on a corrupt json returns DEFAULT_ENGINES, no throw', ...)   // Review Focus 4
```

- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Implement `save` / `load`.
- [ ] **Step 4:** Run it. Expected: PASS.
- [ ] **Step 5: Commit** — `feat(engines): persist and load the engine catalog`

### Task 4: `crewcast engines` command

**Files:**
- Modify: `src/cli.ts` (route `engines`; add optional `run` to the injectable deps)
- Test: `tests/cli-engines.test.ts`

**Interfaces:**
- Consumes: `EngineCatalog`, `DEFAULT_ENGINES` (Tasks 1, 3), `resolveFlags` (Task 2), `Config` (existing).
- Produces: `crewcast engines [--json]`. Add `'  engines [--json]'` to `USAGE`. Add `run?: (bin, args) => Promise<string>` to the `Cli` deps type (tests inject a fake; production uses the default execFile runner).

Behaviour of `Cli.run(['engines'])`:
- `const engines = await new EngineCatalog({ run: this.deps.run }).detect();`
- Persist with `save(engines, crewcastHome())`.
- `--json` → print the engines array as one JSON line.
- Otherwise print one line per engine: `id — installed/absent, version, models[0], parallelLimit`.

- [ ] **Step 1: Write failing test** — in a sandbox with a fake `run` that reports two CLIs installed, assert `engines --json` prints JSON whose installed ids match, and the file is written.
- [ ] **Step 2:** `npx tsx --test tests/cli-engines.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the route + the deps `run`.
- [ ] **Step 4:** `npm test && npm run typecheck && npm run build`. Expected: all PASS. Smoke: `node dist/bin.js engines` on the owner's machine lists the real CLIs (manual, optional).
- [ ] **Step 5: Commit** — `feat(cli): crewcast engines — detect CLIs and build the engine catalog`

## Left to the builder

- **Verify the vendor facts** in `DEFAULT_ENGINES` against each CLI's current `--help` and docs (§10): the exact headless flags, model flags, effort expression, sandbox/safe flags, and parallel limits for claude / gemini / codex / copilot / kiro. The seed values come from spec §7.6 and may be stale; `doctor` (Phase 1d) is where they get checked automatically. 1b's tests do not depend on their exactness.
- Whether `detect` should also record the models that actually work (a tiny call per model) — deferred to `doctor` (1d) to avoid spending tokens here.
- The exact `headless` token format (`{task}`) and how Phase 2 fills it — 1b only stores it; Phase 2 consumes it.
