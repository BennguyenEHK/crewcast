# crewcast Phase 0 (Decider) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `crewcast decide "<task>"` returns a decision record from a local non-generative model, and `crewcast eval` measures it against ~50 of the owner's labelled past tasks. That measurement is the phase-0 go/no-go.

**Architecture:**
- A TypeScript CLI with zero runtime dependencies.
- The task text goes to Ollama's `/v1/systemone` endpoint as one request of signal questions plus one yes/no question per shortlisted skill.
- Plain rules turn the answers into a decision record.
- Records are logged to `~/.crewcast/shadow.jsonl`.
- A transcript reader drafts the test set from past Claude Code sessions; the owner corrects it.

**Tech Stack:**
- Node ≥ 22, TypeScript (ESM, `NodeNext`).
- Built-ins only at runtime: `fetch`, `fs`, `child_process`, `util.parseArgs`.
- Dev: `typescript`, `tsx`, `@types/node`.
- Tests: `node:test` + `node:assert/strict`, run through `tsx --test`.

**Spec:** `docs/superpowers/specs/2026-11-20-crewcast-design.md` (§7.2 fast decide, §7.3, §7.4, §7.5, §7.10, §8 phase 0, §9 go/no-go).

**Not in this plan (later plans):**
- Full decide (unit splitting, pair questions, agent count): phase 2.
- `setup`, MCP server, hook, Stop hook, engine catalog, skill copying: phase 1.
- Dispatch and mailbox: phase 2.

## Global Constraints

- Node `>=22`; `"type": "module"`; npm bin name `crewcast` → `dist/bin.js`.
- **No runtime dependencies. No `postinstall` script.**
- Network: only the Ollama base URL.
  - Default `http://127.0.0.1:11434`.
  - Override with `OLLAMA_HOST`, which may lack a scheme (`0.0.0.0:11434`, `localhost`). Normalize it to `http://host:port`, and map `0.0.0.0` to `127.0.0.1`.
- State folder: `~/.crewcast/`, override with env `CREWCAST_HOME`. Tests always set `CREWCAST_HOME` to a temp folder.
- **The owner's real task texts never go in the repo** (the GitHub repo is public). The eval set lives in `~/.crewcast/eval/tasks.jsonl`. The repo holds only synthetic fixtures.
- `/v1/systemone` limits:
  - `choice` 2–26 options;
  - 1–64 questions per request;
  - request body ≤ 64 KiB;
  - Nimble input ≤ 8,192 tokens (an over-long input gets a 400 from the server).
- Default model `nimble`; `--model` overrides it. Other Ollama decision models (`tev1`, `laya`) must work just by changing the name.
- Fast decide: **one** HTTP request per decision. Target p95 < 1.5 s with the model loaded; send `keep_alive: "30m"`.
- Go/no-go: **pass = mode agreement ≥ 0.80 AND skill agreement ≥ 0.80** on the eval set.
- **Never fill an uncertain signal with a guess.** An uncertain signal is marked `uncertain: true`; an uncertain mode is the value `"uncertain"`.
- Commits: conventional style, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. **Do not push** (the repo is public; the owner pushes).

## Review Focus

1. **Ollama is not running, or the model is not pulled.** The user expects one clear line ("Ollama not reachable at http://127.0.0.1:11434 — start Ollama" / "model 'nimble' not found — run: ollama pull nimble") and exit code 2, not a stack trace. → Task 2 tests.
2. **A very long task** (body > 64 KiB, or a server 400). The user expects a record with every signal uncertain, mode `"uncertain"`, and an `error` field. No crash. → Task 4 test.
3. **A messy `SKILL.md`**: CRLF line endings, a folded `description: >` block, quotes, or no frontmatter at all. The expected result is parsed or skipped, never a crash. → Task 3 tests.
4. **Not a git repo, or no `git` on PATH.** Expected: `branch: { action: "keep" }`, no crash. → Task 5 test.
5. **A corrupt line** in `shadow.jsonl`, or a transcript line of an unknown type. Expected: skipped and counted, not a crash. → Task 6 and Task 7 tests.

