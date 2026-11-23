# Phase 1 — overview / roadmap

**What Phase 1 delivers (spec §8):** a clean `npm i -g crewcast` + `crewcast setup` gives a working hook and skill on Claude Code, the decider reachable as MCP tools, the catalogs built, and `uninstall` leaves nothing behind.

**Spec:** `docs/superpowers/specs/2026-11-20-crewcast-design.md` (§7.1, §7.2, §7.5, §7.6, §7.8, §7.9, §7.13, §8).

Phase 1 is built as four sub-plans, in this order. Each produces working, tested software on its own. A detailed task plan is written just-in-time when its sub-plan starts (so we don't over-plan), but the scope of every sub-plan is fixed here so nothing is forgotten.

| Sub-plan | Scope / deliverable | Spec | Status |
|---|---|---|---|
| **1a — MCP server** | `crewcast mcp`: hand-rolled JSON-RPC stdio server exposing `decide` and `catalog` (skills). No SDK (zero deps). | §7.2, §7.4, §7.12 | **plan written** (`2026-11-22-phase1a-mcp-server.md`) |
| **1b — engine catalog** | Detect installed CLIs on PATH + versions; per CLI: headless command, working models, effort flags, parallel limit, safe auto-approve flags, and the **flags-by-rules table** (signals → flags). A `doctor`-style verify that each flag still exists via `--help`, and each model with a tiny call. **This is where model / effort / CLI / flags / arguments are *defined*.** | §7.6 | **plan written** (`2026-11-22-phase1b-engine-catalog.md`) |
| **1c — skill + hook + plugin manifest** | The Claude skill text (when to call `decide`, the captain role §7.13, ASD-STE100 rules, ship steps §7.9); the `UserPromptSubmit` hook (fail-open, adds the record + the captain line on team tasks); the one-command Claude plugin manifest. | §7.2, §7.9, §7.13 | pending |
| **1d — setup / doctor / uninstall + MCP catalog + skill-copy** | The install lifecycle (`setup` builds catalogs, registers the MCP server, installs the skill + hook, writes `installed.json`; `doctor` refreshes + checks; `uninstall` reverses exactly what setup added). The MCP catalog (start each server once, save a one-line description). Copy chosen skills into other CLIs' folders (§7.8). | §7.1, §7.5, §7.6, §7.8 | pending |

## Where model / effort / CLI / flags live (so we don't forget)

- **Defined** in **1b** (engine catalog): the facts and the rules table — which CLIs exist, their working models, their effort flags, their safe flags, and the signals → flags mapping.
- **Selected per work unit** in **Phase 2** (dispatch, §7.14 / §7.7): crewcast reads `plan.md` and, per unit, applies the 1b catalog + rules to pick the CLI, model, effort, flags (and skills, plugins, MCPs), then spawns the worker.
- Phase 0 already writes a **placeholder** engine/model/effort into the record (lead = `claude`, model `default`, effort from the size/risk score; review = Copilot `gpt-5-mini`). 1b replaces the placeholder with the real catalog; Phase 2 does the real per-unit selection.

## Not in Phase 1 (recorded so it is not lost)

- **Dispatch, worktrees, mailbox, and per-unit crew selection** = **Phase 2** (§7.7, §7.14).
- **The plan-first team flow** (spec → `plan.md` → plan-mode gate → dispatch) = **Phase 2** (§7.14). The hook that fires dispatch on `ExitPlanMode` is wired in Phase 2, though the skill text that describes the flow is written in **1c**.
- **Skill picking: embedding-only vs kev** — the final call is still open (spec §7.5). It does not block Phase 1: the MCP `decide` tool reuses the current built decider (mxbai + kev) as-is.

## Open gates

- **Phase 0 branch `feat/phrase-mode-embed-skills` is not pushed/merged.** Phase 1 should build on a merged main. Push/merge is the owner's explicit call; planning does not need it.
