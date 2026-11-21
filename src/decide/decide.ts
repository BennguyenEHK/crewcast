import { randomBytes } from 'node:crypto';
import { BackendError, type SystemOneRequest, type SystemOneResponse } from '../backend/systemone.js';
import { SkillCatalog, type Skill } from '../catalog/skills.js';
import type { GitState, DecisionRecord } from './record.js';
import { QuestionBuilder } from './questions.js';
import { RuleEngine, type Rules } from './rules.js';

export interface DeciderDeps {
  ask: (r: SystemOneRequest) => Promise<SystemOneResponse>;
  skills: Skill[];
  git: GitState | null;
  model: string;
  rules?: Rules;
  now?: () => number;
  shadow?: boolean;
}

export class Decider {
  private readonly engine: RuleEngine;
  private readonly now: () => number;

  constructor(private readonly deps: DeciderDeps) {
    this.engine = new RuleEngine(deps.rules);
    this.now = deps.now ?? Date.now;
  }

  async decide(task: string): Promise<DecisionRecord> {
    const start = this.now();
    const shortlisted = new SkillCatalog().shortlist(task, this.deps.skills);
    const base = {
      version: 1 as const,
      id: `${new Date().toISOString()}-${randomBytes(3).toString('hex')}`,
      task,
      shadow: this.deps.shadow ?? true,
      backend: `${this.deps.model}@ollama`,
    };

    let res: SystemOneResponse;
    try {
      res = await this.deps.ask({
        model: this.deps.model,
        state: task,
        questions: new QuestionBuilder().build(shortlisted),
        keep_alive: '30m',
      });
    } catch (err) {
      // Too large or rejected input: record it as uncertain instead of failing the user's task.
      if (err instanceof BackendError && (err.code === 'too_large' || err.code === 'bad_request')) {
        return {
          ...base,
          mode: 'uncertain',
          signals: this.engine.toSignals({}),
          skills_uncertain: [],
          branch: { action: 'keep' },
          agents: [],
          ms: this.now() - start,
          error: err.message,
        };
      }
      throw err;
    }

    const signals = this.engine.toSignals(res.answers);
    const skills = this.engine.pickSkills(res.answers, shortlisted);
    const { mode, branch, agents } = this.engine.apply(signals, skills.picked, this.deps.git, task);
    return { ...base, mode, signals, skills_uncertain: skills.uncertain, branch, agents, ms: this.now() - start };
  }
}