---

## File Structure

```
package.json  tsconfig.json  tsconfig.build.json  .gitignore  .gitattributes
src/bin.ts                 entry: calls main(process.argv.slice(2), console.log) and sets the exit code
src/cli.ts                 subcommand routing (decide | label | stats | eval | eval draft | --version)
src/paths.ts               crewcastHome(), ollamaBaseUrl()
src/backend/systemone.ts   request/response types, limit checks, askSystemOne()
src/catalog/skills.ts      loadSkills(), defaultSkillDirs(), shortlist()
src/decide/record.ts       DecisionRecord and related types
src/decide/questions.ts    buildQuestions()
src/decide/rules.ts        DEFAULT_RULES, applyRules()
src/decide/decide.ts       decide()
src/git.ts                 gitState()
src/shadow.ts              appendShadow(), addLabel(), readJsonl()
src/agreement.ts           agrees(), report()
src/transcript.ts          summarizeTranscript()
src/eval.ts                runEval(), draftEval()
tests/*.test.ts            one test file per src module
tests/fixtures/            synthetic skills, transcripts, eval tasks
```

---

### Task 1: Project scaffold and `--version`

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsconfig.build.json`, `.gitignore`, `.gitattributes`, `src/bin.ts`, `src/cli.ts`, `src/paths.ts`
- Test: `tests/cli.test.ts`, `tests/paths.test.ts`

**Interfaces:**
- Produces:
  - `main(argv: string[], out: (line: string) => void): Promise<number>` (exit code) in `src/cli.ts`
  - `crewcastHome(env?: NodeJS.ProcessEnv): string`
  - `ollamaBaseUrl(env?: NodeJS.ProcessEnv): string` in `src/paths.ts`

Config values:
- `package.json`:
  - `name: "crewcast"`, `version: "0.0.0"`, `type: "module"`, `engines.node: ">=22"`
  - `bin.crewcast: "dist/bin.js"`, `files: ["dist"]`
  - scripts:
    - `build`: `tsc -p tsconfig.build.json`
    - `typecheck`: `tsc -p tsconfig.json --noEmit`
    - `test`: `tsx --test "tests/**/*.test.ts"`
- `tsconfig.json`: `strict`, `target ES2023`, `module/moduleResolution NodeNext`; `include: ["src", "tests"]`.
- `tsconfig.build.json`: extends it; `include: ["src"]`, `outDir: "dist"`, `rootDir: "src"`.
- `.gitignore`: `node_modules/ dist/ *.log .env*`
- `.gitattributes`: `* text=auto eol=lf`
- `src/bin.ts` starts with `#!/usr/bin/env node`.

- [ ] **Step 1: Write failing tests**

```ts
// tests/cli.test.ts
test('--version prints package version', async () => {
  const lines: string[] = [];
  assert.equal(await main(['--version'], l => lines.push(l)), 0);
  assert.equal(lines[0], '0.0.0');
});
test('unknown command prints usage and returns 1', async () => {
  const lines: string[] = [];
  assert.equal(await main(['nope'], l => lines.push(l)), 1);
  assert.match(lines.join('\n'), /usage: crewcast/);
});
// tests/paths.test.ts
test('CREWCAST_HOME overrides home', () => assert.equal(crewcastHome({ CREWCAST_HOME: 'X:\\h' }), 'X:\\h'));
test('default home is ~/.crewcast', () => assert.match(crewcastHome({}), /[\\/]\.crewcast$/));
test('OLLAMA_HOST normalization', () => {
  assert.equal(ollamaBaseUrl({}), 'http://127.0.0.1:11434');
  assert.equal(ollamaBaseUrl({ OLLAMA_HOST: '0.0.0.0:11434' }), 'http://127.0.0.1:11434');
  assert.equal(ollamaBaseUrl({ OLLAMA_HOST: 'localhost' }), 'http://localhost:11434');
  assert.equal(ollamaBaseUrl({ OLLAMA_HOST: 'https://box:9000/' }), 'https://box:9000');
});
```

