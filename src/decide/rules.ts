import type { Answer, SystemOneResponse } from '../backend/systemone.js';
import type { Skill } from '../catalog/skills.js';
import { RISK_AREAS, SIZES, TASK_TYPES, type DecisionRecord, type GitState, type RiskArea, type Signal, type Size, type TaskType } from './record.js';

export interface Rules {
  thresholds: { choice: number; yes: number; no: number; skill: number };
  leadEngine: string;
  review: { engine: string; model: string; skill: string };
}

export const DEFAULT_RULES: Rules = {
  thresholds: { choice: 0.6, yes: 0.7, no: 0.3, skill: 0.7 },
  leadEngine: 'claude',
  review: { engine: 'copilot', model: 'gpt-5-mini', skill: 'security-review' },
};

const SIZE_SCORE: Record<Size, number> = { one_file: 1, few_files: 3, many_files: 4 };
const unsure = <T>(p = 0): Signal<T> => ({ value: null, p, uncertain: true });

type Signals = DecisionRecord['signals'];

export class RuleEngine {
  constructor(readonly rules: Rules = DEFAULT_RULES) {}

  toSignals(answers: SystemOneResponse['answers']): Signals {
    return {
      task_type: this.choice<TaskType>(answers.task_type, TASK_TYPES),
      writes_files: this.noul(answers.writes_files),
      risk_area: this.choice<RiskArea>(answers.risk_area, RISK_AREAS),
      size: this.choice<Size>(answers.size, SIZES),
      needs_web: this.noul(answers.needs_web),
    };
  }

  // A skill is picked when its noul is at least the skill threshold; between no and skill it is only flagged.
  pickSkills(answers: SystemOneResponse['answers'], shortlisted: Skill[]): { picked: string[]; uncertain: string[] } {
    const { skill, no } = this.rules.thresholds;
    const picked: string[] = [];
    const uncertain: string[] = [];
    shortlisted.forEach((s, i) => {
      const a = answers[`skill_${i}`];
      if (a?.type !== 'noul') return;
      if (a.noul >= skill) picked.push(s.name);
      else if (a.noul > no) uncertain.push(s.name);
    });
    return { picked, uncertain };
  }

  apply(signals: Signals, picked: string[], git: GitState | null, task: string): Pick<DecisionRecord, 'mode' | 'branch' | 'agents'> {
    const { size, risk_area, writes_files } = signals;
    const risk = risk_area.value;
    const score = size.value === null || risk === null
      ? null
      : Math.min(5, Math.max(1, SIZE_SCORE[size.value] + (risk !== 'none' ? 1 : 0)));
    const mode: DecisionRecord['mode'] = score === null
      ? 'uncertain'
      : score >= 4 || risk !== 'none' ? 'team' : 'solo';

    const agents: DecisionRecord['agents'] = [{
      role: 'lead',
      engine: this.rules.leadEngine,
      model: 'default',
      effort: score !== null && score >= 4 ? 'high' : null,
      skills: picked,
      mcps: [],
    }];
    // An uncertain risk area also gets the review agent: a security pass on a maybe-risky task is cheap.
    if (risk !== 'none') {
      agents.push({
        role: 'review',
        engine: this.rules.review.engine,
        model: this.rules.review.model,
        effort: null,
        skills: [this.rules.review.skill],
        mcps: [],
      });
    }

    const branchNew = writes_files.value === true && git !== null && git.isRepo
      && git.branch !== null && git.branch === git.defaultBranch && (git.dirty || mode === 'team');
    return {
      mode,
      branch: branchNew ? { action: 'new', name: RuleEngine.branchName(task) } : { action: 'keep' },
      agents,
    };
  }

  // shortcut: slug takes the first 4 alphanumeric words; upgrade if branch names need ticket ids or a model-written title.
  private static branchName(task: string): string {
    const words = task.toLowerCase().match(/[a-z0-9]+/g)?.slice(0, 4).join('-') || 'task';
    return `feat/${words}`.slice(0, 40);
  }

  private choice<T extends string>(a: Answer | undefined, allowed: readonly T[]): Signal<T> {
    if (a?.type !== 'choice' || !allowed.includes(a.choice as T)) return unsure<T>();
    const p = a.probabilities?.[a.choice];
    if (typeof p !== 'number') return unsure<T>();
    if (p < this.rules.thresholds.choice) return unsure<T>(p);
    return { value: a.choice as T, p };
  }

  private noul(a: Answer | undefined): Signal<boolean> {
    if (a?.type !== 'noul' || typeof a.noul !== 'number') return unsure<boolean>();
    const { yes, no } = this.rules.thresholds;
    const p = Math.max(a.noul, 1 - a.noul);
    if (a.noul >= yes) return { value: true, p };
    if (a.noul <= no) return { value: false, p };
    return unsure<boolean>(p);
  }
}
