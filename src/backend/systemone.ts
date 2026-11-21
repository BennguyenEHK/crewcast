export type Question =
  | { type: 'choice'; instructions: string; criteria: Record<string, string | null> }
  | { type: 'noul'; instructions: string; criteria?: { true: string; false: string } };
export interface SystemOneRequest { model: string; state: string; questions: Record<string, Question>; keep_alive?: string }
export type Answer =
  | { type: 'choice'; choice: string; probabilities: Record<string, number>; confidence: number }
  | { type: 'noul'; noul: number };
export interface SystemOneResponse { model: string; answers: Record<string, Answer>; usage?: { input_tokens: number; output_tokens: number } }
export type BackendErrorCode = 'ollama_unreachable' | 'model_missing' | 'too_large' | 'bad_request' | 'timeout' | 'bad_response';

export class BackendError extends Error {
  constructor(public code: BackendErrorCode, message: string) {
    super(message);
  }
}

export class SystemOneClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;

  constructor(opts: { baseUrl: string; timeoutMs?: number; fetchFn?: typeof fetch }) {
    this.baseUrl = opts.baseUrl;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.fetchFn = opts.fetchFn ?? fetch;
  }

  async ask(req: SystemOneRequest): Promise<SystemOneResponse> {
    SystemOneClient.checkLimits(req);
    let res: Response;
    let text: string;
    try {
      res = await this.fetchFn(`${this.baseUrl}/v1/systemone`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(req),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      text = await res.text();
    } catch (err) {
      const name = err instanceof Error ? err.name : '';
      if (name === 'AbortError' || name === 'TimeoutError') throw new BackendError('timeout', `no answer within ${this.timeoutMs} ms`);
      throw new BackendError('ollama_unreachable', `cannot reach ${this.baseUrl}`);
    }
    if (res.status === 404) throw new BackendError('model_missing', `model ${req.model} is not pulled`);
    if (res.status === 400) throw new BackendError(/token|length/i.test(text) ? 'too_large' : 'bad_request', text);
    if (!res.ok) throw new BackendError('bad_response', `HTTP ${res.status}`);
    let body: Partial<SystemOneResponse> | null;
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
    if (!body?.answers) throw new BackendError('bad_response', 'response has no answers');
    return body as SystemOneResponse;
  }

  static checkLimits(req: SystemOneRequest): void {
    const questions = Object.values(req.questions);
    if (questions.length < 1 || questions.length > 64) {
      throw new BackendError('bad_request', `need 1-64 questions, got ${questions.length}`);
    }
    for (const q of questions) {
      if (q.type !== 'choice') continue;
      const options = Object.keys(q.criteria).length;
      if (options < 2 || options > 26) throw new BackendError('bad_request', `choice needs 2-26 options, got ${options}`);
    }
    if (Buffer.byteLength(JSON.stringify(req)) > 65536) throw new BackendError('too_large', 'request body over 64 KiB');
  }
}
