# crewcast — design

- **Date:** 2026-11-20
- **Status:** approved by the owner, 2026-11-20
- **Next step after approval:** `superpowers:writing-plans`
- **Where this came from:** a brainstorming session in `D:\dev\quoteflow_ai` (owner + Claude). Everything the owner decided is in §9.

---

## 1. Intent: what it is and why

crewcast is a local program that sits between the user and their AI coding CLIs (Claude Code first, also Gemini CLI, Codex, Copilot CLI, Kiro CLI).

When the user types a task ("implement authentication", "evaluate this idea"), crewcast **decides how the work runs, before any AI model spends tokens on it**:

1. Solo (Claude does it alone) or team (parallel agents).
2. For a team: how many agents, which CLI each one uses, and which model, effort and mode.
3. Which skills, plugins and MCP servers each agent needs.
4. Whether to make a new git branch or worktree.

It makes these decisions with a **local non-generative decision model** (a model that picks from a list or answers yes/no; it does not write text) plus plain rules. So the decisions are fast, cost no AI tokens, and can never contain invented text.

**Why:** the owner orchestrates several CLIs by hand today (see `quoteflow_ai/CLAUDE.md`, "Agent Policy"). That costs Claude tokens and attention on every task. crewcast turns that policy into a fast, repeatable, local step.

**Name:** "crewcast". A casting director picks the right performer for each role, and "cast" also means "send out". crewcast picks the crew and sends it out.

## 2. Users

- **First:** the owner, on a Windows 11 Lenovo laptop (RTX 4060 8 GB, Node 22, Python 3.13, uv, Ollama, and the five CLIs above already installed).
- **Later:** the public, through GitHub and npm. So nothing may be hard-coded to the owner's machine: paths, CLIs and models are detected or configured.

## 3. Goals, non-goals, anti-goals

**Goals**
- Reliable, fast decisions: p95 under 1.5 s on the owner's laptop with the model loaded.
- Zero AI tokens for a decision, except an explicit low-confidence fallback (§7.3).
- No invented output: every decision is one value from a known list.
- Works with many CLIs, with Claude Code as the main one.
- One install: `npm i -g crewcast`, then `crewcast setup`.
- Small on disk, apart from the decision model, which goes where the user chooses.

**Non-goals (not in this version)**
- PC setup, disk cleanup and power modes. These come later as `crewcast pc ...` (§8, phase 4).
- Searching, installing or removing skills. Later; reuse `npx skills` (vercel-labs/skills) where possible.
- Rewriting the user's prompt. A non-generative model cannot rewrite text.
- Cloud anything: no Cloudflare AI Gateway, no hosted router, no telemetry.
- A web UI.

**Anti-goals (a failure even if it "works")**
- Push or deploy without the user's explicit "yes" for that push.
- Starting any CLI with permission checks off (`--dangerously-skip-permissions`, `--yolo`, `--allow-all-paths`).
- A wrong decision presented as certain. Low confidence must show as low confidence.
- The hook (§7.2) blocking or breaking the user's prompt when crewcast fails.
- Install-time scripts (`postinstall`) that change the machine.
- Uninstall leaving files or registrations behind.

## 4. Constraints

- Windows first; must also work on macOS and Linux for public users. **No tmux dependency.**
- 8 GB VRAM on the owner's GPU. Public users may have no GPU.
- Gemini CLI on the free tier rate-limits fast (`429`), so Gemini work runs one task at a time.
- Ollama runs one model slot at a time, so local "parallel" model calls are not real parallelism.
- Skills from Claude are not visible to other CLIs unless they are copied into each CLI's own skills folder (§7.8).
- Node 22+, TypeScript, npm (§9).

## 5. Prior art, and what is different

| Project | What it does | Why not just use it |
|---|---|---|
| **awslabs/cli-agent-orchestrator (CAO)** | Local server, starts provider CLIs in terminal sessions, gives a supervisor tools to delegate to workers. | Needs tmux and Python, so no native Windows. It has **no automatic decision** of who does what; the supervisor model decides, and that spends tokens. |
| **omnigent** | A large "meta-harness" over ~18 agent CLIs: sessions across devices, cloud sandboxes, policies. | Heavy (Python, cloud extras). Also no local decision model. |
| **claude-code-router, vLLM Semantic Router, RouteLLM** | Route API requests between models. | They route *API calls*, not *CLI agents, skills and team size*. |

**crewcast's difference is the decision step:** local, non-generative, zero-token choice of mode, crew, engines and skills. Dispatch and messaging (phase 2) stay small, and only exist so the decision can be carried out on Windows without tmux.

Builder: read CAO's `CODEBASE.md` before phase 2. Its worker and supervisor tool design is a good reference.

