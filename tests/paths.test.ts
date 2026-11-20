import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Config } from '../src/paths.js';

test('CREWCAST_HOME overrides home', () =>
  assert.equal(new Config({ CREWCAST_HOME: 'X:\\h' }).home, 'X:\\h'));

test('default home is ~/.crewcast', () =>
  assert.match(new Config({}).home, /[\\/]\.crewcast$/));

test('OLLAMA_HOST normalization', () => {
  assert.equal(new Config({}).ollamaBaseUrl, 'http://127.0.0.1:11434');
  assert.equal(new Config({ OLLAMA_HOST: '0.0.0.0:11434' }).ollamaBaseUrl, 'http://127.0.0.1:11434');
  assert.equal(new Config({ OLLAMA_HOST: 'localhost' }).ollamaBaseUrl, 'http://localhost:11434');
  assert.equal(new Config({ OLLAMA_HOST: 'https://box:9000/' }).ollamaBaseUrl, 'https://box:9000');
});
