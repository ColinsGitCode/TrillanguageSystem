'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SELECTION_TTS_ENABLED = '0';
const { api, closeServer } = require('./_harness');

test.after(closeServer);

test('selection TTS advertises disabled state and rejects synthesis', async () => {
  const config = await api('GET', '/api/tts/selection');
  assert.equal(config.status, 200);
  assert.equal(config.body.enabled, false);

  const response = await api('POST', '/api/tts/selection', {
    body: { text: 'hello', language: 'en', speed: 1 },
  });
  assert.equal(response.status, 404);
  assert.equal(response.body.code, 'SELECTION_TTS_DISABLED');
});