- [ ] **Step 2:** `npm i -D typescript tsx @types/node`, then `npx tsx --test tests/cli.test.ts tests/paths.test.ts`. Expected: FAIL (modules missing).
- [ ] **Step 3:** Implement `main`, `crewcastHome`, `ollamaBaseUrl`, `bin.ts`. Read the version from `package.json` via `createRequire` or `fs`, resolved relative to the module, so it works from `dist/`.
- [ ] **Step 4:** `npm test && npm run typecheck && npm run build && node dist/bin.js --version`. Expected: tests pass, and the last command prints `0.0.0`.
- [ ] **Step 5:** Commit: `chore: scaffold crewcast CLI (TypeScript, Node 22, zero runtime deps)`

### Task 2: systemone backend client

**Files:**
- Create: `src/backend/systemone.ts`
- Test: `tests/systemone.test.ts`

**Interfaces:**
- Produces (in `src/backend/systemone.ts`):

```ts
export type Question =
  | { type: 'choice'; instructions: string; criteria: Record<string, string | null> }
  | { type: 'noul'; instructions: string; criteria?: { true: string; false: string } };
export interface SystemOneRequest { model: string; state: string; questions: Record<string, Question>; keep_alive?: string }
export type Answer =
  | { type: 'choice'; choice: string; probabilities: Record<string, number>; confidence: number }
  | { type: 'noul'; noul: number };
export interface SystemOneResponse { model: string; answers: Record<string, Answer>; usage?: { input_tokens: number; output_tokens: number } }
export type BackendErrorCode = 'ollama_unreachable' | 'model_missing' | 'too_large' | 'bad_request' | 'timeout' | 'bad_response';
export class BackendError extends Error { constructor(public code: BackendErrorCode, message: string) }
export function checkLimits(req: SystemOneRequest): void; // throws BackendError('too_large' | 'bad_request')
export function askSystemOne(req: SystemOneRequest, opts: { baseUrl: string; timeoutMs?: number; fetchFn?: typeof fetch }): Promise<SystemOneResponse>;
```

Behaviour:
- `POST {baseUrl}/v1/systemone` with a JSON body. Default timeout 10,000 ms, via `AbortSignal.timeout`.
- Error mapping:
  - fetch throws a connection error → `ollama_unreachable`
  - abort or timeout → `timeout`
  - HTTP 404 → `model_missing`
  - HTTP 400 → `bad_request`, or `too_large` if the body mentions tokens or length
  - a response missing `answers` → `bad_response`
- `checkLimits` runs before sending:
  - 1–64 questions;
  - each `choice` has 2–26 options;
  - `Buffer.byteLength(JSON.stringify(req)) ≤ 65536`, else `too_large`.

- [ ] **Step 1: Write failing tests** (all with a fake `fetchFn`, no real network)

```ts
test('sends POST to /v1/systemone and returns answers', ...)          // assert URL, method, parsed body.model
test('65 questions → BackendError bad_request', ...)                   // checkLimits
test('choice with 27 options → bad_request; with 1 option → bad_request', ...)
test('body over 64 KiB → too_large', ...)                              // state = 'x'.repeat(70_000)
test('fetch rejects (ECONNREFUSED) → ollama_unreachable', ...)
test('HTTP 404 → model_missing', ...)
test('response without answers → bad_response', ...)
```

- [ ] **Step 2:** `npx tsx --test tests/systemone.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement as specified.
- [ ] **Step 4:** Same command. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(backend): Ollama /v1/systemone client with limit checks and typed errors`

### Task 3: Skill catalog and shortlist

**Files:**
- Create: `src/catalog/skills.ts`, `tests/fixtures/skills/` (5 synthetic skills, one per messy case below)
- Test: `tests/skills.test.ts`

**Interfaces:**
- Produces:

