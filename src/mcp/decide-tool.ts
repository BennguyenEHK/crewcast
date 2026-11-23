import { BackendError, type SystemOneRequest, type SystemOneResponse } from '../backend/systemone.js';
import type { Skill } from '../catalog/skills.js';
import { SkillIndex } from '../catalog/skill-index.js';
import { Decider } from '../decide/decide.js';
import type { GitState } from '../decide/record.js';
import { ShadowLog } from '../shadow.js';
import type { McpContent, McpTool } from './server.js';

export class DecideTool implements McpTool {
  readonly name = 'decide';
  readonly description = 'Decide how AI coding work runs (mode, skills, branch, agents) — local, no AI tokens.';
  readonly inputSchema = {
    type: 'object',
    properties: { task: { type: 'string' }, model: { type: 'string' } },
    required: ['task'],
  };

  private readonly index: SkillIndex;

  constructor(
    private readonly deps: {
      ask: (r: SystemOneRequest) => Promise<SystemOneResponse>;
      skills: Skill[];
      git: GitState | null;
      home: string;
      baseUrl: string;
      defaultModel: string;
    },
  ) {
    this.index = new SkillIndex({ baseUrl: deps.baseUrl, home: deps.home });
  }

  async call(args: Record<string, unknown>): Promise<McpContent> {
    const task = typeof args.task === 'string' ? args.task.trim() : '';
    if (!task) return DecideTool.err('task is required (a non-empty string)');
    const model = typeof args.model === 'string' && args.model ? args.model : this.deps.defaultModel;
    try {
      const rec = await new Decider({
        ask: this.deps.ask,
        skills: this.deps.skills,
        git: this.deps.git,
        model,
        shortlist: (t, s) => this.index.top(t, s),
      }).decide(task);
      if (rec.shadow) await new ShadowLog(this.deps.home).append(rec);
      return { content: [{ type: 'text', text: JSON.stringify(rec) }] };
    } catch (err) {
      return DecideTool.err(this.message(err, model));
    }
  }

  // Same wording as the CLI's backend lines, so CLI and MCP match.
  private message(err: unknown, model: string): string {
    if (!(err instanceof BackendError)) return `error: ${(err as Error).message}`;
    const base = this.deps.baseUrl;
    if (err.code === 'ollama_unreachable') return `Ollama not reachable at ${base} — start Ollama`;
    if (err.code === 'model_missing') return `model '${model}' not found — run: ollama pull ${model}`;
    if (err.code === 'timeout') return `Ollama at ${base} did not answer in 10 s — the model may still be loading; run the command again`;
    return `error: ${err.message}`;
  }

  private static err(text: string): McpContent {
    return { content: [{ type: 'text', text }], isError: true };
  }
}