**Research that shaped this design**
- One public test of Laya as a coding-agent model router got 21/48 correct and was confident 0/48 times ([dev.to](https://dev.to/projectescape/can-decision-models-like-jev-and-laya-route-a-coding-agent-2j98)).
- Six commercial routers did no better than picking at random between two well-chosen models ([arXiv 2610.02762](https://arxiv.org/pdf/2610.02762)).
- Three of four open-source routers gave nearly the same tier for every task ([arXiv 2608.14641](https://arxiv.org/pdf/2608.14641)).
- **Consequence:** in v1, the decision model answers small, concrete questions it is good at. Model and effort come from rules and the CLI's own auto mode, **not** from the model guessing "how hard is this".

## 6. Approaches

| | Approach | Trade-off |
|---|---|---|
| **A** | **crewcast does it all, in phases: decider first, then its own small dispatcher and mailbox** (TypeScript, MCP server). | Most work in total, but each phase is useful alone, and it works on Windows. **Chosen.** |
| B | Decider only; dispatch through CAO. | Reuses CAO's dispatch, but needs tmux and Python. That rules out native Windows, the owner's platform. |
| C | Decider only, forever; Claude dispatches with its own tools (`codex exec`, `gemini -p` in background shells, the `dispatch-parallel-teams` skill). | Smallest, but no two-way messages. The owner asked for agents that talk back like a team. |

**Chosen: A, delivered so that phase 1 is approach C.** The decider ships first and is useful on its own. The dispatcher and mailbox come next. This is Claude's call: the owner asked for the full spec without picking an approach, so they should confirm it.

## 7. Design

### 7.1 Install and setup (what the user does)

```
npm i -g crewcast        # downloads the program; changes nothing else; prints "run: crewcast setup"
crewcast setup           # interactive, safe to run again
crewcast doctor          # checks everything, refreshes the engine catalog
crewcast uninstall       # removes everything setup added
```

`crewcast setup`, step by step (each step asks first and can be skipped):
1. Detect CLIs on PATH (`claude`, `gemini`, `codex`, `copilot`, `kiro-cli`) and their versions.
2. Offer to install a missing CLI. Show the exact npm command first, and run it only after a "yes".
3. Offer to open each CLI's login page in the browser.
4. Detect Ollama and the GPU and VRAM. Pick the decision-model backend (§7.3), show the download size, and pick the storage place from free space (§7.11).
5. Register the MCP server with each chosen CLI (for Claude: `claude mcp add --scope user crewcast -- crewcast mcp`).
6. Install the crewcast skill for Claude, and copy it into the other CLIs' skill folders (§7.8).
7. Install the Claude Code hook (§7.2), if the user wants it.
8. Build the catalogs (§7.5, §7.6).
9. Write a manifest of everything it added to `~/.crewcast/installed.json`. `uninstall` reads it and removes exactly those things.

The repo also ships a **Claude Code plugin manifest**. Its MCP entry runs `npx -y crewcast mcp`, so Claude users can install the plugin (skill + MCP + hook) with one command, while the code lives on npm.

### 7.2 The parts

| Part | What it is |
|---|---|
| `crewcast` CLI | `setup`, `doctor`, `uninstall`, `decide "<task>"` (prints the decision record), `stats` (shadow-mode results). Later `run`, `pc`. |
| `crewcast mcp` | MCP server over **stdio only** (no network port). Tools: `decide`, `catalog`, and, in phase 2, `dispatch`, `post_message`, `read_messages`, `run_status`. |
| crewcast skill | Tells Claude when to call `decide`, how to read the decision record, how to dispatch, the lead's captain role and review flow (§7.13), the ASD-STE100 explanation rules, and the ship steps (§7.9). |
| Claude Code hook | A `UserPromptSubmit` hook. It runs `crewcast decide` on each prompt and adds the decision record as one short context block. **It fails open:** on error, timeout (2 s) or a short prompt (under ~8 words, e.g. "thanks", "yes"), it adds nothing and the prompt goes through unchanged. |

The hook is the only way to guarantee the decider runs on every task, because a skill runs only when Claude chooses to call it. Typing `/crewcast <task>` always forces it.

**When the record says `mode: team`, the hook's context block also carries one line for the lead:** "You are the team captain: delegate, read reports, route reviews; do not write code or review diffs (crewcast skill, §7.13)." So the rule reaches Claude on every team task, even when Claude does not open the skill.

**Two speeds (Claude's call):**
- **Fast decide (hook):** only the signal questions, skill/MCP picks and a solo-or-team suggestion. All signals go to Nimble as **one schema call** (Nimble takes several enum and boolean fields in one request), so it is one model pass, not seven. No unit splitting, no pair questions, no Claude call. Must fit the 2 s hook limit.
- **Full decide** (`/crewcast`, the MCP `decide` with `full: true`, or `crewcast decide --full`): adds unit splitting, pair independence questions, agent count and per-agent engines. It may use the one Claude planning call (§7.3). It runs only when the user or Claude asks for a team plan.

**Who leads (Claude's call):** the lead is the CLI that called `decide` (Claude through the hook or skill; Gemini or Codex through MCP). The rules are shared; the lead's own engine is left out of the worker list. Claude-specific parts (hook, plugin) exist only for Claude.

### 7.3 The decider

**Design: small questions → plain rules → one decision record.**

The decision model is asked a fixed set of concrete questions. Each answer is one item from a list, or yes/no, with a probability:

| Signal | Type | Options |
|---|---|---|
| `task_type` | choice | implement, fix, review, research, plan/design, docs, test, refactor, ops/setup |
| `writes_files` | yes/no | |
| `risk_area` | choice | none, auth, database schema, payments, deploy/infra, secrets |
| `size` | choice | one file, a few files, many files or modules |
| `needs_web` | yes/no | |
| `skills` | choice, top-k | shortlist from the skill catalog (§7.5) |
| `mcps`, `plugins` | choice, top-k | from the catalog |

**Solo or team comes from the user's own words (owner's decision, 2026-11-21).** If the prompt contains a team phrase ("use team agents", "teamagents", "parallel agents", …; the list is in the rules), the mode is `team`. Otherwise it is `solo`. The model does not decide the mode: in phase 0 every model scored 0–43 % on it. `size` and `risk_area` are still asked, but they only set effort, the review agent and the branch. For team tasks, the real size comes later from the file list (§7.13).

**Plain rules** turn the signals into the decision. The rules live in a readable config file (`rules.yaml` or similar, builder's choice), so the user can edit them. The default rules come from the owner's Agent Policy:
- size and risk give a 1–5 score;
- score 1–2 → solo or one cheap worker;
- score 3 → one strong worker;
- score 4–5, or any `risk_area` other than none → Claude leads, with workers for the independent parts;
- Gemini work is always sequential.

**Number of agents** is not a model guess. It comes from the captain's plan (§7.14):
1. The captain writes the work units in `plan.md` and states each unit's dependencies (`depends:`). The captain already knows them, so crewcast never asks a model.
2. crewcast groups the units by those dependencies: independent units run in parallel, dependent units chain.
3. Agents = number of independent groups, capped by each engine's limit.

(This replaces the earlier pair-independence yes/no questions: the captain states the dependencies, so a model need not re-derive them.)

**Model, effort and mode in v1:**
- a fixed default per engine from the engine catalog;
- the CLI's own auto mode where one exists (Kiro), and crewcast then stops choosing;
- rule overrides (e.g. risk_area other than none → the strongest model, high effort).

The decision model does not choose these in v1 (see the research in §5).

**Branch rule (code, not model):**
- if `writes_files`, the repo is on its default branch, and the tree is dirty or the work spans more than one unit → propose a new branch;
- each parallel writer gets its own git worktree;
- worktree cleanup removes the link only. It never deletes through a junction: on the owner's machine, deleting through a `node_modules` junction once emptied the real folder.

**Confidence gate:** each signal has a threshold (calibrated in phase 0). Below it:
1. the record marks that signal `uncertain`;
2. the skill tells Claude to settle it itself, with one short question to the user if needed;
3. crewcast never fills it with a guess.

**Backends (swappable).** One interface: `ask(question, options) → { choice, probs }`.

| Backend | When | Notes |
|---|---|---|
| **Nimble via Ollama** (`ollama pull nimble`, Ollama ≥ 0.35 `/v1/systemone`; the owner has 0.40.16) | **Default** when a GPU with roughly ≥ 8 GB is found | Apache-2.0, 9B, **~9.5 GB download** (bigger than 8 GB VRAM, so expect a partial CPU split; phase 0 measures the latency). Through Ollama: `choice` takes 2–26 options, up to 64 questions per request, body ≤ 64 KiB, 8,192-token input (longer input is rejected, not cut off). 90.1% vs Jev's 93.2% on its makers' 324-example test. Other Ollama decision models (`tev1`, `laya`) use the same endpoint, so trying them is a name change. |
| SCX Router v0.1 (0.6B, Apache-2.0, `gliclass`) | Low-VRAM or CPU-only machines | Python, so a sidecar process. Predicts difficulty and reasoning-or-not; accepts custom labels. |
| Embedding similarity only | Last fallback; skill matching only | All yes/no signals become `uncertain`. |

Laya was considered and dropped: it reads only 512 tokens, and did worst in the one routing test.

### 7.4 Decision record (the contract)

Every caller (hook, MCP tool, CLI) gets the same JSON:

```json
{
  "version": 1,
  "task": "implement authentication",
  "mode": "team",
  "shadow": true,
  "signals": {
    "task_type":   { "value": "implement", "p": 0.91 },
    "writes_files":{ "value": true,        "p": 0.97 },
    "risk_area":   { "value": "auth",      "p": 0.88 },
    "size":        { "value": "many",      "p": 0.62, "uncertain": true }
  },
  "branch": { "action": "new", "name": "feat/authentication" },
  "agents": [
    { "role": "lead",   "engine": "claude", "model": "default", "effort": "high",
      "skills": ["lock-in"], "mcps": [] },
    { "role": "review", "engine": "copilot", "model": "gpt-5-mini", "effort": null,
      "skills": ["security-review"], "mcps": [] }
  ],
  "ms": 640,
  "backend": "nimble-v2@ollama"
}
```

Field names are a sketch; the builder may refine them, but must keep: one value per field, a probability per signal, and an `uncertain` flag.

### 7.5 Catalogs (what the decider can choose from)

Built at setup and refreshed by `doctor`. Stored in `~/.crewcast/`.
- **Skills: connect, never copy.** crewcast reads the frontmatter (name + description) of each `SKILL.md` in place. That is what Claude itself uses to choose skills; the body (the instructions) is read only when a skill must be handed to a CLI that cannot read skills (§7.8). Sources:
  - project `.claude/skills`;
  - `~/.claude/skills`, **following links** (41 of the owner's 55 are links);
  - **enabled** plugins at their **installed** version, from Claude's `installed_plugins.json` + `settings.json` `enabledPlugins`. Never by walking the plugin cache, which also holds old versions and disabled plugins.

  **Changed 2026-11-21:** a small skill-embedding index (`~/.crewcast/skill-index.json`) is now kept. Each skill's vector is stored with the file's change time, and only new or changed skills are embedded again. The frontmatter itself is still read live. *(The earlier rule, kept for history:)* **Read live on every decide, no stored copy (owner's decision).** Only the frontmatter is read. A full read took 200–540 ms on the owner's machine; if phase 0 shows the total is too slow, add a small index that is reused while the files' change times are unchanged. Each skill name counts once across all scanned folders. `crewcast skills` lists what crewcast sees.
- **How skills reach the model:** each shortlisted skill becomes one yes/no question whose text includes the skill's name and description; `state` is the user's task. The `SKILL.md` body is never sent to the decision model: it exceeds the request limits, and it is for doing the work, not for choosing.
- **MCP servers:** chosen per **server**, never per tool (servers can have 200+ tools; the agent picks tools itself once connected). CLI configs hold only how to start a server, not what it does. So `setup`/`doctor` start each server once, read its tool list, and save a one-line description (user-editable) in `~/.crewcast/mcp-catalog.json`. Servers that need a login, or fail to start, get a description from their name plus a "needs description" flag shown in `doctor`. This is the one catalog that is stored, not read live.
- **Plugins:** not chosen as a whole. A plugin's skills are in the skill list and its MCP servers in the MCP list; choosing those covers it.
- **CLIs, models, effort, flags:** crewcast's own engine catalog (§7.6), with descriptions written by us. Flags are facts from vendor docs, checked by `doctor`, never chosen by the model. In v1, rules choose from it, not the model.
- **Shortlist by embedding (updated 2026-11-22).** A user can have 300+ skills; the owner has 136.
1. The embedding model is **`mxbai-embed-large`** (through Ollama's `/api/embed`; the task carries mxbai's query prefix). It ranks every skill's `name + description` against the text by cosine. On the phase-0 challenge it beat `all-minilm` and `nomic-embed-text` (recall@8 0.908).
2. The final pick is made one of two ways, both measured in phase 0 against all 136 skills:
   - **embedding only** — keep the skills above a cosine threshold (≈0.55), capped at 3. Overall skills agreement **0.822**, and it correctly picks nothing when nothing fits.
   - **decision model (kev 4B)** — one yes/no per shortlisted skill. Overall **0.795**.
   embedding-only wins overall and drops a whole model (no 2.7 GB download). kev wins only on multi-skill (0.53 vs 0.40). The plan-first flow (§7.14) picks skills **per work unit**, which is embedding's strength and should remove kev's only edge — so the decision model is likely dropped for skills; final call pending a per-unit check.
- If the embedding model is missing, the keyword prefilter is the fallback.

### 7.6 Engine catalog

A data file per installed CLI, refreshed by `doctor`. For each CLI it records:
- the headless command;
- the model and effort flags;
- the models that actually work on this account;
- its parallel limit;
- its safe auto-approve flags.

Model lists go stale; for example, Gemini CLI's built-in default model is already out of date. So `doctor` checks each model with a tiny call before marking it usable.

**Flags by task (owner's request, 2026-11-21): a rules table per CLI, never the model.** The signals pick the flags. For example: `writes_files` → `--sandbox workspace-write`; a read-only task → `--sandbox read-only`; a `risk_area` other than none → the strongest model and high effort. `doctor` reads each CLI's `--help` only to check that every flag in the table still exists. A model never picks flags, so it can never choose unsafe ones such as `--yolo` or "skip permissions".

Known recipes from the owner's setup, all to be verified by the builder:
- `gemini -m <model> -p "<task>" -y --output-format json`
- `codex exec --model <m> -c model_reasoning_effort='"<e>"' --sandbox workspace-write --json`
- `copilot -p "<task>" --model <m> --allow-all-tools -s`
- `claude -p`
- `kiro-cli` (headless flags: builder to find)

### 7.7 Dispatch and mailbox (phase 2)

- **One process per engine group, not one per agent.** If three units go to Codex, start one Codex run and let it use its own subagents. Start separate processes only for different engines, models or worktrees.
- Workers start as background child processes of the MCP server. Each gets: its task, its skills (§7.8), a worktree if it writes files, and the crewcast MCP config so it can talk back.
- **Mailbox:** the MCP tools `post_message(run, from, text)` and `read_messages(run, since)`, stored as one JSONL file per run under `~/.crewcast/runs/`.
  - Workers post progress, questions and results.
  - Claude reads the mailbox. To get notified, it watches the file (Claude Code `Monitor`, or a background shell that exits on a new message).
  - Claude can post replies, which the worker reads on its next check.
  - This makes the agents a two-way team, not fire-and-forget subagents.
- Workers never run with permission checks off (§3). Each CLI's auto flags are scoped to the repo.

**Shared environment, so the team works as one** (raised by the owner, 2026-11-20):
- **One codebase.**
  - Read-only workers (review, research) run in the main folder.
  - Each **writing** worker gets its own git worktree (`<repo>-wt/<engine>-<n>`, its own branch, same history).
  - No two writers ever share a folder.
- **File ownership.** The full decide gives each writer a list of the files it owns. Before merging, the lead checks that the worker's changed-file list stays inside that list. It checks the list of file names, not the diff (§7.13).
- **Merge.**
  - Only the lead decides to merge. It decides from the worker's report, the test result and the reviewers' verdicts, never by reading the diff (§7.13).
  - A worker resolves any merge conflicts, and the reviewers check that fix like any other change.
  - After merging: remove the worktree link first, then the folder, then the branch.
- **Same project rules.**
  - One shared `AGENTS.md` holds the project rules. `CLAUDE.md` imports it (`@AGENTS.md`), and Gemini is set to read it as a context file. Codex reads it natively.
  - Copilot and Kiro: the builder verifies whether they read `AGENTS.md`.
  - `setup` offers to create this; it never overwrites an existing file without a yes.
- **Task card.** Each worker gets a short card in its prompt and in the mailbox: goal, owned files, done criteria, the mailbox run id.
- **Tools.** Each worker gets only the MCP servers the decision picked, passed through that CLI's per-run config. Logins are per CLI (done once in `setup`).
- **Dependencies.**
  - A writer that must build runs a normal install inside its worktree (the npm cache keeps it fast).
  - **Never link a worktree's `node_modules` to the main one.** Deleting through such a link emptied the real folder on the owner's machine.
- **Secrets.**
  - Workers inherit the lead's environment and can read repo `.env` files.
  - The mailbox and logs redact key-like strings, and the task card tells workers never to print secrets.

### 7.8 Sharing skills with other CLIs

- Most of these CLIs read the same `SKILL.md` folder format, each from its own folder. Sources disagree on the exact paths, so the builder must confirm each in the vendor's official docs:
  - Codex: `~/.codex/skills` or `~/.agents/skills`
  - Gemini: `~/.gemini/skills`
  - Copilot: `~/.copilot/skills`
  - Kiro: `~/.kiro/skills`, and also listed in the Kiro agent config
- **Copy, don't link.** On Windows, symlinks need admin or Developer Mode, and junctions risk delete-through. Skills are small. The manifest (§7.1) lists every copied folder, so updates and uninstalls touch only crewcast's copies.
- Only the skills the user selects are copied, not all 300.
- A CLI that cannot read skills gets the chosen skill's text added to the worker's prompt. Only the chosen skills, so the token cost stays small.
- Hooks are not used for this: hooks are a Claude Code feature and do not run inside other CLIs.

### 7.9 Explanation style and ship steps (inside the skill)

- **ASD-STE100:** all explanations to the user follow a short list of STE rules written in our own words: short sentences, one instruction per sentence, active voice, one meaning per word. Do not copy the official specification or its word dictionary; they come with a license.
- **Ship steps,** in this order, after code or a plan is done:
  1. optimize
  2. review by the reviewer team (§7.13): CodeRabbit CLI for the full review of each finished task, and Copilot `gpt-5-mini` for the security review. Both are different model families from Claude.
  3. secret scan and dependency audit
  4. type check, lint, tests, build
  5. commit on a branch (may be automatic)
  6. a short STE summary to the user
  7. **push and deploy only after the user says "yes" for this push**

  Securing and hardening come **before** deploy, never after.

### 7.10 Shadow mode and the test set

- **Phase 0 builds a test set** of ~50 real past tasks from the owner, each labelled with the right decision (mode, engines, skills). Candidate sources: the owner's past Claude sessions and git history.
- **Shadow mode is on by default.** The record has `"shadow": true`. Claude treats it as a suggestion and decides as usual. crewcast logs its decision next to what really ran, in `~/.crewcast/shadow.jsonl`.
- **What really ran (Claude's call):** a Claude Code `Stop` hook reads the session transcript (the hook receives its path) and records what actually happened: the skills invoked, subagents or background CLIs started (and which engine), whether files were edited, and whether a branch was made. That record is the "actual" for the shadow log. `crewcast label <id>` lets the user correct a row by hand. Other CLIs have no such hook, so their rows are labelled by hand only.
- `crewcast stats` shows agreement per signal.
- The user turns shadow mode off when agreement is high enough. **Proposed: ≥ 90% over ≥ 50 tasks.** The owner confirms the number.

### 7.11 Disk and locations

- Program: a few MB in the global npm folder.
- State: `~/.crewcast/` (catalogs, logs, runs). Small. Run logs older than 30 days are removed.
- Decision model: stored by **Ollama**, never inside crewcast's install folder or any repo. Setup picks the place from free space:
  1. Read the effective `OLLAMA_MODELS` (user setting first, then system, then Ollama's default `~/.ollama/models`).
  2. If that drive has room for the model plus a 20% margin, use it and change nothing.
  3. If not, suggest the fixed drive with the most free space. Set the **user** `OLLAMA_MODELS` only after a "yes", and warn that existing models must be moved too, or Ollama will no longer find them.
  4. Show the free space on every drive before any download.
- `doctor` flags an `OLLAMA_MODELS` that points to a drive or folder that does not exist. (The owner's machine has a system-wide `E:\models` with no E: drive; the user setting `D:\models` overrides it.)
- Owner's machine today: Ollama models are already in `D:\models` (4.4 GB, D: 73 GB free), so Nimble goes there with no change.

### 7.12 Security

- MCP over stdio only; no listening port.
- No `postinstall`; every machine change happens in `setup` after a prompt.
- No command that turns permission checks off. No admin or elevation, ever, in this version.
- The mailbox and logs never store environment variables or tokens. The builder adds a redaction pass for common key patterns.
- Skill copies are tracked by the manifest, so a skill folder crewcast did not create is never touched.

### 7.13 The lead's role: team captain (owner's decision, 2026-11-21)

**Who is who:**
- **The user is the CEO.** The user sets the goal, and says "yes" before any push or deploy.
- **The lead (the orchestrator, Claude by default) is the team captain**, like a tech lead who does not write code.
- **Workers** (Codex, Gemini, Copilot, Kiro) write the code, on the user's subscriptions.
- **Reviewers** (CodeRabbit CLI and Copilot) check the code.

**When it applies:** when the decision record says `mode: team`. In `solo` mode there is no team, so the lead does the task itself (§1).

**What the captain does:**
1. **Spec, then plan (§7.14).** For a team task, write a short spec (goal, scope, done) for the user to approve. Then, in plan mode, write `plan.md`: the work units, each with its description, its files and its dependencies. Name no CLI, model or skill — crewcast allocates those. The user approves the plan; that approval dispatches the crew.
2. **Assign is crewcast's job, not the captain's.** From `plan.md`, crewcast allocates each unit's CLI, model, effort, skills, plugins, MCP servers and flags (§7.14). The captain gives each worker only the task card: the goal, its owned files and what "done" means (§7.7).
3. **Guide with ideas only.** Give design directions, for example "use a queue here" or "keep this in one module". Never give code.
4. **Read the worker's report.** Read the report only, never the code. Look for these warning signs:
   - The report claims tests, but shows no test output.
   - The changed-file list includes files outside the worker's own list.
   - The report says "done", but it also lists concerns.
   - The report does not match the task, or it skips a part of the task.
5. **Do one cheap check.** For example, run the tests and read only pass or fail.
6. **Send the work to review:**
   - Normal case: CodeRabbit CLI reviews the finished task.
   - A warning sign: a reviewer inspects that point. Reviewers read only; they do not edit.
   - Ship step 2 (§7.9): Copilot `gpt-5-mini` does the security review.
   - Size: in team mode, the captain asks Claude Code's built-in Explore agent for the list of files the task touches, and counts them (§7.3). It reads the list, not the code.
7. **Route fixes.** Send the reviewer's findings back to the worker who wrote the code. Then the reviewer re-checks only the fix.
8. **Make the important calls:**
   - When the two reviewers disagree, the captain decides.
   - When a fix still fails after 3 rounds, the captain decides: accept with a recorded reason, re-assign the part, or ask the user.
   - The captain decides when to merge.
9. **Report to the user.** Give a short ASD-STE100 summary: what was done, what was decided, and what is left.

**What the captain never does:**
- It never writes code or fixes.
- It never reads or reviews diffs.
- It never resolves merge conflicts. A worker does that (§7.7).
- It never pushes or deploys without the user's "yes" for that push (§7.9).

**Why:**
- **Fewer lead tokens.** Reading code and diffs is the biggest cost for the lead. The captain reads only short reports.
- **Independent checks.** A model from a different company checks every change, never the worker that wrote it.
- **The subscriptions do the heavy work.**

**Reviewer limits (checked 2026-11-21; verify on the user's account):**
- CodeRabbit CLI installs natively on Windows (PowerShell installer). Its free tier allows about 3 CLI reviews per hour; sources differ, and some say 2. So it gets one full review per finished task, not one per fix round.
- Copilot does the security review and the quick re-checks after fixes.

**How it is enforced:** crewcast cannot force a model's behaviour. These rules live in the crewcast skill, and the hook repeats the one-line captain rule on every team task (§7.2).

### 7.14 Team flow: spec → plan → dispatch (owner's proposal, 2026-11-22)

When `mode` is `team`, the work goes through a plan-first flow. The captain plans the work; crewcast allocates the crew. The captain spends tokens only on planning, so crew allocation stays free and local.

**Sequence**
1. **Spec.** The captain writes a short spec: goal, in-scope, out-of-scope, done criteria. It is for the user, in plain prose. crewcast remembers it in `~/.crewcast/runs/<id>/`.
2. **The user approves the spec.**
3. **Plan.** In Claude Code plan mode, the captain writes `plan.md`. Plan mode is the safe container: no code is written until the user approves. The planning skills do the work inside it — `superpowers:brainstorming` for the spec, `solutions-search` for research, `superpowers:writing-plans` for the plan.
4. **The user approves the plan.** The plan-mode approval (`ExitPlanMode`) is the signal. A `PostToolUse` hook on that event tells crewcast to dispatch. (The exact hook event is verified in Phase 1.)
5. **Dispatch.** crewcast reads `plan.md`, allocates the crew (below) and starts the workers (§7.7).

**`plan.md` holds the work only — never the crew.** Each unit is one block:
- a short **description** of the unit;
- `files:` the files it owns;
- `depends:` the units it needs first (or none).

The captain names no CLI, model, skill, plugin or flag. Naming them would spend captain tokens on crewcast's job, and would let a model pick a CLI or a flag — which §7.6 forbids for safety.

**From `plan.md`, crewcast allocates per unit (locally, zero tokens):**
- **agent grouping** — independent units (by `depends:`) run in parallel; dependent units chain (§7.3);
- **skills** — embed the unit's text and pick per unit (§7.5). Per-unit text is focused, so the multi-skill problem of picking off the raw prompt goes away;
- **CLI, model, effort** — from the engine catalog and the rules table (§7.6), keyed off the unit's size and risk;
- **plugins and MCP servers** — from the catalogs (§7.5);
- **flags / arguments** — from the per-CLI rules table (§7.6). A model never picks a flag, so it can never pick an unsafe one.

**Solo gets a smaller version.** In `solo` mode crewcast decides one more thing: do it now, or plan first.
- **Immediate** — the captain does the task itself, or hands it to one CLI agent. This is the default.
- **Needs a plan** — only when the task is clearly large (the `size` signal, or the user asks). Then the captain writes a short plan first, still solo. No extra model for this call.

**Why this is token-optimal.** The captain writes two things: a short spec (for the user) and the work breakdown (for crewcast). It never reasons about which CLI, model or skill goes where. That repeated, expensive reasoning moves to the free local layer — crewcast's whole purpose.

## 8. Phases

| Phase | Delivers | Done when |
|---|---|---|
| **0** | Test set (146 synthetic tasks, all 136 skills); `crewcast decide "<task>"`; shadow log; `stats` | **Done (2026-11-22): go.** mode 1.00, skills 0.795–0.822, p95 ~1.1 s on the owner's laptop. Model `kev:4b-q4_K_M`, embedding `mxbai-embed-large`. See `docs/phase0-results.md`. |
| **1** | `setup` / `doctor` / `uninstall`; MCP server with `decide` and `catalog`; Claude skill (incl. STE and ship steps); hook; plugin manifest; skill copy to other CLIs. Built as sub-plans **1a** MCP server → **1b** engine catalog (model/effort/CLI/flags) → **1c** skill + hook + manifest → **1d** setup/doctor/uninstall + MCP catalog + skill-copy (roadmap: `docs/superpowers/plans/2026-11-22-phase1-overview.md`). | A clean `npm i -g` + `setup` on the owner's laptop gives a working hook and skill, and `uninstall` leaves nothing behind. |
| **2** | Dispatch, worktrees, mailbox (`dispatch`, `post_message`, `read_messages`, `run_status`) | A two-engine team task runs, and its workers report back mid-task. |
| **3** | Public release: README, cross-platform checks, CPU-only fallback backend | Works on a machine with no GPU and on macOS or Linux. |
| **4 (later)** | `crewcast pc` (setup, cleanup, power mode, reusing the `windows-disk-cleanup` skill's approve-each-row rules); skill search, install and remove | Separate design when it starts. |

## 9. Decisions

**Decided by the owner**
- Name: **crewcast**. Folder: `D:\dev\crewcast`.
- Distributed on npm and GitHub; the owner uses it first, then shares it publicly.
- A local MCP server plus a skill, installed through npm.
- A local non-generative decision model (Laya, Jev or Nimble type).
- Start with: solo or team, choosing skills, plugins and MCPs, and agent setup. PC setup comes later.
- Explanations in ASD-STE100.
- After the work: update, commit, push, deploy, secure, harden, optimize. (The order and the push gate are Claude's proposal; see below.)
- Not in scope: magpie, omniroute, Cloudflare.

**Claude's calls (the owner did not object; confirm while reading)**
- TypeScript and Node, and a separate `setup` command instead of `postinstall`.
- Nimble v2 via Ollama as the default backend, with fallbacks.
- In v1, model and effort come from rules and the CLI's auto mode, not from the model.
- Ship order: secure and harden before deploy, and push/deploy only after the user's "yes".
- A Claude Code plugin manifest in the repo.
- Copy skills instead of linking them.
- Approach A, phased (§6).
- Two speeds: fast decide in the hook (one Nimble schema call), full decide only when a team plan is asked for (§7.2).
- The lead is the CLI that called `decide`; rules are shared (§7.2).
- "What really ran" for shadow mode comes from a Claude `Stop` hook reading the transcript, plus manual `crewcast label` (§7.10).

**Decided by the owner on 2026-11-20 (spec approved)**
- **Hook on by default.** The skill stays, for `/crewcast` and the full decide.
- **Go/no-go after phase 0:** pass = ≥ 80% agreement on solo-or-team **and** on the skill picks. If it fails: phase 1 ships skill picking only, using description matching with no big model. Solo-or-team stays with the user or Claude. **No Python (SCX) fallback by default**, because it breaks "one npm install".
- **Test set:** Claude drafts the labels for ~50 past tasks from the owner's sessions and history; the owner corrects them (~1 hour). Labels are at the level of mode, engines and skills. Signal-level labels (task_type, size, risk_area) are drafted by Claude and only spot-checked.
- **Approach A, phased:** the decider first, then the dispatcher and mailbox.
- **Model storage** goes where the free space is, never in the repo (§7.11). The owner suggested a `model/` folder in the project; Claude advised against it for the reasons in §7.11, and the owner can override.

**Decided by the owner on 2026-11-21**
- **The lead is the team captain** in team mode (§7.13). It plans, assigns, guides with ideas, reads reports, routes reviews and fixes, and makes the important calls. It never writes code, never reviews diffs, and never resolves merge conflicts.
- **Reviewer team: CodeRabbit CLI and Copilot** (§7.13). Reviewers find problems; the worker that wrote the code fixes them.
- **Solo or team from the user's phrase**, not from the model (§7.3).
- **Skill picking:** an embedding filter (top 8), then kev 4B yes/no; a small skill index is kept (§7.5).
- **Default decision model: `kev:4b-q4_K_M`** (2.7 GB, Apache-2.0, 100 % GPU on the owner's 8 GB card). This follows `docs/phase0-results.md`. `nimble-v3` was more accurate, but it is non-commercial and too slow on this laptop.
- **Team-task size = the number of files involved.** In team mode, the captain asks Claude Code's built-in **Explore** agent for the file list, and it reads that list only. No separate "confirm" step.
- **CodeRabbit CLI is installed (0.9.6).** It runs in `--agent` mode, which gives structured findings for agents.
- **CLI flags come from a rules table per CLI** (§7.6), never from the model.
- **Workers keep running on the CLI subscriptions** (Phase 2 CLI dispatch stays). Claude Code's own subagents routed to API-key providers were considered and not chosen: they would make crewcast smaller, but they need paid API keys, and they cannot use the Codex, Gemini, Copilot or Kiro subscriptions.

**Decided by the owner on 2026-11-22**
- **Phase 0 is go.** mode 1.00 (the phrase rule), skills 0.795–0.822, p95 ~1.1 s on the owner's laptop (`docs/phase0-results.md`).
- **Embedding model: `mxbai-embed-large`** (query-prefixed), the best of three local models tested.
- **Team flow is plan-first (§7.14).** The captain writes a spec, then `plan.md` with the work units only (description, files, depends). crewcast allocates the crew from the plan.
- **Plan mode is the gate.** The captain plans in plan mode; its approval (`ExitPlanMode`) triggers dispatch, wired by a hook.
- **crewcast allocates per unit, from the plan:** agent grouping (from `depends:`), skills (per-unit embedding), CLI, model, effort, plugins, MCP servers, and flags/arguments. Flags always from the rules table, never a model (§7.6).
- **Agent count comes from the plan's dependencies**, not from model independence questions (§7.3).
- **Skill picking is embedding-led.** A decision model is likely dropped for skills, since per-unit picking should cover multi-skill; final call pending a per-unit check.

**Still open (default applies unless the owner changes it)**
- Shadow-mode takeover threshold: ≥ 90% over ≥ 50 tasks.

## 10. Left to the builder

- Exact file layout, libraries, rules file format, prefilter method, field names (keeping §7.4's guarantees).
- Verifying: Nimble's quantized size and VRAM use, the Ollama `/v1/systemone` format, each CLI's skills path and headless flags, the Kiro headless mode, and the Claude plugin manifest format.
- Test framework. The owner's other project uses `npx tsx` with Node `assert`; follow that unless there is a reason not to.

## 11. How we know it works

- Test-set agreement per signal, reported by `crewcast stats`.
- p95 **fast** decide latency under 1.5 s with the model loaded; the hook never adds more than 2 s. Full decide has no hard limit but reports its time and token use.
- Zero tokens spent per decision, except logged fallbacks.
- `setup` run twice leaves the same state; `uninstall` leaves nothing: verified by checking each CLI's config and skill folders.
- Hook fail-open test: stop Ollama, send a prompt, and the prompt goes through unchanged.