```ts
export interface Skill { name: string; description: string; path: string }
export function parseFrontmatter(text: string): { name?: string; description?: string } | null;
export function loadSkills(dirs: string[]): Promise<Skill[]>;        // each dir holds <skill>/SKILL.md; missing dirs ignored; dedupe by name, first wins
export function defaultSkillDirs(home: string, cwd: string): string[];
export function shortlist(task: string, skills: Skill[], k?: number): Skill[]; // default k = 20
```

Details:
- `defaultSkillDirs` returns, in this order:
  1. `<cwd>/.claude/skills`
  2. `<home>/.claude/skills`
  3. every `skills` folder under `<home>/.claude/plugins/cache`, up to 4 levels deep (walk with `readdir`; do not follow symlinks or junctions)
- `parseFrontmatter`:
  - handles `\r\n`;
  - takes `key: value` with optional `'`/`"` quotes;
  - takes folded or literal blocks (`>`, `|`, `>-`): the following indented lines, joined with spaces;
  - returns `null` with no leading `---` block.
  - Plugin skills are named `<plugin>:<name>` when the path contains `plugins/cache/<marketplace>/<plugin>/`.
- `shortlist`:
  - scores each skill by how many task words (lowercase, ≥ 3 letters, a small stop-word list removed) appear in `name + description`;
  - drops score 0;
  - sorts by score, then name;
  - takes the first k.
  - `shortcut: word overlap misses synonyms; upgrade to embeddings if eval shows skill recall is the failing metric.`

- [ ] **Step 1: Write failing tests**

```ts
test('parses CRLF frontmatter', ...)                 // 'name: a\r\ndescription: b' → {name:'a', description:'b'}
test('parses folded description block', ...)        // 'description: >\n  line one\n  line two' → 'line one line two'
test('strips quotes', ...)
test('no frontmatter → null; loadSkills skips that skill', ...)
test('missing dir is ignored', ...)
test('plugin skill gets plugin: prefix', ...)        // fixture path .../plugins/cache/mkt/superpowers/7.0.2/skills/brainstorming/SKILL.md → 'superpowers:brainstorming'
test('shortlist ranks by overlap and drops zero', ...) // task 'review security of auth code' → 'security-review' first; unrelated skill absent
```

- [ ] **Step 2:** `npx tsx --test tests/skills.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Same command. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(catalog): load SKILL.md catalog from Claude and plugin folders, keyword shortlist`

### Task 4: Questions, rules and `decide()`

**Files:**
- Create: `src/decide/record.ts`, `src/decide/questions.ts`, `src/decide/rules.ts`, `src/decide/decide.ts`
- Test: `tests/decide.test.ts`

**Interfaces:**
- Consumes:
  - `askSystemOne`, `BackendError`, `SystemOneResponse` (Task 2)
  - `Skill`, `shortlist` (Task 3)
  - `GitState` (Task 5: define the type here in `record.ts`; Task 5 implements the function)
- Produces:

