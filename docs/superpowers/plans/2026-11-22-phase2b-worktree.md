# Phase 2b — Worktree Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Give each writing worker its own git worktree and branch (shared history, never a shared folder), and a file-ownership check that confirms a worker only changed files it owns — by file name, not by reading the diff.

**Architecture:** One `WorktreeManager` class over a small git runner. `create` adds a worktree at the sibling path `<repo>-wt/<engine>-<n>` on a new branch; `remove` tears it down in the spec's order (worktree link+folder, then branch); `ownership` lists the branch's changed file names and reports any outside the owned set. No `node_modules` linking anywhere — workers run their own install (§7.7).

**Tech Stack:** Node ≥22, TypeScript strict, ESM/NodeNext, zero runtime deps. Tests: `node:test` via `npx tsx --test` against a real throwaway git repo in a temp dir (real git behavior, not mocks).

**Spec:** `docs/superpowers/specs/2026-11-20-crewcast-design.md` (§7.7 "Shared environment"; §7.13 the captain checks the changed-file list, not the diff). Overview: `docs/superpowers/plans/2026-11-22-phase2-overview.md`.

## Global Constraints

- Zero runtime dependencies; Node ≥22; ESM/NodeNext; TypeScript strict; OOP one-class-per-module.
- git is invoked through an injectable `run(args: string[]) => Promise<string>` (default: `execFile('git', args, { shell: true })` — the Windows shim/quoting pattern already used in `src/engines/catalog.ts`). Tests pass the default and operate on a temp repo.
- **Never create or link `node_modules`** between a worktree and the main repo (§7.7: deleting through such a link once emptied the real folder). This manager simply never does it; a comment states so.
- The ownership check compares **file-name lists**, never diff contents (§7.13).

## Review Focus

1. **A worker that touches a file outside its owned list.** Expected: `ownership` returns `ok:false` and lists exactly the outside files. → Task 2 test.
2. **`remove` on a worktree that has uncommitted or extra files.** Expected: it still tears down (writer worktrees are disposable) without emptying anything outside the worktree. → Task 1 test (use `--force`, assert the main repo's files survive).
3. **Two writers never share a folder.** Expected: two `create` calls for different `<engine>-<n>` give two distinct paths and two distinct branches. → Task 1 test.
4. **Branch/worktree names with an engine id.** Expected: path `<repo>-wt/<engine>-<n>`, a branch unique per worker, both removable. → Task 1 test.
5. **Untracked (new) files count as changed for ownership.** Expected: a new file the worker added is in the changed list, so it is checked against ownership. → Task 2 test.

---

### Task 1: WorktreeManager create / remove

**Files:**
- Create: `src/worktree.ts`
- Test: `tests/worktree.test.ts`

**Interfaces:**
- Produces:
  - `interface Worktree { path: string; branch: string; base: string }`
  - `class WorktreeManager` with `constructor(deps: { repoRoot: string; run?: (args: string[]) => Promise<string> })`.
  - `create(engine: string, n: number, base?: string): Promise<Worktree>` — `base` default `'HEAD'`; path = `<repoRoot>-wt/<engine>-<n>` (sibling of the repo); branch = `crewcast/<engine>-<n>`; records the base's resolved ref so ownership can diff against it; runs `git worktree add -b <branch> <path> <base>`.
  - `remove(wt: Worktree): Promise<void>` — `git worktree remove --force <path>` (link + folder), then `git branch -D <branch>`; each step tolerant of already-gone (best-effort, like `Uninstall`).

- [ ] **Step 1: Write the failing test** — `tests/worktree.test.ts`. Helper makes a temp dir, `git init`, sets a user, writes a file, commits, and resolves the base branch name (`git rev-parse --abbrev-ref HEAD`). Then:
  - `create('codex', 1)` → the returned `path` exists on disk and ends with `-wt/codex-1`; the `branch` appears in `git worktree list --porcelain`.
  - `create('gemini', 2)` → a different path and a different branch (two writers, no shared folder).
  - after `remove(wt)`: the worktree folder is gone, the branch is gone (`git branch --list` empty for it), and a file in the **main** repo still exists (remove emptied nothing outside the worktree).

- [ ] **Step 2: Run the test, verify it fails** — module not found.

- [ ] **Step 3: Implement `src/worktree.ts`** create/remove as above. Default runner: `execFile('git', args, { shell: true })` via `promisify`, returning stdout. Add the comment `// never links node_modules into a worktree (§7.7): a worker runs its own install inside it`.

- [ ] **Step 4: Run the test, verify it passes.**

- [ ] **Step 5: Commit** — `feat(worktree): create and remove a writer's worktree + branch`.

---

### Task 2: Ownership check

**Files:**
- Modify: `src/worktree.ts`
- Test: `tests/worktree-ownership.test.ts`

**Interfaces:**
- Consumes: `Worktree` (Task 1).
- Produces on `WorktreeManager`:
  - `changedFiles(wt: Worktree): Promise<string[]>` — the set of file names the branch changed vs its `base`: committed changes (`git -C <path> diff --name-only <base>...HEAD`) unioned with the working tree (`git -C <path> status --porcelain` → the path field, includes untracked). Returns POSIX-style paths, de-duplicated.
  - `ownership(wt: Worktree, owned: string[]): Promise<{ ok: boolean; outside: string[] }>` — `outside` = changed files not in `owned`; `ok` = `outside.length === 0`.

- [ ] **Step 1: Write the failing test** — `tests/worktree-ownership.test.ts`, building a worktree as in Task 1, then:
  - add and commit a new file `src/a.ts` inside the worktree, and leave an uncommitted new file `src/b.ts`; `changedFiles(wt)` contains both.
  - `ownership(wt, ['src/a.ts', 'src/b.ts'])` → `{ ok: true, outside: [] }`.
  - `ownership(wt, ['src/a.ts'])` → `{ ok: false, outside: ['src/b.ts'] }`.

- [ ] **Step 2: Run the test, verify it fails.**

- [ ] **Step 3: Implement** `changedFiles` and `ownership`. Normalize `\` → `/` before comparing. Parse `status --porcelain` by taking the path after the 3-char status prefix (handle a renamed `A -> B` by taking `B`).

- [ ] **Step 4: Run the whole suite** — `npx tsx --test tests/*.test.ts`; then `npm run typecheck && npm run build`.

- [ ] **Step 5: Commit** — `feat(worktree): changed-file ownership check (names, not diff)`.
