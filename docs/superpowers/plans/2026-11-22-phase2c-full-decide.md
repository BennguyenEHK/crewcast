# Phase 2c — Full Decide (per-unit allocation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Turn an approved `plan.md` (work units only — never the crew) into a per-unit crew allocation, locally and with zero AI tokens: group by dependency, and give each unit its CLI, model, effort, launch flags, skills and owned files (§7.14).

**Architecture:** A `parsePlan` function reads the lightweight plan.md block format into `WorkUnit[]`. A `PlanAllocator` topologically groups the units (independent → parallel, dependent → chained), derives each unit's signals locally (size from file count, writes-files from whether it owns files, risk from a keyword rule), picks skills from the unit text via an injected shortlister, assigns a worker CLI, and resolves model/effort/flags with the existing `resolveFlags`. A `crewcast plan <file>` command prints the allocation.

**Tech Stack:** Node ≥22, TypeScript strict, ESM/NodeNext, zero runtime deps. Tests: `node:test` via `npx tsx --test`, fakes only.

**Spec:** `docs/superpowers/specs/2026-11-20-crewcast-design.md` (§7.3, §7.6, §7.14; §7.7 owned files). Overview: `docs/superpowers/plans/2026-11-22-phase2-overview.md`. Reuses `resolveFlags`/`Engine` (`src/engines/flags.ts`, `src/engines/catalog.ts`), `SkillIndex.top` (`src/catalog/skill-index.ts`), `DEFAULT_RULES`/`Size`/`RiskArea` (`src/decide/rules.ts`, `src/decide/record.ts`).

## Global Constraints

- Zero runtime dependencies; Node ≥22; ESM/NodeNext; TypeScript strict; OOP one-class-per-module.
- **plan.md names no CLI/model/skill/flag** (§7.14): the allocator derives all of it. Never read a crew name from the plan.
- Allocation is **local and zero-token**: no `ask`/decision-model call. Skills come from embedding (injected shortlister), everything else from catalog + rules.
- `Size` buckets and `RiskArea` values are the existing ones in `src/decide/record.ts`. Flags come only from `resolveFlags` (so a permission-off flag can never be emitted, §7.6).

## Review Focus

1. **A dependency cycle** (A depends B, B depends A) or a `depends:` naming a unit that does not exist. Expected: a clear error, not a hang or a silent drop. → Task 2 test.
2. **A unit with no `files:`** (research/review). Expected: `writes_files` false → `resolveFlags` emits read flags, not write flags; size `one_file`. → Task 2 test.
3. **A risky unit** (path or text matches auth/db/payments/deploy/secrets). Expected: the strong model + high effort via `resolveFlags`. → Task 2 test.
4. **Grouping** — two independent units share group 0; a unit depending on both is group 1. Expected: correct topological levels so dispatch can parallelize safely. → Task 2 test.
5. **No worker CLI installed** (only the lead). Expected: allocation still produced (fall back to the lead engine) with a flag, not a crash. → Task 2 test.

---

### Task 1: Plan parser

**Files:**
- Create: `src/plan.ts`
- Test: `tests/plan-parse.test.ts`

**Interfaces:**
- Produces:
  - `interface WorkUnit { id: string; description: string; files: string[]; depends: string[] }`
  - `function parsePlan(markdown: string): WorkUnit[]`

