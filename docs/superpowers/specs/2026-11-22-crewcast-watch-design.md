# crewcast watch — design

**Intent / why:** crewcast is a black box today — it decides and dispatches invisibly. The owner wants to *watch a team run live*: see the crew fan out and each worker flip from running to done as it happens, so the process is observable, not just trusted.

**Who it's for:** the owner (CEO), in a terminal pane beside Claude Code, while a team run is in progress.

## Goals
- A `crewcast watch [run]` command that renders a live, self-updating status view of a team run in the terminal, refreshing about once a second.
- Shows, per worker: its unit, the CLI (engine), its owned files, a live status marker, its latest mailbox message, message count, and elapsed time.
- With no run id, it auto-selects the most recent run under `<crewHome>/runs/`, so you can just type `crewcast watch`.
- Read-only.

## Non-goals / anti-goals
- **No task launching from `watch`** — you start work in Claude Code; the captain decides and dispatches. A second launch path would bypass the plan-approval gate.
- **No input / messaging the team** — deferred. If a live run later shows workers read mid-run replies, a one-line "post to the team" input is a clean follow-up.
- **No web UI / no daemon / no port** — rejected in brainstorming; keeps crewcast local and dependency-free.
- **No new runtime dependency** — pure Node + hand-written ANSI.

## Constraints
- Zero runtime dependencies; Node ≥22; TypeScript strict; OOP one-class-per-module.
- Reuse the existing run state: `run.json` (RunState from `src/dispatch/dispatcher.ts`) and the mailbox (`src/mailbox.ts`).
- The poll loop stays cheap: `run.json` is read once (it's written once at dispatch), the mailbox is a small file read, pid-liveness is a syscall. **No git per tick** — ownership (which runs git) is not in the fast loop.

## Approaches (considered)
- **A — terminal `crewcast watch` (CHOSEN):** a command that polls `run.json` + mailbox + pid-liveness and redraws an ANSI table in place. Genuinely live, zero deps, no daemon, stays in the terminal. Cost: a second pane — normal for a monitor (`tail -f`, `docker stats`).
- **B — inline in the Claude Code chat (rejected):** the chat only advances on a model turn, so nothing can stream live between turns; the captain polling on its turns isn't live and burns tokens.
- **C — localhost web dashboard (rejected):** prettiest, but adds a frontend to maintain, a port, a browser context-switch, and localhost-reachability (any local process can read run state). On-demand launch softens the daemon worry but the other costs remain, and it adds surface crewcast has avoided.

## Design (decided)
- **Command:** `crewcast watch [run] [--interval <ms>]` (default interval 1000 ms).
- **Run resolution:** the `run` arg, else the newest directory under `<crewHome>/runs/` by mtime. No runs → print "no runs yet" and exit 0.
- **Worker status marker:**
  - `✗ failed` — `run.json` recorded a spawn error (`pid === null` / `error` set).
  - `◐ running` — pid is alive (`process.kill(pid, 0)` does not throw ESRCH).
  - `● ended` — pid is gone (process exited; success-vs-fail isn't known without a convention, so "ended").
  - `○ queued` — no pid yet (not applicable in the current one-shot dispatch, but handled).
- **Per worker also:** latest mailbox message for that `from`, its message count, and elapsed since `run.startedAt`.
- **Header:** run id, that it's a team run (a run exists only for team dispatch), worker/unit count.
- **Store skills in the record:** add `skills: string[]` to `WorkerRecord` (written at dispatch) so the view can show each unit's skills. Small, and useful record metadata.
- **Render:** clear the screen and redraw the table each tick (ANSI home + clear). Loop until Ctrl+C — it's a monitor, so it keeps showing the final state after all workers end rather than exiting on its own.
- **Version:** bump the package `0.0.0 → 0.0.1` with this change.

## What's left to the builder
- The exact ANSI redraw (cursor-home + clear-to-end vs full clear), column widths, and truncation of long messages to the terminal width.
- Whether to also print a one-line ownership summary once all workers have ended (a single git check at the end is fine; just not per tick).
