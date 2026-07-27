'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

test('selection TTS language inference stays conservative', async () => {
  const { inferSelectionTtsLanguage } = await import('../../app/features/card-modal/selection-tts-domain.mjs');
  assert.equal(inferSelectionTtsLanguage('subject matter'), 'en');
  assert.equal(inferSelectionTtsLanguage('発音を確認します'), 'ja');
  assert.equal(inferSelectionTtsLanguage('カタカナ'), 'ja');
  assert.equal(inferSelectionTtsLanguage('昨夜'), null);
  assert.equal(inferSelectionTtsLanguage('English 日本語'), null);
  assert.equal(inferSelectionTtsLanguage('English カタカナ'), 'ja');
  assert.equal(inferSelectionTtsLanguage(''), null);
});

test('selection TTS counts Unicode code points instead of UTF-16 units', async () => {
  const { selectionCodePointLength } = await import('../../app/features/card-modal/selection-tts-domain.mjs');
  assert.equal(selectionCodePointLength('abc'), 3);
  assert.equal(selectionCodePointLength('😀😀'), 2);
  assert.equal(selectionCodePointLength('𠮷野家'), 3);
});
