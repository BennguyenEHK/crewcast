import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BackendError, SystemOneClient, type SystemOneRequest } from '../src/backend/systemone.js';

const choice = (options: number) => ({
  type: 'choice' as const,
  instructions: 'pick one',
  criteria: Object.fromEntries(Array.from({ length: options }, (_, i) => [`o${i}`, null])),
});
const req = (over: Partial<SystemOneRequest> = {}): SystemOneRequest => ({
  model: 'systemone',
  state: 'synthetic task',
  questions: { q1: choice(3) },
  ...over,
});
const fake = (fn: (url: string, init: RequestInit) => Promise<Response>) => fn as unknown as typeof fetch;
const codeIs = (code: string) => (e: unknown) => e instanceof BackendError && e.code === code;
const client = (fetchFn: typeof fetch) => new SystemOneClient({ baseUrl: 'http://ollama.test:11434', fetchFn });

test('sends POST to /v1/systemone and returns answers', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchFn = fake(async (url, init) => {
    calls.push({ url: String(url), init });
    return Response.json({ model: 'systemone', answers: { q1: { type: 'noul', noul: 1 } } });
  });
  const res = await client(fetchFn).ask(req());
  assert.equal(calls[0].url, 'http://ollama.test:11434/v1/systemone');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(JSON.parse(String(calls[0].init.body)).model, 'systemone');
  assert.deepEqual(res.answers, { q1: { type: 'noul', noul: 1 } });
});

test('65 questions → BackendError bad_request', () => {
  const questions = Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`q${i}`, { type: 'noul', instructions: 'x' }]));
  assert.throws(() => SystemOneClient.checkLimits(req({ questions: questions as SystemOneRequest['questions'] })), codeIs('bad_request'));
});

test('choice with 27 options → bad_request; with 1 option → bad_request', () => {
  assert.throws(() => SystemOneClient.checkLimits(req({ questions: { q1: choice(27) } })), codeIs('bad_request'));
  assert.throws(() => SystemOneClient.checkLimits(req({ questions: { q1: choice(1) } })), codeIs('bad_request'));
});

test('body over 64 KiB → too_large', async () => {
  const big = req({ state: 'x'.repeat(70_000) });
  assert.throws(() => SystemOneClient.checkLimits(big), codeIs('too_large'));
  let called = false;
  await assert.rejects(client(fake(async () => { called = true; return Response.json({}); })).ask(big), codeIs('too_large'));
  assert.equal(called, false);
});

test('fetch rejects (ECONNREFUSED) → ollama_unreachable', async () => {
  const fetchFn = fake(async () => { throw new TypeError('fetch failed'); });
  await assert.rejects(client(fetchFn).ask(req()), codeIs('ollama_unreachable'));
});

test('abort or timeout → timeout', async () => {
  const aborted = fake(async () => { throw new DOMException('aborted', 'AbortError'); });
  await assert.rejects(client(aborted).ask(req()), codeIs('timeout'));
  const timed = fake(async () => { throw new DOMException('timed out', 'TimeoutError'); });
  await assert.rejects(client(timed).ask(req()), codeIs('timeout'));
});

test('HTTP 404 → model_missing', async () => {
  const fetchFn = fake(async () => new Response('model not found', { status: 404 }));
  await assert.rejects(client(fetchFn).ask(req()), codeIs('model_missing'));
});

test('HTTP 400 → bad_request, or too_large when the body mentions tokens', async () => {
  await assert.rejects(client(fake(async () => new Response('bad input', { status: 400 }))).ask(req()), codeIs('bad_request'));
  await assert.rejects(client(fake(async () => new Response('prompt exceeds token limit', { status: 400 }))).ask(req()), codeIs('too_large'));
});

test('response without answers → bad_response', async () => {
  const fetchFn = fake(async () => Response.json({ model: 'systemone' }));
  await assert.rejects(client(fetchFn).ask(req()), codeIs('bad_response'));
});
