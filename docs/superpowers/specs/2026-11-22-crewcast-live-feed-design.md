# crewcast live feed — design

**Intent / why:** make crewcast a self-narrating bot. Right now `crewcast watch` shows only a *team run's* worker table, so a solo task (and the moment you type a prompt) shows nothing — the owner can't see crewcast working. This expands `watch` into a live **feed**: every time crewcast acts on its own (a prompt arrives, it decides, it dispatches, a worker finishes), it posts one short plain-English line, newest at the bottom, like a bot reporting status. The worker table we already built becomes the "now" block inside that feed.

**Who it's for:** the owner, in a terminal pane beside Claude Code, watching the whole pipeline from the prompt onward.

## Goals
- An append-only **activity log** `<crewHome>/activity.jsonl` that crewcast writes an event to each time it acts.
- The **hook** writes two events per substantial prompt: `prompt-received` on entry (proves the hook fired, even if deciding is slow or the model is down) and then `decided` (mode · skills · branch), or `decide-failed` with the reason.
- **dispatch** writes a `dispatch` event (run id, each unit's engine).
- `crewcast watch` renders the **feed** (recent events as one-line templated summaries, newest at the bottom) plus a **now** block — the active run's worker table (the existing `RunWatch`), updating ~1s.
- Summaries are **templated locally from the event's own fields — no AI, no tokens**, ASD-STE100 style.

## Non-goals / anti-goals
- **No AI-written summaries.** crewcast already holds the facts; it formats them. Spending model tokens to narrate itself would betray the point.
- **No web UI / no daemon / no port / no new runtime dependency.**
- **No spam.** The hook's existing word-gate (< 8 words → skip) stays, so "ok"/"yes" don't flood the feed.
- The old team-only table is **not** a separate mode; it lives inside the feed as the "now" block.

## Constraints
- Zero runtime dependencies; Node ≥22; TypeScript strict; OOP one-class-per-module.
- The hook stays fail-open and inside its ~2s budget: write `prompt-received` *before* deciding; wrap every append so a log failure never breaks the prompt.
- Append one JSON line per event (append mode, like the mailbox) so concurrent writers don't corrupt a line.
- The `watch` poll loop stays cheap: read `activity.jsonl` tail + the active run's `run.json`/mailbox + pid-liveness. No git per tick (unchanged).

## Approaches (considered)
- **A — activity log + feed (CHOSEN):** the hook and dispatch append events; `watch` renders them as summary lines with the worker table as the "now" block. It's the only one that shows the whole flow from the prompt, reuses everything built, and keeps crewcast local/zero-dep/zero-token.
- **B — keep `watch` team-only (rejected):** what exists now; shows nothing for a prompt or a solo task — the gap that caused the confusion.
- **C — web dashboard (rejected earlier):** frontend + port + browser + localhost-reachability; adds the surface crewcast avoids.

## Design (decided)
- **`src/activity.ts` — `ActivityLog(home)`:** `append(event)` writes one redacted JSON line to `<home>/activity.jsonl`; `recent(n)` returns the last `n` parsed events (reuse `ShadowLog.readJsonl`, missing file = empty). Event shapes:
  - `{ kind: 'prompt-received'; ts; task }`
  - `{ kind: 'decided'; ts; mode; skills: string[]; branch; task }`
  - `{ kind: 'decide-failed'; ts; reason }`
  - `{ kind: 'dispatch'; ts; run; units: { unit: string; engine: string }[] }`
  - Redact the `task` text with `Mailbox.redact` (a prompt can contain a key).
- **Hook (`buildHookOutput`):** after the word-gate, `await activity.append({ kind: 'prompt-received', ... })`; then decide; on success append `decided`, on `BackendError`/timeout append `decide-failed`. All appends wrapped so they never throw out of the fail-open hook.
- **Dispatch:** `Dispatcher.dispatch` (or the CLI `dispatch` wiring) appends the `dispatch` event after the run state is written.
- **`summarizeEvent(event): string`** (pure, templated, ASD-STE100): e.g. `prompt-received → "prompt received"`, `decided → "decided: solo · no skills · branch keep"` / `"decided: team of 2 · skills tdd, auth · branch feat/..."`, `decide-failed → "decide failed: <reason>"`, `dispatch → "dispatched: codex → auth, agy → settings"`.
- **`crewcast watch`:** each tick, render `ActivityLog.recent(N)` through `summarizeEvent` (newest at bottom), then the `now` block from `RunWatch` for the latest active run (if any). Same clear-and-redraw loop; same run resolution/`--interval`.

## What's left to the builder
- How many recent events to show (N), the timestamp format, and line truncation to terminal width.
- Whether the `dispatch` event is appended inside `Dispatcher` or by the CLI wiring (keep `Dispatcher` pure if an injected sink is cleaner).
- Worker `done`/`merge` events are out of scope for this pass — the "now" block already shows live worker status; richer lifecycle events can follow once the captain review/merge routing exists (same follow-up as CodeRabbit wiring).
