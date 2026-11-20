export type TaskType = 'implement' | 'fix' | 'review' | 'research' | 'plan' | 'docs' | 'test' | 'refactor' | 'ops';
export type RiskArea = 'none' | 'auth' | 'db_schema' | 'payments' | 'deploy' | 'secrets';
export type Size = 'one_file' | 'few_files' | 'many_files';

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
