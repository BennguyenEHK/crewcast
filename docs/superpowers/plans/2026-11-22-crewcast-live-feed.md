# crewcast live feed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Turn `crewcast watch` into a live self-narrating feed: every crewcast action (prompt received, decided, dispatched) posts one templated one-line summary, with the existing worker table as the "now" block.

**Architecture:** An append-only `ActivityLog` at `<crewHome>/activity.jsonl`. The hook appends `prompt-received` then `decided`/`decide-failed`; the CLI dispatch wiring appends `dispatch`. A pure `summarizeEvent` turns an event into a plain sentence. `crewcast watch` renders `ActivityLog.recent(N)` through `summarizeEvent` (newest at bottom) above the `now` block (the existing `RunWatch` for the active run).

**Tech Stack:** Node ≥22, TypeScript strict, ESM/NodeNext, zero runtime deps. Tests: `node:test` via `npx tsx --test`, fakes only, `CREWCAST_HOME`=temp dir.

**Spec:** `docs/superpowers/specs/2026-11-22-crewcast-live-feed-design.md`.

## Global Constraints

- Zero runtime dependencies; Node ≥22; TypeScript strict; OOP one-class-per-module.
- Summaries are templated from the event's own fields — **no AI, no tokens**, ASD-STE100 (short, active, plain).
- `ActivityLog.append` is **best-effort: it never throws** (the fail-open hook must not break if the log write fails). Reuse `ShadowLog.readJsonl` for reading; append one JSON line (append mode) like the mailbox.
- The hook keeps its word-gate (< 8 words → skip) and its ~2 s fail-open budget; `prompt-received` is appended *before* deciding.
- A prompt/task can contain a secret, so redact its text with `Mailbox.redact` before it goes into an event.

## Review Focus

1. **The model is down / times out on a prompt.** Expected: `prompt-received` still appears in the feed (hook fired), followed by `decide-failed` — not silence. → Task 2 test.
2. **A log-write failure during the hook.** Expected: the hook still returns normally (fail-open); the append swallows its error. → Task 1 test (append never throws) + Task 2 relies on it.
3. **`watch` with activity but no runs** (only solo decisions). Expected: the feed shows the decisions; the `now` block is simply absent; never "no runs yet" when there is activity. → Task 4 test.
4. **A secret in the prompt text.** Expected: the `task` in the event is redacted. → Task 2 test.
5. **Empty everything** (no activity, no runs). Expected: a clear "nothing yet", exit 0. → Task 4 test.

---

### Task 1: ActivityLog + summarizeEvent

**Files:**
- Create: `src/activity.ts`
- Test: `tests/activity.test.ts`

**Interfaces:**
- Produces:
  - `type ActivityEvent = { kind: 'prompt-received'; ts: string; task: string } | { kind: 'decided'; ts: string; mode: string; skills: string[]; branch: string; task: string } | { kind: 'decide-failed'; ts: string; reason: string } | { kind: 'dispatch'; ts: string; run: string; units: { unit: string; engine: string }[] }`
  - `class ActivityLog` with `constructor(home: string)`, `append(e: ActivityEvent): Promise<void>` (append one line to `<home>/activity.jsonl`; **swallow any write error**), `recent(n: number): Promise<ActivityEvent[]>` (last `n` parsed events via `ShadowLog.readJsonl`, missing file = `[]`).
  - `function summarizeEvent(e: ActivityEvent): string` — `prompt-received` → `"prompt received"`; `decided` → `"decided: solo · no skills · branch keep"` or `"decided: team · skills tdd, auth · branch feat/x"`; `decide-failed` → `"decide failed: <reason>"`; `dispatch` → `"dispatched: codex → unitA, agy → unitB"`.

- [ ] **Step 1: Write the failing test** — temp home. `append` three events, `recent(2)` returns the last two in order; `recent(10)` on a missing file returns `[]`. `summarizeEvent` of each kind contains its key facts (mode, skills, branch / engine names / reason). An `append` whose underlying write fails (point `home` at a path that cannot be created, e.g. a file where a dir is expected) resolves without throwing.
- [ ] **Step 2: Run the test, verify it fails.**
- [ ] **Step 3: Implement `src/activity.ts`.**
- [ ] **Step 4: Run the test, verify it passes.**
- [ ] **Step 5: Commit** — `feat(activity): ActivityLog + summarizeEvent (templated, zero-token)`.

---

### Task 2: hook writes prompt-received / decided / decide-failed