```ts
// record.ts
export type TaskType = 'implement'|'fix'|'review'|'research'|'plan'|'docs'|'test'|'refactor'|'ops';
export type RiskArea = 'none'|'auth'|'db_schema'|'payments'|'deploy'|'secrets';
export type Size = 'one_file'|'few_files'|'many_files';
export interface Signal<T> { value: T | null; p: number; uncertain?: true }   // value null only when uncertain
export interface AgentPlan { role: 'lead'|'review'; engine: string; model: string; effort: string|null; skills: string[]; mcps: string[] }
export interface GitState { isRepo: boolean; branch: string|null; defaultBranch: string|null; dirty: boolean }
export interface DecisionRecord {
  version: 1; id: string; task: string; mode: 'solo'|'team'|'uncertain'; shadow: boolean;
  signals: { task_type: Signal<TaskType>; writes_files: Signal<boolean>; risk_area: Signal<RiskArea>; size: Signal<Size>; needs_web: Signal<boolean> };
  skills_uncertain: string[];
  branch: { action: 'keep'|'new'; name?: string };
  agents: AgentPlan[]; ms: number; backend: string; error?: string;
}
// questions.ts
export function buildQuestions(skills: Skill[]): Record<string, Question>;  // keys: task_type, writes_files, risk_area, size, needs_web, skill_0..skill_{n-1}
// rules.ts
export interface Rules { thresholds: { choice: number; yes: number; no: number; skill: number }; leadEngine: string; review: { engine: string; model: string; skill: string } }
export const DEFAULT_RULES: Rules; // thresholds {choice:0.6, yes:0.7, no:0.3, skill:0.7}; leadEngine 'claude'; review {engine:'copilot', model:'gpt-5-mini', skill:'security-review'}
export function toSignals(answers: SystemOneResponse['answers'], rules: Rules): DecisionRecord['signals'];
export function applyRules(signals: DecisionRecord['signals'], pickedSkills: string[], git: GitState|null, task: string, rules: Rules):
  Pick<DecisionRecord, 'mode'|'branch'|'agents'>;
// decide.ts
export function decide(task: string, deps: { ask: (r: SystemOneRequest) => Promise<SystemOneResponse>; skills: Skill[]; git: GitState|null; model: string; rules?: Rules; now?: () => number; shadow?: boolean }): Promise<DecisionRecord>;
```

Rules (from spec §7.3; the exact values are decided here):
- **Signal p:**
  - choice: `p = probabilities[choice]`; uncertain if `p < thresholds.choice`.
  - noul: `value = true` if `noul ≥ yes`, `false` if `noul ≤ no`, else uncertain; `p = max(noul, 1 - noul)`.
- **Skills:** `skill_i` with `noul ≥ thresholds.skill` → picked. Skills between `no` and `skill` → `skills_uncertain`.
- **Score and mode:**
  - `score = {one_file:1, few_files:3, many_files:4}[size] + (risk_area !== 'none' ? 1 : 0)`, clamped to 1–5.
  - mode = `team` if `score ≥ 4` or `risk_area !== 'none'`, else `solo`.
  - If `size` or `risk_area` is uncertain → mode `uncertain`.
- **Agents:**
  - always one lead: `{role:'lead', engine: rules.leadEngine, model:'default', effort: score ≥ 4 ? 'high' : null, skills: picked, mcps: []}`;
  - plus `{role:'review', engine:'copilot', model:'gpt-5-mini', effort:null, skills:['security-review'], mcps:[]}` when `risk_area !== 'none'`.
- **Branch:** `new` only when all of these hold:
  - `writes_files === true`
  - `git?.isRepo`
  - `git.branch === git.defaultBranch`
  - `git.dirty || mode === 'team'`

  Name: `feat/` + the first 4 task words, slugged (lowercase, `[a-z0-9-]`, max 40 chars). Otherwise `keep`.
- **Request and errors:**
  - `decide` calls `shortlist(task, deps.skills)` (k = 20), then `buildQuestions(shortlisted)`, so there are at most 25 questions, well under the 64 limit.
  - one request; `state = task`; `keep_alive: '30m'`; `ms` = wall time including the request.
  - On `BackendError` code `too_large` or `bad_request`: return a record with every signal `{value:null, p:0, uncertain:true}`, `mode:'uncertain'`, `agents: []`, `branch: {action:'keep'}`, and `error` = the message.
  - Other `BackendError` codes are re-thrown, and the CLI reports them (Review Focus 1).
- **Record fields:** `id = new Date().toISOString() + '-' + randomBytes(3).toString('hex')`; `backend = '<model>@ollama'`; `shadow` defaults to `true`.

- [ ] **Step 1: Write failing tests** (fake `ask` returning canned answers)

