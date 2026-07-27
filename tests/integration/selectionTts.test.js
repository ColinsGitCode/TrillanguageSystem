'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { snapshotDatabase } = require('../../scripts/tests/selectionTtsDataIntegrity');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'selection-tts-integration-'));
let provider;
let api;
let closeServer;
let dbPath;
const calls = { en: 0, query: 0, synthesis: 0 };

test.before(async () => {
  provider = http.createServer((req, res) => {
    if (req.url === '/v1/audio/speech' && req.method === 'POST') {
      calls.en += 1;
      res.writeHead(200, { 'content-type': 'audio/mpeg' });
      res.end('fixture-mp3');
      return;
    }
    if (req.url.startsWith('/audio_query') && req.method === 'POST') {
      calls.query += 1;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ accent_phrases: [], speedScale: 1 }));
      return;
    }
    if (req.url.startsWith('/synthesis') && req.method === 'POST') {
      calls.synthesis += 1;
      res.writeHead(200, { 'content-type': 'audio/wav' });
      res.end('fixture-wav');
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve));
  const port = provider.address().port;
  dbPath = path.join(root, 'integration.sqlite');
  process.env.DB_PATH = dbPath;
  process.env.SELECTION_TTS_ENABLED = '1';
  process.env.SELECTION_TTS_CACHE_PATH = path.join(root, 'cache');
  process.env.TTS_EN_TYPE = 'kokoro';
  process.env.TTS_EN_ENDPOINT = `http://127.0.0.1:${port}/v1/audio/speech`;
  process.env.TTS_JA_TYPE = 'voicevox';
  process.env.TTS_JA_ENDPOINT = `http://127.0.0.1:${port}`;
  ({ api, closeServer } = require('./_harness'));
});

test.after(async () => {
  if (closeServer) await closeServer();
  if (provider) await new Promise((resolve) => provider.close(resolve));
  fs.rmSync(root, { recursive: true, force: true });
});

test('selection TTS returns binary EN/JA audio, cache HIT and zero domain writes', async () => {
  const before = snapshotDatabase(dbPath);
  const config = await api('GET', '/api/tts/selection');
  assert.equal(config.status, 200);
  assert.equal(config.body.enabled, true);
  assert.deepEqual(config.body.speeds, [0.8, 1, 1.2]);

  const english = await api('POST', '/api/tts/selection', {
    body: { text: 'Read this sentence.', language: 'en', speed: 1 },
  });
  assert.equal(english.status, 200);
  assert.equal(english.headers['content-type'], 'audio/mpeg');
  assert.equal(english.headers['x-tts-cache'], 'MISS');
  assert.equal(english.rawText, 'fixture-mp3');

  const repeated = await api('POST', '/api/tts/selection', {
    body: { text: 'Read this sentence.', language: 'en', speed: 1 },
  });
  assert.equal(repeated.status, 200);
  assert.equal(repeated.headers['x-tts-cache'], 'HIT');
  assert.equal(calls.en, 1);

  const japanese = await api('POST', '/api/tts/selection', {
    body: { text: '発音を確認します。', language: 'ja', speed: 0.8 },
  });
  assert.equal(japanese.status, 200);
  assert.equal(japanese.headers['content-type'], 'audio/wav');
  assert.equal(japanese.rawText, 'fixture-wav');
  assert.equal(calls.query, 1);
  assert.equal(calls.synthesis, 1);

  const after = snapshotDatabase(dbPath);
  assert.equal(after.aggregateSha256, before.aggregateSha256);
});

test('selection TTS rejects invalid inputs without exposing provider details', async () => {
  for (const [body, status, code] of [
    [{ text: '', language: 'en', speed: 1 }, 400, 'SELECTION_TTS_INVALID_INPUT'],
    [{ text: 'hello', language: 'zh', speed: 1 }, 400, 'SELECTION_TTS_INVALID_INPUT'],
    [{ text: 'hello', language: 'en', speed: 0.9 }, 400, 'SELECTION_TTS_INVALID_INPUT'],
    [{ text: 'x'.repeat(301), language: 'en', speed: 1 }, 413, 'SELECTION_TTS_TEXT_TOO_LONG'],
  ]) {
    const response = await api('POST', '/api/tts/selection', { body });
    assert.equal(response.status, status);
    assert.equal(response.body.code, code);
    assert.equal(JSON.stringify(response.body).includes(root), false);
  }
});
