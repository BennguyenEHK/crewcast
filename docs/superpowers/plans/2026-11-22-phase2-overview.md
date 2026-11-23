# Phase 2 — overview / roadmap

**What Phase 2 delivers (spec §8):** dispatch, worktrees, and the mailbox — the MCP tools `dispatch`, `post_message`, `read_messages`, `run_status`. **Done when a two-engine team task runs and its workers report back mid-task.**

**Spec:** `docs/superpowers/specs/2026-11-20-crewcast-design.md` (§7.3, §7.6, §7.7, §7.8, §7.13, §7.14, §8).

Phase 2 is built as five sub-plans, in this order. Each produces working, tested software on its own. A detailed task plan is written just-in-time when its sub-plan starts (so we don't over-plan), but the scope of every sub-plan is fixed here so nothing is forgotten. Phase 2 builds on Phase 1 (merged to main): the MCP server (1a), the engine catalog + flags-by-rules (1b), the skill + hook (1c), and the install manifest (1d).

| Sub-plan | Scope / deliverable | Spec | Needs live CLIs? | Status |
|---|---|---|---|---|
| **2a — mailbox** | MCP tools `post_message(run, from, text)` / `read_messages(run, since)`; one JSONL file per run under `~/.crewcast/runs/<id>/`; secret/key-like redaction on write (§7.7). The two-way channel workers and captain talk over. | §7.7 | No — fakeable | **merged (PR #6)** |
| **2b — worktree manager** | Create/remove a writer's worktree `<repo>-wt/<engine>-<n>` (own branch, shared history); cleanup order (unlink link → folder → branch); never link `node_modules`; the **file-ownership check** (a worker's changed-file list ⊆ its owned list, §7.7/§7.13). | §7.7 | No — temp git repo | **merged (PR #7)** |
| **2c — full decide (per-unit allocation)** | Parse `plan.md` work units (`description` / `files:` / `depends:`); per unit, allocate locally and zero-token: grouping (parallel vs chained by `depends`), skills (embed the unit text, §7.5), CLI/model/effort (1b catalog + rules, §7.6), plugins/MCP (§7.5), flags (§7.6), and each writer's owned-files list. Extends the Decider; reuses the 1b catalog. | §7.6, §7.14 | No — fakeable | **merged (PR #8)** |
| **2d — dispatch + run_status** | MCP tools `dispatch(plan)` and `run_status(run)`. A process per **writing unit** (own worktree; see the 2d ruling) + readers grouped per engine; each worker gets its task card (goal, owned files, done, mailbox run id), its skills (§7.8), its worktree (2b) if it writes, and a per-run env. The file-ownership gate (2b) is in `run_status`. | §7.7, §7.13 | **Plumbing: no** (fake spawner). **Acceptance: yes.** | **merged (PR #10)** |
| **2e — plan-mode dispatch hook** | The Claude Code `PostToolUse`/`ExitPlanMode` hook fires dispatch on plan approval (fail-open, no phantom run on missing plan.md); `installHook` registers it. The exact event firing is a live check. | §7.14 | No — payload fixture | **merged (PR #10)** |

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

## Status (2026-11-22): Phase 2 buildable scope COMPLETE — live acceptance gate remains

2a–2e are all built, reviewed and merged to main (188/188 tests). The MCP server exposes six tools: `decide`, `catalog`, `post_message`, `read_messages`, `dispatch`, `run_status`.

**Vendor-fact research (2026-11-22):** headless invocation is confirmed for Codex (`codex exec`), Copilot (`copilot -p`), and Antigravity (`agy -p`, which replaced the retired Gemini CLI — see PR #9). Skills reach workers via the §7.8 prompt-injection fallback (worker skill-folder paths are unconfirmed, so this is the safe path for all of them). The plan-mode trigger is `PostToolUse` on `ExitPlanMode`.

### Done on the owner's machine (2026-11-22, verified against the real install)
- **All five CLIs detected:** claude 2.1.330, agy 1.5.14, codex 0.166.0, copilot 1.0.105, kiro 3.5.0.
- **C1 — worker launch (PR #11):** `resolveLauncher` resolves an npm `.cmd`/`.ps1` shim (codex, copilot) to `node <cli.js>` and spawns it with `shell:false`; real `.exe`s (agy, kiro-cli) launch directly. The untrusted prompt never reaches a shell. Verified: all four resolve to a launchable command that exists on disk.
- **I1 — worker mailbox (PR #12):** `setup` registers crewcast's MCP into every installed CLI (`<cli> mcp add crewcast -- crewcast mcp`; syntax confirmed per CLI), so each worker has `post_message`.

### Live acceptance gate — still the owner's to run
1. **Make `crewcast` a global command** so the registered `crewcast mcp` resolves: `npm i -g .` (or `npm link`) in `D:\dev\crewcast`. (Workers launch `crewcast mcp`, which must be on PATH.)
2. **`crewcast setup`** — registers MCP into all installed CLIs, installs the hook, copies skills, pre-warms. Idempotent; `crewcast uninstall` reverses it exactly.
3. **`ExitPlanMode` hook firing:** confirm a `PostToolUse`/`ExitPlanMode` hook fires on your Claude Code version.
4. **Worker non-interactive approvals (recipe tuning):** confirm each writing worker runs without hanging on a tool prompt *and* without being permission-off (§3) — agy has `--mode accept-edits|auto`, codex uses `--sandbox workspace-write`, copilot `--allow-all-tools` (I5: confirm it's worktree-scoped, not global). Tune the recipes from what the live run shows.
5. **The §8 gate:** a two-unit `plan.md` (one Codex, one Antigravity), approve the plan, watch both workers post progress to the mailbox mid-task.

## Open calls for the owner

- **Scope of the autonomous loop vs. the live gate** (see above) — how far to build before the owner's live run.
- **Reviewer/CLI availability** on the owner's account (CodeRabbit rate limit, Copilot security review) is verified live, not in unit tests (§7.13).
