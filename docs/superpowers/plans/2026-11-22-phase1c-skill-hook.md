# Phase 1c — skill + hook + plugin manifest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the decider fire automatically in Claude Code: a `crewcast hook` command for the `UserPromptSubmit` hook (fail-open), the crewcast skill text, and a one-command plugin manifest bundling skill + MCP + hook.

**Architecture:** `crewcast hook` reads the hook payload (JSON on stdin), applies fail-open rules (short prompt / parse error / decide error / 2 s timeout → emit nothing), else runs the existing decide path and emits a short context block as the hook's `additionalContext`, with the captain line on team tasks. The skill and manifest are static artifacts; tests assert they parse. The hook logic is factored into a testable method so no real stdio is needed.

**Tech Stack:** Node ≥ 22, TypeScript (ESM, NodeNext, strict), built-ins only, `node:test` via `npx tsx --test`.

**Spec:** `docs/superpowers/specs/2026-11-20-crewcast-design.md` (§7.2 hook + two speeds + captain line, §7.9 ship steps + STE, §7.13 captain role, §7.1 plugin manifest, §10 verify manifest/hook format).

## Global Constraints

- Node `>= 22`; zero runtime dependencies; one class per module; ponytail.
- **The hook fails open.** On a short prompt (< 8 words), a parse error, a decide error, or a > 2 s wait, it emits nothing and exits 0 — it never blocks or breaks the user's prompt (§3 anti-goal, §7.2).
- Tests: `node:test` + `node:assert/strict` via `npx tsx --test`; fakes only; `CREWCAST_HOME` = temp dir.
- Never log secrets; the hook writes only its context block to stdout.
- Commits: conventional, ending with `Co-Authored-By: Claude Code <noreply@anthropic.com>`. **Do not push.**
- The **exact Claude Code hook I/O shape and plugin-manifest schema are facts to verify** (§10); implement to the documented form and flag in Left-to-builder. The hook fails safe, so a wrong shape yields no context, never a crash.

## Review Focus

1. **A trivial prompt** ("thanks", "yes go ahead" — under 8 words). Expected: the hook emits nothing, exit 0. → Task 1 test.
2. **A non-JSON / shapeless payload on stdin.** Expected: emit nothing, exit 0, no throw. → Task 1 test.
3. **Decide fails** (Ollama down / model missing / timeout). Expected: emit nothing, exit 0 — the prompt still goes through. → Task 1 test.
4. **A team-phrase prompt.** Expected: the context block carries the one-line captain rule (§7.2). → Task 1 test.
5. **The skill frontmatter / manifest JSON is malformed.** Expected: caught in this phase's tests (they parse the shipped files). → Task 2 tests.

---

### Task 1: `crewcast hook` command

**Files:**
- Modify: `src/cli.ts` (route `hook`; add a testable `buildHookOutput`)
- Test: `tests/cli-hook.test.ts`

**Interfaces:**
- Consumes: `Decider` (`src/decide/decide.ts`); `SystemOneClient`, `BackendError` (`src/backend/systemone.ts`); `SkillCatalog`, `SkillIndex`, `GitInspector`, `Config` (existing).
- Produces: `crewcast hook` (reads stdin, prints the hook output, always exits 0), and a private, testable:

```ts
// payload = the raw UserPromptSubmit stdin (JSON string). Returns the hook's stdout (may be '').
buildHookOutput(payload: string): Promise<string>;
```

Behaviour of `buildHookOutput`:
- Parse `payload` as JSON; read `prompt` (string). On parse error or missing prompt → return `''`.
- If the prompt has fewer than 8 whitespace words → return `''` (fail-open on trivial turns).
- Run the decide path (as `Cli.decide` wires it) with a **2000 ms** `SystemOneClient` timeout. On any `BackendError` or other error → return `''`.
- On success, return a single-line JSON string:
  `{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"<block>"}}`
  where `<block>` is e.g. `crewcast (shadow): mode=<mode>; skills: <picked or none>; branch: <keep|new name>.` and, when `mode === 'team'`, a second sentence: `You are the team captain: delegate, read reports, route reviews; do not write code or review diffs (crewcast skill §7.13).`
- The `hook` command: read all of `process.stdin` to a string, `const out = await buildHookOutput(input); if (out) this.out(out);` return 0. Always 0.

- [ ] **Step 1: Write failing tests** (fake `ask`, sandbox env; call `buildHookOutput` directly)

```ts
test('a prompt under 8 words → empty output', ...)                       // Review Focus 1
test('a non-JSON payload → empty output, no throw', ...)                 // Review Focus 2
test('a real prompt → hook JSON with additionalContext naming the mode', ...) // parse, assert hookSpecificOutput.additionalContext matches /mode=solo/
test('a team-phrase prompt → additionalContext carries the captain line', ...) // Review Focus 4
test('decide error (ask throws BackendError) → empty output', ...)       // Review Focus 3
```

- [ ] **Step 2:** `npx tsx --test tests/cli-hook.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `hook` + `buildHookOutput`, and `'  hook'` in `USAGE`.
- [ ] **Step 4:** `npx tsx --test tests/cli-hook.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** — `feat(cli): crewcast hook — fail-open UserPromptSubmit decide hook`

### Task 2: the crewcast skill and the plugin manifest

**Files:**
- Create: `skills/crewcast/SKILL.md` (the skill prose)
- Create: `.claude-plugin/plugin.json` (the plugin manifest)
- Test: `tests/plugin-assets.test.ts`

**Interfaces:**
- Consumes: `SkillCatalog.parseFrontmatter` (`src/catalog/skills.ts`) to validate the skill frontmatter.
- Produces: the two artifacts.

Content:
- `SKILL.md` frontmatter: `name: crewcast`, a one-line `description`. Body (short, ASD-STE100): when to call `decide` (or read the hook's record), how to read the record (mode/skills/branch/agents), the captain role in team mode (§7.13 summary), the ship steps (§7.9), and the STE rule. It is prose; the test checks only that it parses with a name and a non-empty description.
- `plugin.json`: name `crewcast`, a version, a description, and the components — an MCP server entry running `npx -y crewcast mcp`, a `UserPromptSubmit` hook running `crewcast hook`, and the bundled skill. Valid JSON. (Exact schema per §10 — verify against Claude Code docs.)

- [ ] **Step 1: Write failing tests**

```ts
test('plugin.json is valid JSON with name and version', ...)
test('the crewcast SKILL.md frontmatter parses with name "crewcast" and a non-empty description', ...)  // via SkillCatalog.parseFrontmatter
```

- [ ] **Step 2:** `npx tsx --test tests/plugin-assets.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Write `SKILL.md` and `plugin.json`.
- [ ] **Step 4:** `npm test && npm run typecheck && npm run build`. Expected: all PASS. Smoke: `printf '{"prompt":"build the settings UI use team agents"}' | node dist/bin.js hook` prints a JSON line whose `additionalContext` names team + the captain line (manual).
- [ ] **Step 5: Commit** — `feat(plugin): crewcast skill and plugin manifest (skill + mcp + hook)`

## Left to the builder

- **Verify the Claude Code `UserPromptSubmit` hook I/O** (the stdin payload field for the prompt, and whether context is returned via stdout text or `hookSpecificOutput.additionalContext`) and the **plugin-manifest schema** (`.claude-plugin/plugin.json` fields for mcpServers / hooks / skills) against current Claude Code docs (§10). The hook fails safe, so a wrong shape adds no context rather than breaking the prompt — but the form should be confirmed before 1d wires it into `setup`.
- The skill body wording is the implementer's to draft within §7.9/§7.13; keep it short and in ASD-STE100.
