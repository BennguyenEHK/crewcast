// The allowed keys of each choice signal; a model answer outside them is uncertain, never a guess.
export const TASK_TYPES = ['implement', 'fix', 'review', 'research', 'plan', 'docs', 'test', 'refactor', 'ops'] as const;
export const RISK_AREAS = ['none', 'auth', 'db_schema', 'payments', 'deploy', 'secrets'] as const;
export const SIZES = ['one_file', 'few_files', 'many_files'] as const;
export type TaskType = (typeof TASK_TYPES)[number];
export type RiskArea = (typeof RISK_AREAS)[number];
export type Size = (typeof SIZES)[number];

export interface Signal<T> { value: T | null; p: number; uncertain?: true } // value null only when uncertain

export interface AgentPlan {
  role: 'lead' | 'review';
  engine: string;
  model: string;
  effort: string | null;
  skills: string[];
  mcps: string[];
}

export interface GitState { isRepo: boolean; branch: string | null; defaultBranch: string | null; dirty: boolean }

export interface DecisionRecord {
  version: 1;
  id: string;
  task: string;
  mode: 'solo' | 'team' | 'uncertain';
  shadow: boolean;
  signals: {
    task_type: Signal<TaskType>;
    writes_files: Signal<boolean>;
    risk_area: Signal<RiskArea>;
    size: Signal<Size>;
    needs_web: Signal<boolean>;
  };
  skills_uncertain: string[];
  branch: { action: 'keep' | 'new'; name?: string };
  agents: AgentPlan[];
  ms: number;
  backend: string;
  error?: string;
}