```ts
test('one request per decision, with 5 signal questions + one per shortlisted skill', ...)
test('auth task: risk auth → mode team, review agent added, effort high when many_files', ...)
test('small docs task: one_file, none → solo, single lead agent, effort null', ...)
test('size probability 0.5 → size uncertain → mode uncertain, value null', ...)
test('skill noul 0.9 picked, 0.5 → skills_uncertain, 0.1 → dropped', ...)
test('branch new only on default branch + writes_files + (dirty or team); slug ≤ 40 chars', ...)
test('too_large backend error → all-uncertain record with error, no throw', ...)   // Review Focus 2
test('ollama_unreachable is re-thrown', ...)
```

- [ ] **Step 2:** `npx tsx --test tests/decide.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the four files. Question `instructions` and `criteria` texts are written by the implementer: short, plain, one per option. Example: `size` criteria `{ one_file: 'changes or reads one file', few_files: '2 to 5 files in one area', many_files: 'many files or several modules' }`.
- [ ] **Step 4:** Same command. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(decide): signal questions, plain rules and decision record (fast decide)`

### Task 5: Git state and `crewcast decide` command

**Files:**
- Create: `src/git.ts`
- Modify: `src/cli.ts` (add `decide`)
- Test: `tests/git.test.ts`, `tests/cli-decide.test.ts`

**Interfaces:**
- Consumes:
  - `decide` (Task 4); `loadSkills`, `defaultSkillDirs`, `shortlist` (Task 3)
  - `askSystemOne`, `BackendError` (Task 2); `ollamaBaseUrl`, `crewcastHome` (Task 1)
  - `appendShadow` (Task 6: if Task 6 is not done yet, leave a one-line call site and complete it in Task 6)
- Produces:
  - `gitState(cwd: string): Promise<GitState | null>`: `null` when `git` is missing or `cwd` is not a repo.
  - CLI: `crewcast decide [--model <name>] [--json] <task...>`

Behaviour:
- `gitState` uses `execFile('git', [...], {cwd})`:
  - `rev-parse --is-inside-work-tree`;
  - `branch --show-current`;
  - default branch from `symbolic-ref --short refs/remotes/origin/HEAD` (strip `origin/`), else `main` if it exists, else `master`, else `null`;
  - dirty = `status --porcelain` is not empty.
- `decide` command:
  - `--json` prints the record as JSON on one line.
  - Otherwise it prints 4 lines: mode, skills, branch, ms.
- Exit codes:
  - 0 on success;
  - 2 on `ollama_unreachable` / `model_missing` / `timeout`, with one plain line (exact texts in Review Focus 1);
  - 1 on a usage error.
- Every successful record is appended to the shadow log (Task 6).

- [ ] **Step 1: Write failing tests**

```ts
test('gitState in a temp non-repo dir → null', ...)                    // Review Focus 4
test('gitState in a fresh `git init` temp repo with one commit → branch main, dirty false; after writing a file → dirty true', ...)
test('decide --json with fake ask prints a parseable record', ...)     // inject fake ask: main(argv, out, deps?) — add optional 3rd param `deps` to main for tests
test('ollama_unreachable → exit 2 and the exact one-line message', ...) // Review Focus 1
```

  So tests can inject fakes, `main` gets an optional third parameter: `main(argv, out, deps?: Partial<{ ask: typeof askSystemOne; env: NodeJS.ProcessEnv; cwd: string }>)`.
