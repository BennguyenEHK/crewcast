import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { ShadowLog } from './shadow.js';

export interface Message { ts: string; from: string; text: string }
export interface MailboxEntry extends Message { seq: number }

// shortcut: pattern-based key redaction, not an entropy scanner; tighten the ≥32 catch if it masks non-secret ids.
const REDACT: RegExp[] = [
  /(?:sk|ghp|github_pat|gho|ghu|ghs|ghr|xox[baprs])[-_][A-Za-z0-9_-]{8,}/g,
  /\bBearer\s+[A-Za-z0-9._-]{8,}/gi,
  /\b(?:password|passwd|secret|token|api[_-]?key|apikey|auth)\b\s*[:=]\s*\S+/gi,
  /\b[A-Za-z0-9+/_-]{32,}={0,2}\b/g,
];

// A per-run message log the captain and workers talk over (§7.7). One JSONL file per run; seq is the 1-based line index.
export class Mailbox {
  constructor(private readonly home: string) {}

  async post(run: string, from: string, text: string): Promise<void> {
    const dir = this.runDir(run);
    await mkdir(dir, { recursive: true });
    const line = JSON.stringify({ ts: new Date().toISOString(), from, text: Mailbox.redact(text) }) + '\n';
    await appendFile(join(dir, 'mailbox.jsonl'), line, 'utf8'); // append mode: the OS serializes each write, so concurrent workers never corrupt a line
  }

  async read(run: string, since = 0): Promise<{ messages: MailboxEntry[]; cursor: number }> {
    const { rows } = await ShadowLog.readJsonl<Message>(join(this.runDir(run), 'mailbox.jsonl'));
    const entries = rows.map((m, i) => ({ ...m, seq: i + 1 }));
    return { messages: entries.filter(e => e.seq > since), cursor: entries.length };
  }

  static redact(text: string): string {
    return REDACT.reduce((t, re) => t.replace(re, '***'), text);
  }

  private runDir(run: string): string {
    if (!run || run.includes('/') || run.includes('\\') || run.includes('..')) {
      throw new Error(`invalid run id: ${JSON.stringify(run)}`); // keep writes inside <home>/runs/
    }
    return join(this.home, 'runs', run);
  }
}
