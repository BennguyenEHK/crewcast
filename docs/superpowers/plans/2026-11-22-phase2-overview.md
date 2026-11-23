# Phase 2 — overview / roadmap

**What Phase 2 delivers (spec §8):** dispatch, worktrees, and the mailbox — the MCP tools `dispatch`, `post_message`, `read_messages`, `run_status`. **Done when a two-engine team task runs and its workers report back mid-task.**

**Spec:** `docs/superpowers/specs/2026-11-20-crewcast-design.md` (§7.3, §7.6, §7.7, §7.8, §7.13, §7.14, §8).

Phase 2 is built as five sub-plans, in this order. Each produces working, tested software on its own. A detailed task plan is written just-in-time when its sub-plan starts (so we don't over-plan), but the scope of every sub-plan is fixed here so nothing is forgotten. Phase 2 builds on Phase 1 (merged to main): the MCP server (1a), the engine catalog + flags-by-rules (1b), the skill + hook (1c), and the install manifest (1d).

| Sub-plan | Scope / deliverable | Spec | Needs live CLIs? | Status |
|---|---|---|---|---|
| **2a — mailbox** | MCP tools `post_message(run, from, text)` / `read_messages(run, since)`; one JSONL file per run under `~/.crewcast/runs/<id>/`; secret/key-like redaction on write (§7.7). The two-way channel workers and captain talk over. | §7.7 | No — fakeable | **merged (PR #6)** |
| **2b — worktree manager** | Create/remove a writer's worktree `<repo>-wt/<engine>-<n>` (own branch, shared history); cleanup order (unlink link → folder → branch); never link `node_modules`; the **file-ownership check** (a worker's changed-file list ⊆ its owned list, §7.7/§7.13). | §7.7 | No — temp git repo | **merged (PR #7)** |
| **2c — full decide (per-unit allocation)** | Parse `plan.md` work units (`description` / `files:` / `depends:`); per unit, allocate locally and zero-token: grouping (parallel vs chained by `depends`), skills (embed the unit text, §7.5), CLI/model/effort (1b catalog + rules, §7.6), plugins/MCP (§7.5), flags (§7.6), and each writer's owned-files list. Extends the Decider; reuses the 1b catalog. | §7.6, §7.14 | No — fakeable | **merged (PR #8)** |
| **2d — dispatch + run_status** | MCP tools `dispatch(plan)` and `run_status(run)`. One process per **engine group** (not per agent, §7.7); spawn each worker as a background child with its task card (goal, owned files, done, mailbox run id), its skills (§7.8), its worktree (2b) if it writes, and a per-run MCP config so it can talk back (2a). The file-ownership gate (2b) runs before a merge is offered. | §7.7, §7.13 | **Plumbing: no** (fake spawner). **Acceptance: yes.** | pending |
| **2e — plan-mode dispatch hook** | The Claude Code hook that fires dispatch when the user approves the plan: verify the exact event (`PostToolUse` on `ExitPlanMode`, §7.14), read `plan.md`, call `dispatch`. Fail-open like the §7.2 hook. | §7.14 | No — payload fixture | pending |

## The live acceptance gate (only the owner can run it)

Phase 2's done-criterion — *"a two-engine team task runs, and its workers report back mid-task"* — is a **live run on the owner's machine**: real Codex/Gemini/Copilot/Kiro CLIs on the owner's subscriptions, real git worktrees, real Ollama. **Unit tests with fakes prove every piece** (JSON-RPC tool shapes, mailbox JSONL + redaction, worktree lifecycle, per-unit allocation, the spawn plumbing via a fake spawner) **but they cannot flip the "it works" bit.** That bit is flipped by the owner running one real two-engine task and seeing workers post to the mailbox mid-task.

So Phase 2 has two finish lines:
1. **Buildable + testable now (2a–2e):** merged to main with full unit coverage, like Phases 1a–1d. This is what the autonomous loop produces.
2. **Live acceptance (owner-run):** a scripted smoke — e.g. a trivial two-unit `plan.md` (one Codex unit, one Gemini unit) dispatched, each posting a progress message and a result. Claude the captain reads the mailbox. This is the step the owner drives; Claude cannot certify it alone.

## Where model / effort / CLI / flags / skills get *selected* (the Phase 1 pointer resolves here)

- 1b **defined** the catalog + rules table. **2c selects per work unit** from `plan.md`, exactly as the Phase 1 overview promised ("Selected per work unit in Phase 2"). The Phase 0 placeholder record (lead=`claude`, model `default`) is replaced by 2c's real per-unit allocation for team tasks.

## Not in Phase 2 (recorded so it is not lost)

- **1e — MCP catalog of other servers** (§7.5) is still pending from Phase 1; 2c's "plugins/MCP per unit" picks from whatever catalog exists, so 1e can land before or alongside 2c without blocking it.
- **Public release** (README, cross-platform, CPU-only fallback) = **Phase 3** (§8).
- **`crewcast pc`** (PC setup/cleanup/power) = **Phase 4** (§8).

## Status (2026-11-22): paused before 2d/2e

2a–2c are built, reviewed and merged to main (176/176 tests). Per the owner's choice ("build 2a–2c, pause at 2d"), 2d/2e wait on these **vendor facts** being confirmed before dispatch is built on them:
- **Other CLIs' skill-folder paths (§7.8)** — Codex (`~/.codex/skills` or `~/.agents/skills`), Gemini (`~/.gemini/skills`), Copilot (`~/.copilot/skills`), Kiro (`~/.kiro/skills` + agent config). The spec says confirm each in the vendor's official docs.
- **Each CLI's headless invocation** — how to run Codex/Gemini/Copilot/Kiro as a background worker given a task + a per-run MCP config (§7.7).
- **The Claude Code plan-mode hook event (§7.14)** — is it `PostToolUse` on `ExitPlanMode`, and what payload does it carry? Verify against Claude Code docs, then a live check.

## Open calls for the owner

- **Scope of the autonomous loop vs. the live gate** (see above) — how far to build before the owner's live run.
- **Reviewer/CLI availability** on the owner's account (CodeRabbit rate limit, Copilot security review) is verified live, not in unit tests (§7.13).
