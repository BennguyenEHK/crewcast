# crewcast watch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `crewcast watch [run]` command that renders a live, self-updating terminal view of a team run — each worker's status flipping from running to ended as it happens.

**Architecture:** A `RunWatch` class reads the run's `run.json` and mailbox once per tick, derives each worker's live state (failed / running / ended via pid-liveness, plus latest message + count + elapsed), and returns plain view rows. A tiny renderer turns rows into an ANSI frame. The CLI `watch` command resolves the run (arg or newest under `<crewHome>/runs/`), then loops: build rows → clear+redraw → sleep → repeat, until Ctrl+C. The data layer is unit-tested with fakes; the render/loop is thin.

**Tech Stack:** Node ≥22, TypeScript strict, ESM/NodeNext, zero runtime deps. Tests: `node:test` via `npx tsx --test`, fakes only, `CREWCAST_HOME`=temp dir.

**Spec:** `docs/superpowers/specs/2026-11-22-crewcast-watch-design.md`.

## Global Constraints

- Zero runtime dependencies; Node ≥22; TypeScript strict; OOP one-class-per-module.
- Reuse `RunState`/`WorkerRecord` (`src/dispatch/dispatcher.ts`) and `Mailbox` (`src/mailbox.ts`). Run dir is `<crewHome>/runs/<run>/` (`run.json`, `mailbox.jsonl`).
- Poll loop stays cheap: read `run.json` + `Mailbox.read` + pid-liveness per tick; **no git per tick**.
- pid-liveness: `process.kill(pid, 0)` — treat a thrown `ESRCH` as gone, anything else (incl. `EPERM`) as alive; a `null` pid with a recorded `error` is failed.

## Review Focus

1. **A worker whose process has exited** (pid gone). Expected: shown `ended`, not stuck `running`. → Task 1 test (inject a pid-liveness fake).
2. **A failed worker** (`pid: null`, `error` set in run.json). Expected: shown `failed` with the reason, never probed for liveness. → Task 1 test.
3. **`watch` with no run id and no runs at all.** Expected: a clear "no runs yet" message, exit 0, no crash. → Task 3 test.
4. **`watch` auto-selecting the newest run** when several exist. Expected: picks the most recently modified run dir. → Task 3 test.
5. **A worker with no messages yet.** Expected: count 0, empty latest-message, status still derived from pid/error (not crashing on an absent message). → Task 1 test.

---

### Task 1: RunWatch — derive live view rows

**Files:**
- Create: `src/dispatch/run-watch.ts`
- Test: `tests/run-watch.test.ts`

**Interfaces:**
- Consumes: `RunState`/`WorkerRecord` (`src/dispatch/dispatcher.ts`), `Mailbox` (`src/mailbox.ts`).
- Produces:
  - `interface WatchRow { unit: string; engine: string; files: string[]; skills: string[]; status: 'failed' | 'running' | 'ended' | 'queued'; latest: string; messages: number; error?: string }`
  - `interface WatchView { run: string; startedAt: string; elapsedMs: number; rows: WatchRow[] }`
  - `class RunWatch` with `constructor(deps: { runsHome: string; mailbox: Mailbox; alive: (pid: number) => boolean; now?: () => number })`
  - `view(run: string): Promise<WatchView>` — reads `<runsHome>/<run>/run.json`; for each worker derives `status` (`error`/`pid===null` → `failed`; `pid` present and `alive(pid)` → `running`; present and not alive → `ended`; no pid → `queued`), `latest` = text of the last mailbox message whose `from === unit` (`''` if none), `messages` = count for that `from`; `elapsedMs` = `now() - Date.parse(startedAt)`.

- [ ] **Step 1: Write the failing test** — `tests/run-watch.test.ts`, temp `CREWCAST_HOME`. Hand-write a `run.json` with three workers: one `pid: 100`, one `pid: 200`, one `pid: null, error: 'ENOENT'`. Post mailbox messages for the first two (two for worker A, none for worker B). Inject `alive` = `pid => pid === 100` and a fixed `now`. Assert: worker A → `running`, latest = its last message, messages = 2; worker B → `ended` (pid 200 not alive), messages 0, latest `''`; worker C → `failed`, error `ENOENT`, never passed to `alive`; `elapsedMs` matches `now - startedAt`.
- [ ] **Step 2: Run the test, verify it fails** — module not found.
- [ ] **Step 3: Implement `src/dispatch/run-watch.ts`.**
- [ ] **Step 4: Run the test, verify it passes.**
- [ ] **Step 5: Commit** — `feat(watch): RunWatch — derive live worker view from run.json + mailbox`.