**Format (crewcast's plan.md unit block):** each unit is a `## ` heading whose text is the unit id/description; under it, a `files:` line and a `depends:` line. Example:
```
## Add the mailbox store
files: src/mailbox.ts, tests/mailbox.test.ts
depends: none

## Wire the tools
files: src/cli.ts
depends: Add the mailbox store
```
Rules: ids are the trimmed heading text; `files:`/`depends:` are comma-separated; `none`/empty/absent → `[]`; a `###` or deeper heading is body, not a new unit; whitespace trimmed; a duplicate id throws.

- [ ] **Step 1: Write the failing test** — `tests/plan-parse.test.ts`: the two-unit example parses to two `WorkUnit`s with the right `id`, `files` (split + trimmed), and `depends` (`['Add the mailbox store']` for the second, `[]` for the first). A unit with no `files:`/`depends:` lines → both `[]`. `depends: none` → `[]`. A plan with two `## ` headings of the same text throws.

- [ ] **Step 2: Run the test, verify it fails** — module not found.

- [ ] **Step 3: Implement `src/plan.ts`.** Split on lines beginning `## ` (exactly two hashes + space). For each block, read `files:`/`depends:` lines (case-insensitive label). Trim and split on commas; drop empties and a lone `none`.

- [ ] **Step 4: Run the test, verify it passes.**

- [ ] **Step 5: Commit** — `feat(plan): parse plan.md work units (description/files/depends)`.

---

### Task 2: PlanAllocator

**Files:**
- Create: `src/decide/allocate.ts`
- Test: `tests/allocate.test.ts`

**Interfaces:**
- Consumes: `WorkUnit` (Task 1); `Engine` + `resolveFlags` (`src/engines`); `Size`/`RiskArea` (`src/decide/record.ts`); `DEFAULT_RULES` for `leadEngine`.
- Produces:
  - `interface UnitAllocation extends WorkUnit { group: number; engine: string; model: string; effort: string | null; args: string[]; skills: string[]; mcps: string[]; leadFallback?: true }`
  - `interface PlanAllocation { units: UnitAllocation[] }`
  - `class PlanAllocator` with `constructor(deps: { engines: Engine[]; leadEngine?: string; pickSkills: (text: string) => Promise<string[]> })`
  - `allocate(units: WorkUnit[]): Promise<PlanAllocation>`

**Allocation rules (all local):**
- **Grouping:** topological levels over `depends`. `group` = 1 + max(group of each dependency); a unit with no deps is group 0. An unknown dependency id, or a cycle, throws with the offending id(s).
- **Signals per unit:** `writes_files` = `files.length > 0`; `size` = `one_file` (≤1 file), `few_files` (2–4), `many_files` (≥5); `risk_area` = first keyword hit over the lowercased description + file paths — `secrets` (secret|credential|\.env), `payments` (payment|billing|stripe|charge), `auth` (auth|login|password|session|token), `db_schema` (schema|migration|migrate|\btable\b), `deploy` (deploy|release|publish|\bci\b) — else `none`. (shortcut: keyword risk + file-count size; upgrade if it mis-grades a real plan.)
- **Engine:** round-robin over installed worker engines (`engines.filter(e => e.installed && e.id !== leadEngine)`), stable order. If none installed, use `leadEngine` and set `leadFallback: true`. (shortcut: round-robin CLI assignment; upgrade to capability-based when a real policy exists.)
- **model/effort/args:** `resolveFlags(engine, { writes_files, risk_area, size })`.
- **skills:** `await pickSkills(description)`.
- **mcps:** `[]` for now — the per-unit MCP pick is the pending 1e MCP catalog (§7.5); leave a one-line comment, no dead code.

- [ ] **Step 1: Write the failing test** — `tests/allocate.test.ts` with 2–3 fake `Engine`s (one lead `claude` installed, two workers installed with distinct `models`/`strongModel`/`writeFlags`/`readFlags`/`effortArgs`) and a fake `pickSkills` returning a fixed list. Cover:
  - two independent units + one depending on both → groups `[0,0,1]`.
  - a unit with files → `writes_files`-driven write flags in `args`; a unit with no files → read flags.
  - a unit whose text says "update the auth login flow" → engine's `strongModel` + high effort in `args`.
  - worker engines assigned round-robin, never the lead.
  - with only the lead installed → every unit gets `engine === leadEngine` and `leadFallback: true`, no throw.
  - `depends: ['ghost']` (unknown) throws; a 2-cycle throws.

- [ ] **Step 2: Run the test, verify it fails.**

- [ ] **Step 3: Implement `src/decide/allocate.ts`.** Grouping by memoized depth with an in-progress set for cycle detection. Risk by the keyword table. Reuse `resolveFlags`.

- [ ] **Step 4: Run the test, verify it passes.**

- [ ] **Step 5: Commit** — `feat(decide): per-unit plan allocation (grouping, signals, CLI, flags, skills)`.

---

### Task 3: `crewcast plan` command

**Files:**
- Modify: `src/cli.ts` (route + method + USAGE)
- Test: `tests/cli-plan.test.ts`

**Interfaces:**
- Consumes: `parsePlan` (Task 1), `PlanAllocator` (Task 2), `EngineCatalog.load` (`src/engines/catalog.ts`), `SkillIndex` (`src/catalog/skill-index.ts`).
- Produces: `crewcast plan <file> [--json]` — reads the file, loads the engine catalog from `crewcastHome()` (falling back to `DEFAULT_ENGINES` detect if none saved), builds a `PlanAllocator` whose `pickSkills` is `text => SkillIndex.top(text, skills, 3).then(s => s.map(x => x.name))`, and prints per unit: `group`, `engine`, `model`, `effort`, `skills`, `files`; or the JSON allocation with `--json`.

- [ ] **Step 1: Write the failing test** — `tests/cli-plan.test.ts`: write a temp plan.md, run `plan <file> --json` with an injected `pickSkills`/engines seam (inject engines via a fake saved catalog in `CREWCAST_HOME`, and a fake skill shortlist), assert exit 0 and the JSON has one `units` entry per `## ` block with a `group` and an `engine`. A missing file → non-zero exit and a clear message.

- [ ] **Step 2: Run the test, verify it fails.**

- [ ] **Step 3: Implement** the `plan` route and `private async plan(args)`. Add `'  plan <file> [--json]'` to USAGE. Factor the skills seam so the test injects a fake (reuse the existing `deps` pattern; add an optional `pickSkills` to `Cli` deps if needed, defaulting to the real `SkillIndex`).

- [ ] **Step 4: Run the whole suite** — `npx tsx --test tests/*.test.ts`; then `npm run typecheck && npm run build`.

- [ ] **Step 5: Commit** — `feat(cli): crewcast plan — print the per-unit allocation of a plan.md`.
