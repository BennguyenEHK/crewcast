import type { DecisionRecord } from './decide/record.js';
import type { Actual } from './shadow.js';

export interface Report { n: number; mode: number; skills: number; uncertain: Record<string, number>; p50ms: number; p95ms: number; pass: boolean; skipped: number }

// Nearest-rank percentile over an ascending list.
const percentile = (sorted: number[], p: number): number =>
  sorted.length ? sorted[Math.ceil((p / 100) * sorted.length) - 1] : 0;

export class Agreement {
  agrees(rec: DecisionRecord, actual: Actual): { mode: boolean; skills: boolean } {
    const picked = rec.agents[0]?.skills ?? [];
    const extras = picked.filter(s => !actual.skills.includes(s)).length;
    return {
      mode: rec.mode === actual.mode,
      skills: !rec.error && actual.skills.every(s => picked.includes(s)) && extras <= 2,
    };
  }

  report(pairs: { rec: DecisionRecord; actual: Actual }[], skipped = 0): Report {
    const n = pairs.length;
    let modeHits = 0;
    let skillHits = 0;
    const uncertain: Record<string, number> = {};
    for (const { rec, actual } of pairs) {
      const a = this.agrees(rec, actual);
      if (a.mode) modeHits++;
      if (a.skills) skillHits++;
      for (const [name, sig] of Object.entries(rec.signals)) {
        if (sig.uncertain) uncertain[name] = (uncertain[name] ?? 0) + 1;
      }
    }
    const ms = pairs.map(p => p.rec.ms).sort((x, y) => x - y);
    const mode = n ? modeHits / n : 0;
    const skills = n ? skillHits / n : 0;
    return {
      n,
      mode,
      skills,
      uncertain,
      p50ms: percentile(ms, 50),
      p95ms: percentile(ms, 95),
      pass: n >= 1 && mode >= 0.8 && skills >= 0.8,
      skipped,
    };
  }
}
