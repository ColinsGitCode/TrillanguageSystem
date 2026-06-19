'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function clearTtsModuleCache() {
  delete require.cache[require.resolve('../../services/generation/ttsService')];
}

function loadTtsService() {
  clearTtsModuleCache();
  return require('../../services/generation/ttsService');
}

async function withEnv(values, fn) {
  const saved = {};
  for (const key of Object.keys(values)) {
    saved[key] = process.env[key];
    if (values[key] === undefined) delete process.env[key];
    else process.env[key] = values[key];
  }
  try {
    return await fn();
  } finally {
    for (const key of Object.keys(values)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    clearTtsModuleCache();
  }
}

test.describe('generateAudioBatch TTS metadata', () => {
  test.it('falls back from Style-Bert-VITS2 to VOICEVOX and reports actual provider metadata', async (t) => {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tts-service-'));
    t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));

    const originalFetch = global.fetch;
    t.after(() => { global.fetch = originalFetch; });

    const calls = [];
    global.fetch = async (url, options = {}) => {
      const href = String(url);
      calls.push({ url: href, method: options.method || 'GET', body: options.body });
      if (href.startsWith('http://sbv2:5000/voice')) {
        return new Response('sbv2 unavailable', { status: 503 });
      }
      if (href.includes('/audio_query')) {
        return Response.json({ accent_phrases: [] });
      }
      if (href.includes('/synthesis')) {
        return new Response(Buffer.from('voicevox-wav'), {
          status: 200,
          headers: { 'content-type': 'audio/wav' },
        });
      }
      throw new Error(`unexpected fetch ${href}`);
    };

    await withEnv({
      TTS_JA_TYPE: 'style_bert_vits2',
      TTS_JA_SBV2_ENDPOINT: 'http://sbv2:5000',
      TTS_JA_SBV2_MODEL_ID: '3',
      TTS_JA_SBV2_SPEAKER_ID: '4',
      TTS_JA_SBV2_STYLE: 'Neutral',
      TTS_JA_ENDPOINT: 'http://voicevox:50021',
      VOICEVOX_SPEAKER: '8',
    }, async () => {
      const { generateAudioBatch } = loadTtsService();
      const audio = await generateAudioBatch([
        { lang: 'ja', text: '修理をお願いします', filename_suffix: '_ja_1' },
      ], { outputDir, baseName: 'card' });

      assert.deepEqual(audio.errors, []);
      assert.equal(audio.results.length, 1);
      assert.equal(audio.results[0].ttsProvider, 'voicevox');
      assert.equal(audio.results[0].ttsModel, 'voicevox');
      assert.equal(audio.results[0].ttsVoice, 'speaker:8');
      assert.equal(audio.results[0].status, 'fallback_generated');
      assert.equal(fs.readFileSync(audio.results[0].filePath, 'utf8'), 'voicevox-wav');
      assert.ok(calls.some((call) => call.url.includes('http://sbv2:5000/voice')));
      assert.ok(calls.some((call) => call.url.includes('http://voicevox:50021/audio_query')));
    });
  });
});