---

### Task 2: store skills in the worker record

**Files:**
- Modify: `src/dispatch/dispatcher.ts`
- Test: `tests/dispatcher.test.ts` (extend)

**Interfaces:**
- Produces: `WorkerRecord` gains `skills: string[]`; `Dispatcher.dispatch` writes `skills: u.skills` into each `WorkerRecord`.

- [ ] **Step 1: Write the failing test** — in `tests/dispatcher.test.ts`, extend the existing happy-path dispatch test to assert the writer's `WorkerRecord.skills` equals the unit's `skills` (e.g. `['skill-a']`).
- [ ] **Step 2: Run it, verify it fails** (field absent).
- [ ] **Step 3: Implement** — add `skills: u.skills` to the pushed `WorkerRecord` in `dispatch`; add `skills: string[]` to the `WorkerRecord` interface. (`RunWatch` already reads it in Task 1, defaulting to `[]` if an older run.json lacks it.)
- [ ] **Step 4: Run it, verify it passes** (and the Task 1 test still passes).
- [ ] **Step 5: Commit** — `feat(dispatch): record each worker's skills in run.json`.

---

### Task 3: `crewcast watch` command (resolve + render + loop)

**Files:**
- Modify: `src/cli.ts` (route, method, USAGE)
- Create: `src/dispatch/watch-render.ts` (pure rows → string frame)
- Test: `tests/cli-watch.test.ts`, `tests/watch-render.test.ts`

**Interfaces:**
- Consumes: `RunWatch` (Task 1), `WatchView`/`WatchRow`.
- Produces:
  - `renderWatch(view: WatchView, now: number): string` in `watch-render.ts` — a plain multi-line frame: a header line (run id, worker count, elapsed) and one line per row (`<marker> <engine> <unit> <files> <status> "<latest>"`), markers `●`/`◐`/`○`/`✗`. No ANSI in this function (ANSI clear is added by the loop) so it is testable as a string.
  - `crewcast watch [run] [--interval <ms>]` in `cli.ts`: resolve the run (positional, else newest dir under `crewcastHome()/runs` by mtime; none → print `no runs yet` and return 0); then loop — `renderWatch(await runWatch.view(run), now)`, write a clear-screen sequence + the frame, sleep `interval` (default 1000), repeat until the process is interrupted. Factor the loop so a test can run **one** render without an infinite loop (e.g. a private `watchOnce(run)` that returns the frame, used by both the loop and the test; the default real `alive` uses `process.kill(pid, 0)`).

- [ ] **Step 1: Write the failing tests** —
  - `watch-render.test.ts`: a `WatchView` with a running and an ended row renders a string containing both engine names, both status markers, and the running row's latest message; a long `latest` is truncated.
  - `cli-watch.test.ts`: with a seeded `run.json` + mailbox under `CREWCAST_HOME`, `watchOnce` (injected `alive`) returns a frame naming the workers; `watch` with no runs prints `no runs yet` and returns 0; with two run dirs, the newest is chosen.
- [ ] **Step 2: Run them, verify they fail.**
- [ ] **Step 3: Implement** `renderWatch`, the `watch` route/method, `watchOnce`, run resolution, and the loop (loop body calls `watchOnce`; the test calls `watchOnce` directly). Add `'  watch [run]'` to USAGE.
- [ ] **Step 4: Run the whole suite** — `npx tsx --test tests/*.test.ts`; then `npm run typecheck && npm run build`.
- [ ] **Step 5: Commit** — `feat(cli): crewcast watch — live terminal view of a team run`.

---

### Task 4: version bump

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Bump** `version` from `0.0.0` to `0.0.1`.
- [ ] **Step 2: Verify** `npm run build` succeeds and `node dist/bin.js --version` prints `0.0.1`.
- [ ] **Step 3: Commit** — `chore: release 0.0.1 (crewcast watch)`.
