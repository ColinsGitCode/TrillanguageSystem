'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const MODULE = '../../app/features/card-modal/reading-layer.mjs';

test('words with kanji show their reading above them', async () => {
  const { showsReadingAbove } = await import(MODULE);
  assert.equal(showsReadingAbove('大丈夫', 'だいじょうぶ'), true);
  assert.equal(showsReadingAbove('使い回せ', 'つかいまわせ'), true);
  assert.equal(showsReadingAbove('人々', 'ひとびと'), true);
});

test('kana words show nothing: they already are their reading', async () => {
  const { showsReadingAbove } = await import(MODULE);
  // Seen on older cards, whose inline ruby covered katakana too.
  assert.equal(showsReadingAbove('アイデア', 'あいであ'), false);
  assert.equal(showsReadingAbove('プレゼン', 'ぷれぜん'), false);
  assert.equal(showsReadingAbove('ニュアンス', 'にゅあんす'), false);
  assert.equal(showsReadingAbove('たら', 'たら'), false);
});

test('a word without a known reading shows nothing', async () => {
  const { showsReadingAbove } = await import(MODULE);
  assert.equal(showsReadingAbove('会議', ''), false);
  assert.equal(showsReadingAbove('会議', null), false);
});
