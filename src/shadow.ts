import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DecisionRecord } from './decide/record.js';

export interface Actual { mode: 'solo' | 'team'; skills: string[]; engines?: string[] }

export class ShadowLog {
  constructor(private readonly home: string) {}

  async append(rec: DecisionRecord): Promise<void> {
    await this.write('shadow.jsonl', rec);
  }

  async addLabel(id: string, actual: Actual): Promise<void> {
    await this.write('labels.jsonl', { id, actual });
  }

  // A missing file is an empty log; a corrupt line is skipped and counted, never silently dropped.
  static async readJsonl<T>(file: string): Promise<{ rows: T[]; skipped: number }> {
    let text: string;
    try {
      text = await readFile(file, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { rows: [], skipped: 0 };
      throw err;
    }
    const rows: T[] = [];
    let skipped = 0;
    for (const line of text.replace(/^﻿/, '').split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        rows.push(JSON.parse(line) as T);
      } catch {
        skipped++;
      }
    }
    return { rows, skipped };
  }

  private async write(file: string, row: unknown): Promise<void> {
    await mkdir(this.home, { recursive: true });
    await appendFile(join(this.home, file), `${JSON.stringify(row)}\n`, 'utf8');
  }
}
