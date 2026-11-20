import { homedir } from 'node:os';
import { join } from 'node:path';

export class Config {
  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  get home(): string {
    return this.env.CREWCAST_HOME || join(homedir(), '.crewcast');
  }

  get ollamaBaseUrl(): string {
    const raw = this.env.OLLAMA_HOST || '127.0.0.1:11434';
    const url = new URL(raw.includes('://') ? raw : `http://${raw}`);
    // 0.0.0.0 is a listen address, not a client address
    if (url.hostname === '0.0.0.0') url.hostname = '127.0.0.1';
    if (!url.port) url.port = '11434';
    return `${url.protocol}//${url.host}`;
  }
}
