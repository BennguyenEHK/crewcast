---
name: crewcast
description: Decide how an AI coding task runs — solo or team, which skills and MCP servers, which crew — from a local non-generative model and plain rules, before any tokens are spent. Use at the start of a coding task, and read the hook's decision record.
---

# crewcast

crewcast decides how a coding task runs before any AI model spends tokens on it. A local model answers small questions. Plain rules turn the answers into one decision record.

## When to use it
- The hook runs `crewcast decide` on every prompt and adds a short record. Read that record.
- Or call the `decide` MCP tool, or run `crewcast decide "<task>"`, when no record is present.
- The record is a suggestion (shadow mode). You still decide. If a signal is `uncertain`, settle it yourself; ask the user one short question only if needed.

## Read the record
- `mode`: `solo` or `team`. It comes from the user's words (a team phrase → team), not from a model.
- `skills`: the skills the task needs. Use them.
- `branch`: `keep`, or `new` with a name. Make the branch only when it says `new`.
- `agents`: the crew. In `team` mode, each worker is a CLI.

## Solo mode
Do the task yourself, with the picked skills. The rest of this skill does not apply.

## Team mode: you are the team captain
You plan and guide. You do not write code.
1. Write a short spec (goal, scope, done). The user approves it.
2. In plan mode, write the plan as work units (each with its files and its dependencies). Name no CLI, model or skill — crewcast allocates those.
3. The user approves the plan. That approval dispatches the crew.
4. Give each worker a task card: its goal, its owned files, what "done" means.
5. Read each worker's report, never its code. Watch for: tests claimed but no output; changed files outside the worker's list; "done" with concerns; a report that skips part of the task.
6. Send the work to review: CodeRabbit for the finished task; Copilot for the security pass.
7. Route the reviewers' findings back to the worker who wrote the code. The reviewer re-checks only the fix.
8. Make the calls: break reviewer ties; after three failed fix rounds, accept with a reason, re-assign, or ask the user; decide when to merge.
9. A worker resolves merge conflicts. You never read or review diffs, and never resolve conflicts yourself.

## Ship steps, in order
1. optimize
2. review (CodeRabbit for the task, Copilot for security — both different model families from Claude)
3. secret scan and dependency audit
4. type check, lint, tests, build
5. commit on a branch
6. a short ASD-STE100 summary to the user
7. push and deploy only after the user says "yes" for this push

## How to explain (ASD-STE100)
Short sentences. One instruction per sentence. Active voice. One meaning per word.