**Files:**
- Modify: `src/cli.ts` (`buildHookOutput`)
- Test: `tests/cli-hook.test.ts` (extend)

**Interfaces:**
- Consumes: `ActivityLog` (Task 1), `Mailbox.redact`.
- Behavior in `buildHookOutput`, after the word-gate: `await activity.append({ kind: 'prompt-received', ts, task: Mailbox.redact(prompt) })`; inside the decide `work`, on success append `{ kind: 'decided', mode, skills, branch, task: redacted }`, and on a thrown `BackendError`/timeout append `{ kind: 'decide-failed', reason }`. `activity` = `new ActivityLog(this.crewcastHome())`. (Appends never throw — Task 1 — so the hook stays fail-open.)

- [ ] **Step 1: Write the failing test** — drive `buildHookOutput` (as the existing hook tests do) with `CREWCAST_HOME` set:
  - a normal prompt (fake `ask` returning a decision) → `ActivityLog.recent` has `prompt-received` then `decided` with the right mode/branch.
  - a prompt whose `ask` throws a `BackendError` → the feed has `prompt-received` then `decide-failed` (not just silence).
  - a prompt containing `sk-ABCD1234efgh5678` → the `task` stored in the `prompt-received` event is redacted (`***`).
- [ ] **Step 2: Run it, verify it fails.**
- [ ] **Step 3: Implement** the appends in `buildHookOutput`.
- [ ] **Step 4: Run it, verify it passes** (and the existing hook tests still pass).
- [ ] **Step 5: Commit** — `feat(hook): narrate prompt-received / decided / decide-failed to the activity log`.

---

### Task 3: dispatch writes a dispatch event

**Files:**
- Modify: `src/cli.ts` (`buildDispatch`'s `dispatch` function)
- Test: `tests/cli-dispatch-activity.test.ts`

**Interfaces:**
- After `dispatcher.dispatch` returns a `RunState`, append `{ kind: 'dispatch', ts, run, units: state.workers.map(w => ({ unit: w.unit, engine: w.engine })) }` to the `ActivityLog`. (Keep `Dispatcher` pure — append in the CLI wiring, not in `Dispatcher`.)

- [ ] **Step 1: Write the failing test** — build the dispatch pipeline over fakes (as `cli-mcp`/`mcp-dispatch-tools` do, or call the `dispatch` seam) on a temp home, dispatch a 1-unit plan, then assert `ActivityLog.recent` has a `dispatch` event naming the run and the unit's engine.
- [ ] **Step 2: Run it, verify it fails.**
- [ ] **Step 3: Implement** the append in `buildDispatch`.
- [ ] **Step 4: Run it, verify it passes.**
- [ ] **Step 5: Commit** — `feat(dispatch): narrate the dispatch to the activity log`.

---

### Task 4: watch renders the feed above the now block

**Files:**
- Modify: `src/cli.ts` (`watch`, `watchOnce`), `src/dispatch/watch-render.ts`
- Test: `tests/cli-watch.test.ts` (extend), `tests/watch-render.test.ts` (extend)

**Interfaces:**
- Produces: `renderFeed(events: ActivityEvent[]): string` in `watch-render.ts` — one `summarizeEvent` line per event, oldest first (newest at the bottom), each with a short time prefix. `watchOnce` returns `renderFeed(await activity.recent(N))` + (if a run resolves) a blank line + the existing `renderWatch(view)` "now" block.
- `watch`: always render the feed. The `now` block is included only when a run resolves (latest run, or an explicit arg). When there is **no** activity **and** no run, print `nothing yet — enter a prompt in Claude Code` and keep looping (not an early non-zero exit). Keep the existing bad-explicit-run-id guard.

- [ ] **Step 1: Write the failing tests** —
  - `watch-render.test.ts`: `renderFeed` of a `decided` + a `dispatch` event contains both summaries, newest (dispatch) below.
  - `cli-watch.test.ts`: with only activity (a seeded `decided` event, no runs), `watchOnce` returns a frame containing the decision summary and **no** "no runs" text; with activity **and** a run, the frame has the feed line(s) then the worker table; with neither, the frame says "nothing yet".
- [ ] **Step 2: Run them, verify they fail.**
- [ ] **Step 3: Implement** `renderFeed`, and update `watchOnce`/`watch` to show feed + now.
- [ ] **Step 4: Run the whole suite** — `npx tsx --test tests/*.test.ts`; then `npm run typecheck && npm run build`.
- [ ] **Step 5: Commit** — `feat(cli): crewcast watch shows the live activity feed above the now block`.
