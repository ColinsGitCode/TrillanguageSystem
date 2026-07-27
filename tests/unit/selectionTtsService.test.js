'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SelectionTtsService,
  normalizeSelectionText,
} = require('../../services/selectionTts/selectionTtsService');

function result(text = 'audio') {
  return {
    buffer: Buffer.from(text),
    contentType: 'audio/mpeg',
    ttsProvider: 'fixture',
    ttsModel: 'fixture-model',
    ttsVoice: 'fixture-voice',
    queueWaitMs: 0,
    contended: false,
  };
}

function service(options = {}) {
  const store = new Map();
  const cache = options.cache || {
    async get(key) {
      return store.get(key) || null;
    },
    async set(key, buffer, metadata) {
      store.set(key, { buffer, metadata });
      return true;
    },
  };
  return new SelectionTtsService({
    enabled: true,
    maxChars: 300,
    timeoutMs: 100,
    maxConcurrency: 2,
    maxResponseBytes: 1024,
    cache,
    getSynthesisIdentity: ({ language }) => ({
      language,
      provider: 'fixture',
      model: 'fixture-model',
      voice: 'fixture-voice',
      format: language === 'en' ? 'mp3' : 'wav',
    }),
    synthesizeSpeech: options.synthesizeSpeech || (async () => result()),
    ...options,
  });
}

test('normalizes selection whitespace without rewriting visible content', () => {
  assert.equal(normalizeSelectionText('  Read\t this\nclearly.  '), 'Read this clearly.');
  assert.equal(normalizeSelectionText('発音\u0000を確認'), '発音を確認');
});

test('validates language, speed, markup and Unicode code point length', async () => {
  const tts = service({ maxChars: 2 });
  await assert.rejects(
    tts.synthesize({ text: 'abc', language: 'en', speed: 1 }),
    { code: 'SELECTION_TTS_TEXT_TOO_LONG', status: 413 }
  );
  const normalLimit = service();
  await assert.rejects(
    normalLimit.synthesize({ text: '<speak>hello</speak>', language: 'en', speed: 1 }),
    { code: 'SELECTION_TTS_INVALID_INPUT', status: 400 }
  );
  await assert.rejects(
    normalLimit.synthesize({ text: 'hello', language: 'zh', speed: 1 }),
    { code: 'SELECTION_TTS_INVALID_INPUT', status: 400 }
  );
  await assert.rejects(
    normalLimit.synthesize({ text: 'hello', language: 'en', speed: 0.9 }),
    { code: 'SELECTION_TTS_INVALID_INPUT', status: 400 }
  );
  const unicode = await tts.synthesize({ text: '😀😀', language: 'en', speed: 1 });
  assert.equal(unicode.characterCount, 2);
});

test('uses stable cache keys and changes identity when speed changes', async () => {
  let calls = 0;
  const tts = service({
    synthesizeSpeech: async () => {
      calls += 1;
      return result(`audio-${calls}`);
    },
  });
  const first = await tts.synthesize({ text: 'hello', language: 'en', speed: 1 });
  const second = await tts.synthesize({ text: 'hello', language: 'en', speed: 1 });
  const slower = await tts.synthesize({ text: 'hello', language: 'en', speed: 0.8 });
  assert.equal(first.cacheStatus, 'MISS');
  assert.equal(second.cacheStatus, 'HIT');
  assert.equal(slower.cacheStatus, 'MISS');
  assert.equal(calls, 2);
});

test('coalesces identical requests and rejects unrelated overload', async () => {
  let release;
  let calls = 0;
  const pending = new Promise((resolve) => { release = resolve; });
  const tts = service({
    maxConcurrency: 1,
    synthesizeSpeech: async () => {
      calls += 1;
      await pending;
      return result();
    },
  });
  const first = tts.synthesize({ text: 'same', language: 'en', speed: 1 });
  const joined = tts.synthesize({ text: 'same', language: 'en', speed: 1 });
  await assert.rejects(
    tts.synthesize({ text: 'different', language: 'en', speed: 1 }),
    { code: 'SELECTION_TTS_BUSY', status: 429 }
  );
  release();
  await Promise.all([first, joined]);
  assert.equal(calls, 1);
});

test('cache write failure bypasses storage without failing synthesis', async () => {
  const tts = service({
    cache: {
      async get() { return null; },
      async set() { return false; },
    },
  });
  const audio = await tts.synthesize({ text: 'bypass', language: 'en', speed: 1 });
  assert.equal(audio.cacheStatus, 'BYPASS');
  assert.equal(audio.buffer.toString(), 'audio');
});

test('removes an oversized cache entry before regenerating a bounded response', async () => {
  let removed = false;
  let generated = 0;
  const tts = service({
    maxResponseBytes: 4,
    cache: {
      async get() {
        return { buffer: Buffer.from('oversized'), metadata: {} };
      },
      async remove() {
        removed = true;
      },
      async set() {
        return true;
      },
    },
    synthesizeSpeech: async () => {
      generated += 1;
      return result('safe');
    },
  });
  const audio = await tts.synthesize({ text: 'bounded', language: 'en', speed: 1 });
  assert.equal(removed, true);
  assert.equal(generated, 1);
  assert.equal(audio.buffer.toString(), 'safe');
  assert.equal(audio.cacheStatus, 'MISS');
});

test('maps provider timeout, oversized responses and disabled state', async () => {
  const timeout = service({
    timeoutMs: 10,
    synthesizeSpeech: (_input, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      });
    }),
  });
  await assert.rejects(
    timeout.synthesize({ text: 'slow', language: 'en', speed: 1 }),
    { code: 'SELECTION_TTS_TIMEOUT', status: 504 }
  );

  const oversized = service({
    maxResponseBytes: 2,
    synthesizeSpeech: async () => result('too-large'),
  });
  await assert.rejects(
    oversized.synthesize({ text: 'large', language: 'en', speed: 1 }),
    { code: 'SELECTION_TTS_PROVIDER_FAILED', status: 502 }
  );

  const disabled = new SelectionTtsService({ enabled: false });
  await assert.rejects(
    disabled.synthesize({ text: 'hello', language: 'en', speed: 1 }),
    { code: 'SELECTION_TTS_DISABLED', status: 404 }
  );
});

test('aborts the provider when the final subscriber leaves', async () => {
  let providerAborted = false;
  const tts = service({
    synthesizeSpeech: (_input, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => {
        providerAborted = true;
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      });
    }),
  });
  const controller = new AbortController();
  const request = tts.synthesize(
    { text: 'cancel me', language: 'en', speed: 1 },
    { signal: controller.signal }
  );
  controller.abort();
  await assert.rejects(request, { code: 'SELECTION_TTS_ABORTED' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(providerAborted, true);
});