- [ ] **Step 2:** `npx tsx --test tests/git.test.ts tests/cli-decide.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Same command, plus `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(cli): crewcast decide with git-aware branch rule`

### Task 6: Shadow log, labels, agreement and `stats`

**Files:**
- Create: `src/shadow.ts`, `src/agreement.ts`
- Modify: `src/cli.ts` (add `label`, `stats`)
- Test: `tests/shadow.test.ts`, `tests/agreement.test.ts`

**Interfaces:**
- Produces:

```ts
// shadow.ts — files in crewcastHome(): shadow.jsonl (records), labels.jsonl ({id, actual})
export interface Actual { mode: 'solo'|'team'; skills: string[]; engines?: string[] }
export function appendShadow(rec: DecisionRecord, home: string): Promise<void>;
export function addLabel(id: string, actual: Actual, home: string): Promise<void>;   // last label for an id wins
export function readJsonl<T>(file: string): Promise<{ rows: T[]; skipped: number }>; // missing file → {rows:[], skipped:0}
// agreement.ts
export function agrees(rec: DecisionRecord, actual: Actual): { mode: boolean; skills: boolean };
export interface Report { n: number; mode: number; skills: number; uncertain: Record<string, number>; p50ms: number; p95ms: number; pass: boolean; skipped: number }
export function report(pairs: { rec: DecisionRecord; actual: Actual }[], skipped?: number): Report;
```

Agreement definitions (decided here; the spec leaves them open):
- mode agrees ⇔ `rec.mode === actual.mode`. An `uncertain` mode counts as disagreement.
- skills agree ⇔ every `actual.skills` item is in the lead's `skills` **and** at most 2 picked skills are not in `actual.skills`.
- `pass = n ≥ 1 && mode ≥ 0.80 && skills ≥ 0.80`.
- `uncertain` counts uncertain signals per signal name.
- p50/p95 use nearest-rank on `ms`.

CLI:
- `crewcast label <id> --mode solo|team --skills a,b[,c]` appends a label.
- `crewcast stats` joins shadow rows with labels by id, prints the report (one line per metric plus `PASS` or `FAIL`), and also lists how many rows have no label.

- [ ] **Step 1: Write failing tests**

```ts
test('readJsonl skips a corrupt line and counts it', ...)               // Review Focus 5
test('last label for an id wins', ...)
test('skills agree with 2 extras, disagree with 3 extras or a missing one', ...)
test('uncertain mode counts as disagreement', ...)
test('report: 4 of 5 mode agree, 5 of 5 skills → mode 0.8, pass true', ...)
test('p95 nearest-rank on [100,200,300,400,1000] = 1000, p50 = 300', ...)
```

- [ ] **Step 2:** `npx tsx --test tests/shadow.test.ts tests/agreement.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement, and finish the `appendShadow` call in `decide` (Task 5).
- [ ] **Step 4:** Same command, plus `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(shadow): shadow log, labels, agreement report and stats`

### Task 7: Transcript reader, `eval draft` and `eval`

**Files:**
- Create: `src/transcript.ts`, `src/eval.ts`, `tests/fixtures/transcripts/` (3 synthetic `.jsonl`: solo with a Skill call; team via `Agent` with `subagent_type: 'general-purpose'`; a web-fetch-only session that must count as solo), `tests/fixtures/eval/tasks.jsonl` (3 synthetic tasks)
- Modify: `src/cli.ts` (add `eval draft`, `eval`)
- Test: `tests/transcript.test.ts`, `tests/eval.test.ts`

**Interfaces:**
- Consumes: `decide` (Task 4), `Actual`, `report`, `readJsonl` (Task 6), `loadSkills` (Task 3).
- Produces:

```ts
// transcript.ts
export interface TranscriptSummary { firstPrompt: string | null; actual: Actual; cwd: string | null; skipped: number }
export function summarizeTranscript(file: string): Promise<TranscriptSummary>;
// eval.ts
export interface EvalTask { id: string; task: string; actual: Actual }
export function draftEval(projectsDir: string, outFile: string, limit?: number): Promise<{ written: number }>;  // default limit 80
export function runEval(tasksFile: string, deps: { ask: (r: SystemOneRequest) => Promise<SystemOneResponse>; skills: Skill[]; model: string }): Promise<Report>;  // skills = loadSkills(defaultSkillDirs(...))
```

