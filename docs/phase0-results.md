# Phase 0 results: provisional (2026-11-21)

**Status: provisional.** The 60 test tasks still have the auto-drafted labels. The owner has not corrected them yet, so the accuracy numbers below are rough. The speed numbers are real.

## Set-up
- Laptop: Windows 11, RTX 4060 (8 GB VRAM), 16 GB RAM, Ollama 0.40.16.
- Test set: 60 tasks, picked from 8 of the owner's past Claude Code sessions (36 solo, 24 team by the draft labels). The task texts are not in this repo.
- Same crewcast code for every model: 5 signal questions plus up to 20 skill questions in one `/v1/systemone` request. A 60 s per-request wait, so slow answers are measured, not cut off.
- Pass bar (spec §9): mode ≥ 80 % and skills ≥ 80 %. Speed target (spec §3): p95 < 1.5 s.

## Results

| Model | Size | On GPU | Mode | Skills | p50 | p95 | Licence |
|---|---|---|---|---|---|---|---|
| nimble (v1) | 9.5 GB | 58 % | 23 % | 48 % | 9.6 s | 14.2 s | Apache 2.0 |
| laya | 0.84 GB | 100 % | 2 % | 37 % | 0.28 s | 0.76 s | Apache 2.0 |
| laya, num_ctx 4096 | 0.84 GB | 100 % | 3 % | 50 % | 0.44 s | 2.2 s | Apache 2.0 |
| kev:4b-q4_K_M | 2.7 GB | 100 % | 0 % | 75 % | 2.1 s | 3.3 s | Apache 2.0 |
| tev1 (4B) | 4.6 GB | 100 % | 17 % | 73 % | 2.4 s | 3.1 s | not stated |
| **nimble-v3:9b-q4_K_M** | 5.6 GB | 79 % | **43 %** | **80 %** | 8.9 s | 11.9 s | **CC BY-NC 4.0 (non-commercial)** |
| nimble-v3, num_ctx 8192 | 5.6 GB | 100 % | 28 % | 60 % | 3.7 s | 5.9 s | CC BY-NC 4.0 |

Notes:
- **Every model fails the go/no-go today.** The final verdict waits for the corrected labels.
- **Mode is low mostly because of "uncertain", by design.** When size or risk is uncertain, the mode is `uncertain`, and that counts as a disagreement. kev was unsure of size on 54 of 60 tasks, and Laya on 54–55.
- **No model meets the 1.5 s speed target.** A decision asks up to 25 questions, and every extra skill question costs time.
- **Long tasks overflow small input limits.** The real Ollama answers HTTP 500 "Context size has been exceeded" (not the 400 the plan assumed). crewcast now maps it to `too_large`, so those tasks get an all-uncertain record and the run continues. With an 8K setting, nimble-v3 overflowed more often. That explains why its accuracy dropped while its speed improved.
- strands-decider was not tested. It runs only on Apple-silicon Macs (MLX).

## Results — new path (provisional v2, 2026-11-21)

