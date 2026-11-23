import { createInterface } from 'node:readline';
import { open } from 'node:fs/promises';
import type { Actual } from './shadow.js';

export interface TranscriptSummary { firstPrompt: string | null; actual: Actual; cwd: string | null; skipped: number }
export interface PromptSegment { task: string; actual: Actual }
export interface TranscriptSegments { prompts: PromptSegment[]; skipped: number }

// Subagent types that are read-only helpers, not a second working agent.
const SOLO_AGENTS = new Set(['web-fetch', 'Explore', 'claude-code-guide', 'statusline-setup']);
const ENGINE_CMD = /^\s*(codex|agy|gemini|copilot|kiro-cli|claude\s+-p)(\s|$)/; // agy = Antigravity CLI; gemini kept for old transcripts
// A shorter prompt is a reply ("yes", "ok go"), not a task; spec §7.2 uses the same cutoff for the hook.
const MIN_TASK_WORDS = 8;

type Block = { type?: string; name?: string; input?: Record<string, unknown> & { run_in_background?: unknown } };
type Line = { type?: string; isMeta?: boolean; isSidechain?: boolean; isCompactSummary?: boolean; cwd?: unknown; message?: { content?: unknown } };
type Acc = { skills: string[]; engines: Set<string>; team: boolean };

const newAcc = (): Acc => ({ skills: [], engines: new Set(), team: false });

export class TranscriptReader {
  // Claude Code's transcript format is internal and changes; every line is read on its own.
  async summarize(file: string): Promise<TranscriptSummary> {
    const counter = { skipped: 0 };
    let firstPrompt: string | null = null;
    let cwd: string | null = null;
    const acc = newAcc();
    for await (const row of TranscriptReader.rows(file, counter)) {
      if (cwd === null && typeof row.cwd === 'string') cwd = row.cwd;
      if (firstPrompt === null) firstPrompt = TranscriptReader.userPrompt(row);
      TranscriptReader.fold(acc, row);
    }
    return { firstPrompt, cwd, skipped: counter.skipped, actual: TranscriptReader.actual(acc) };
  }

  // One entry per task prompt; tool_use blocks count until the next task prompt. A short reply
  // ("yes go ahead") does not start a task, so the work it triggers is credited to the current one.
  async segments(file: string): Promise<TranscriptSegments> {
    const counter = { skipped: 0 };
    const turns: { task: string; acc: Acc }[] = [];
    let acc = newAcc(); // tool_use before the first task prompt belongs to no task
    for await (const row of TranscriptReader.rows(file, counter)) {
      const task = TranscriptReader.userPrompt(row);
      if (task !== null && task.split(/\s+/).length >= MIN_TASK_WORDS) {
        acc = newAcc();
        turns.push({ task, acc });
      }
      TranscriptReader.fold(acc, row);
    }
    return { prompts: turns.map(t => ({ task: t.task, actual: TranscriptReader.actual(t.acc) })), skipped: counter.skipped };
  }

  // Streams the file line by line; corrupt lines and rows of other types are skipped and counted.
  private static async *rows(file: string, counter: { skipped: number }): AsyncGenerator<Line> {
    let handle;
    try {
      handle = await open(file, 'r');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return; // a missing file reads as empty
      throw err;
    }
    try {
      const lines = createInterface({ input: handle.createReadStream(), crlfDelay: Infinity });
      let first = true;
      for await (const raw of lines) {
        const line = first ? raw.replace(/^﻿/, '') : raw;
        first = false;
        if (!line.trim()) continue;
        let row: unknown;
        try {
          row = JSON.parse(line);
        } catch {
          counter.skipped++;
          continue;
        }
        const type = (row as Line | null)?.type;
        if (typeof row !== 'object' || row === null || (type !== 'user' && type !== 'assistant')) {
          counter.skipped++;
          continue;
        }
        yield row as Line;
      }
    } finally {
      await handle.close();
    }
  }

  private static userPrompt(row: Line): string | null {
    if (row.type !== 'user' || row.isMeta || row.isSidechain || row.isCompactSummary) return null;
    return TranscriptReader.prompt(row.message?.content);
  }

  private static fold(acc: Acc, row: Line): void {
    const content = Array.isArray(row.message?.content) ? row.message.content as Block[] : [];
    for (const block of content) {
      if (block?.type !== 'tool_use') continue;
      const input = block.input ?? {};
      if (block.name === 'Skill' && typeof input.skill === 'string' && !acc.skills.includes(input.skill)) acc.skills.push(input.skill);
      if ((block.name === 'Agent' || block.name === 'Task') && !SOLO_AGENTS.has(String(input.subagent_type ?? 'general-purpose'))) acc.team = true;
      if ((block.name === 'Bash' || block.name === 'PowerShell') && input.run_in_background === true) {
        const m = ENGINE_CMD.exec(String(input.command ?? ''));
        if (m) {
          acc.engines.add(m[1].split(/\s/)[0]);
          acc.team = true;
        }
      }
    }
  }

  private static actual(acc: Acc): Actual {
    return { mode: acc.team ? 'team' : 'solo', skills: acc.skills, engines: [...new Set([...acc.engines, 'claude'])] };
  }

  // A real user prompt is text; wrappers such as <command-name> start with '<', and a context-compaction
  // summary is not something the owner typed. Neither starts or ends a task.
  private static prompt(content: unknown): string | null {
    const text = typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content.filter((b: any) => b?.type === 'text' && typeof b.text === 'string').map((b: any) => b.text).join('\n')
        : '';
    const trimmed = text.trim();
    if (!trimmed || trimmed.startsWith('<') || trimmed.startsWith('This session is being continued')) return null;
    return trimmed.slice(0, 2000);
  }
}