Transcript rules. Claude Code's JSONL format is internal and changes, so read it defensively. Parse each line on its own; skip and count bad lines.
- `firstPrompt`: the first line with `type === 'user'` and not `isMeta` / `isSidechain`, whose `message.content` is a string (or the text blocks of an array) that does not start with `<` (that would be a command or system wrapper). Trim it to 2,000 chars.
- `actual.skills`: unique `input.skill` from `tool_use` blocks with `name === 'Skill'`, in order.
- `actual.mode = 'team'` when either holds:
  - any `tool_use` `Agent` has a `subagent_type` not in `['web-fetch', 'Explore', 'claude-code-guide', 'statusline-setup']`;
  - any `Bash` / `PowerShell` `tool_use` has `run_in_background: true` and a command starting with `codex`, `gemini`, `copilot`, `kiro-cli` or `claude -p`.

  Otherwise `solo`.
- `actual.engines`: the CLI names from those background commands, plus `'claude'`.

`eval draft`:
- Scans `<projectsDir>/*/*.jsonl` (default `~/.claude/projects`), newest first.
- Writes up to `limit` `EvalTask` rows (`id` = the transcript file's base name) to `outFile` (default `<crewcastHome>/eval/tasks.jsonl`).
- Skips sessions with no `firstPrompt`.
- **Refuses to write inside the current git repo** (Global Constraints: owner tasks never go in the repo).
- Prints: "Drafted N tasks → <file>. Open it and correct `actual` (mode, skills) for each line; delete lines that are not real tasks."

`eval`:
- `crewcast eval [--model <name>] [file]` runs `decide` on each task **sequentially** (Ollama has one slot).
- Shadow logging is off during eval (`shadow` records are not appended).
- Prints the Task 6 report plus `PASS`/`FAIL` against the go/no-go thresholds. Exit code 0 on PASS, 3 on FAIL.

- [ ] **Step 1: Write failing tests**

```ts
test('solo fixture: skills extracted in order, mode solo', ...)
test('team fixture: general-purpose Agent → team', ...)
test('web-fetch-only fixture → solo', ...)
test('unknown line types and a corrupt line are skipped and counted', ...)        // Review Focus 5
test('draftEval refuses an outFile inside the cwd git repo', ...)
test('runEval on 3 synthetic tasks with fake ask → Report with n 3', ...)
```

- [ ] **Step 2:** `npx tsx --test tests/transcript.test.ts tests/eval.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Same command, plus `npm test && npm run typecheck && npm run build`. Expected: all PASS.
- [ ] **Step 5:** Commit: `feat(eval): transcript reader, eval draft and eval with go/no-go`

### Task 8: Go/no-go run on the owner's laptop (owner-gated)

No new code. This task produces the phase-0 decision. **Each step marked (owner) needs the owner's "yes" first.**

- [ ] **Step 1: Check storage** (spec §7.11). The effective `OLLAMA_MODELS` on the owner's machine is `D:\models`. Confirm that D: has ≥ 12 GB free (Nimble is ~9.5 GB plus the 20% margin).
- [ ] **Step 2 (owner):** `ollama pull nimble`. It is a ~9.5 GB download.
- [ ] **Step 3: Check the GPU fit.** Run `node dist/bin.js decide "fix a typo in README"` once to load the model, then `ollama ps`. Record the GPU/CPU split. Nimble (~9.5 GB) is larger than the 8 GB VRAM, so a partial CPU split is expected. That split is the main latency risk.
- [ ] **Step 4:** `node dist/bin.js eval draft`, then **(owner)** correct `~/.crewcast/eval/tasks.jsonl`. Keep ~50 real tasks; mix solo and team.
- [ ] **Step 5:** `node dist/bin.js eval`. Record: mode %, skills %, uncertain counts, p50/p95 ms, PASS/FAIL.
- [ ] **Step 6:** If p95 ≥ 1.5 s or the result is FAIL, run `ollama pull tev1` (owner) and `node dist/bin.js eval --model tev1`. Record the same numbers.
- [ ] **Step 7:** Write `docs/phase0-results.md`:
  - the aggregate numbers only, no task texts;
  - `ollama ps` split, model sizes, date;
  - the decision, per spec §9: PASS → phase 1 as specified; FAIL → phase 1 ships skill picking only, and solo-or-team stays with the user or Claude.

  Commit: `docs: phase 0 go/no-go results`.