After the Phase 0 changes (mode from the user's phrase not the model; an all-minilm embedding shortlist of 8 skills; kev the default), the two licence-safe candidates were rerun against the **same uncorrected labels**, 60 s per-request timeout, on the owner's full installed skill set.

| Model | Mode | Skills | p50 | p95 | Licence |
|---|---|---|---|---|---|
| kev:4b-q4_K_M | 0.60 | 0.77 | 1.02 s | 1.85 s | Apache 2.0 |
| tev1:latest | 0.60 | 0.78 | 1.18 s | 1.62 s | not stated |

- **Speed collapsed toward the target.** The 8-skill shortlist (was 20) roughly halved p95: kev 3.3 s → 1.85 s, tev1 3.1 s → 1.62 s. Both are now within a whisker of the 1.5 s target.
- **Mode is model-independent now.** 0.60 is the phrase rule against the drafted labels, not a model score — both models are identical. Once the corrected labels mark team ⇔ "the task carries a team phrase", mode agreement should approach 1.0. nimble-v3's old mode edge (43 %) is therefore moot: it buys nothing the phrase rule doesn't, at 6× the latency and a non-commercial licence. It was not rerun.
- **The verdict now hinges on skills and speed.** Skills sit at 0.77–0.78 against uncorrected labels, just under the 0.80 bar; the corrected labels decide whether it clears. tev1 edges kev on both skills and speed here.
- Still provisional: the labels are uncorrected.

## Results — skill-picking challenge (2026-11-21)

A fresh set of 146 synthetic tasks, written so the correct skills are known by construction, covering **all 136 installed skills** as targets. Mode is set by the phrase rule, so it is correct by design and tests nothing. This set measures skill-picking across the whole catalogue, including the near-neighbour families (17 `llmquant-*`, 15 resume skills, 14 option skills). It replaces the uncorrected 60-task set as the real skills measurement.

| Model | Mode | Skills | p50 | p95 | Licence |
|---|---|---|---|---|---|
| **kev:4b-q4_K_M** | 1.00 | **0.73** | 0.78 s | 1.03 s | Apache 2.0 |
| tev1:latest | 1.00 | 0.60 | 0.87 s | 1.01 s | not stated |

Embedding shortlist recall (all-minilm — how often every target skill reaches the model):

| top-k | recall |
|---|---|
| 8 (current) | 0.887 |
| 12 | 0.923 |
| 16 | 0.930 |
| 24 | 0.944 |

- **Mode and speed pass.** Mode is 1.00 (the phrase rule). p95 is about 1.0 s, under the 1.5 s target, with headroom.
- **kev beats tev1 on skills, 0.73 vs 0.60.** kev is the licence-safe pick, as §9 decided.
- **Skills misses the 0.80 bar (0.73).** The loss has two parts. The top-8 shortlist already drops a target 11 % of the time (recall@8 = 0.887), so a perfect decision model caps near 0.89 at k=8. kev loses a further ~0.16 by refusing a skill it was shown, or over-picking.
- **The cheap levers were tried and do not help (kev):**

  | config | skills | p95 |
  |---|---|---|
  | k=8, thr=0.70 (default) | **0.73** | 1.03 s |
  | k=12, thr=0.70 | 0.74 | 1.38 s |
  | k=16, thr=0.70 | 0.70 | 1.63 s |
  | k=12, thr=0.60 | 0.67 | 1.33 s |

  A bigger shortlist barely moves skills and costs latency (k=16 goes over the 1.5 s target and scores worse, because more candidates mean more wrong "yes" picks). A looser threshold is worse, because the score penalises more than two extra picks. **The default (k=8, thr=0.70) is already kev's best config.**
- **What is left to lift skills past 0.80:** a stronger decision model (kev refuses ~0.16 of skills it is shown), or a stronger embedding model (recall@8 is 0.887). Neither is a free knob.

**Go/no-go verdict:** mode and speed PASS; skills FAIL at 0.73 (kev, the best licence-safe model). Per §9 a skills fail means phase 1 ships skill-picking by description matching — unless the cheap levers above clear 0.80 first.

## Bugs found and fixed during the run
- Ollama's context-size answer is HTTP 500. It is now `too_large` (`fix(backend)`, 5a4f5cd).
- `eval draft` took one prompt per session. It now takes every real prompt of 8 words or more. A short reply stays with its task, and continuation summaries are skipped (`feat(eval)` / `fix(eval)`).

## Next steps
1. **The owner corrects the labels** in `~/.crewcast/eval/review.csv`. Then rerun all models for the real verdict.
2. ~~**Ask fewer skill questions:** a shortlist of 8, not 20.~~ Done (embedding shortlist, k=8) — see "Results — new path" above. p95 roughly halved.
3. **Choose the default by accuracy and licence.** nimble-v3 is the most accurate here, but it is for non-commercial use only. So it cannot be crewcast's public default. tev1 and kev are the licence-safe candidates.
