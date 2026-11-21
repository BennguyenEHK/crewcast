import { ShadowLog, type Actual } from './shadow.js';

export interface TranscriptSummary { firstPrompt: string | null; actual: Actual; cwd: string | null; skipped: number }

// Subagent types that are read-only helpers, not a second working agent.
const SOLO_AGENTS = new Set(['web-fetch', 'Explore', 'claude-code-guide', 'statusline-setup']);
const ENGINE_CMD = /^\s*(codex|gemini|copilot|kiro-cli|claude\s+-p)(\s|$)/;

type Block = { type?: string; name?: string; input?: Record<string, unknown> & { run_in_background?: unknown } };
type Line = { type?: string; isMeta?: boolean; isSidechain?: boolean; cwd?: unknown; message?: { content?: unknown } };

export class TranscriptReader {
  // Claude Code's transcript format is internal and changes; every line is read on its own.
  async summarize(file: string): Promise<TranscriptSummary> {
    const { rows, skipped: corrupt } = await ShadowLog.readJsonl<Line>(file);
    let skipped = corrupt;
    let firstPrompt: string | null = null;
    let cwd: string | null = null;
    const skills: string[] = [];
    const engines = new Set<string>();
    let team = false;

    for (const row of rows) {
      if (!row || typeof row !== 'object' || (row.type !== 'user' && row.type !== 'assistant')) {
        skipped++;
        continue;
      }
      if (cwd === null && typeof row.cwd === 'string') cwd = row.cwd;
      if (firstPrompt === null && row.type === 'user' && !row.isMeta && !row.isSidechain) {
        firstPrompt = TranscriptReader.prompt(row.message?.content);
      }
      const content = Array.isArray(row.message?.content) ? row.message.content as Block[] : [];
      for (const block of content) {
        if (block?.type !== 'tool_use') continue;
        const input = block.input ?? {};
        if (block.name === 'Skill' && typeof input.skill === 'string' && !skills.includes(input.skill)) skills.push(input.skill);
        if ((block.name === 'Agent' || block.name === 'Task') && !SOLO_AGENTS.has(String(input.subagent_type ?? 'general-purpose'))) team = true;
        if ((block.name === 'Bash' || block.name === 'PowerShell') && input.run_in_background === true) {
          const m = ENGINE_CMD.exec(String(input.command ?? ''));
          if (m) {
            engines.add(m[1].split(/\s/)[0]);
            team = true;
          }
        }
      }
    }

    engines.add('claude');
    return {
      firstPrompt,
      cwd,
      skipped,
      actual: { mode: team ? 'team' : 'solo', skills, engines: [...engines] },
    };
  }

  // A real user prompt is text; wrappers such as <command-name> start with '<' and are not prompts.
  private static prompt(content: unknown): string | null {
    const text = typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content.filter((b: any) => b?.type === 'text' && typeof b.text === 'string').map((b: any) => b.text).join('\n')
        : '';
    const trimmed = text.trim();
    if (!trimmed || trimmed.startsWith('<')) return null;
    return trimmed.slice(0, 2000);
  }
}
