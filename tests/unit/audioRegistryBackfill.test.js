'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  applyReferenceRepair,
  extractAudioSources,
  parseAudioIdentity,
} = require('../../scripts/maintenance/backfillAudioRegistry');

test.describe('historical audio registry helpers', () => {
  test.it('extracts audio sources and parses only canonical language suffixes', () => {
    assert.deepEqual(extractAudioSources('<audio controls src="card_en_1.mp3"></audio>'), ['card_en_1.mp3']);
    assert.deepEqual(parseAudioIdentity('card', '/tmp/card_ja_12.wav'), { suffix: '_ja_12', language: 'ja', format: 'wav' });
    assert.equal(parseAudioIdentity('card', '/tmp/other.wav'), null);
  });

  test.it('repairs a ruby-corrupted src without changing sentence content', () => {
    const record = { id: 1, markdown_content: 'text <audio src="<ruby>哈</ruby>_ja_1.wav"></audio>' };
    const markdown = applyReferenceRepair(record, {
      replacements: [{ from: '<ruby>哈</ruby>_ja_1.wav', to: '哈希_ja_1.wav' }],
    });
    assert.equal(markdown, 'text <audio src="哈希_ja_1.wav"></audio>');
  });
});
