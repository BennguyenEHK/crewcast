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

## Bugs found and fixed during the run
- Ollama's context-size answer is HTTP 500. It is now `too_large` (`fix(backend)`, 5a4f5cd).
- `eval draft` took one prompt per session. It now takes every real prompt of 8 words or more. A short reply stays with its task, and continuation summaries are skipped (`feat(eval)` / `fix(eval)`).

## Next steps
1. **The owner corrects the labels** in `~/.crewcast/eval/review.csv`. Then rerun all models for the real verdict.
2. **Ask fewer skill questions:** a shortlist of 8, not 20, with shorter descriptions. This makes the request shorter (less overflow) and faster. Then rerun nimble-v3, tev1 and kev.
3. **Choose the default by accuracy and licence.** nimble-v3 is the most accurate here, but it is for non-commercial use only. So it cannot be crewcast's public default. tev1 and kev are the licence-safe candidates.
