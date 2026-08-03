'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { assertPlainJapaneseContent } = require('../../scripts/tests/pronunciationArchitecture');

test('plain-content contract accepts natural Japanese and rejects Ruby or inline readings', () => {
  assert.doesNotThrow(() => assertPlainJapaneseContent('勤務表を確認します。'));
  assert.throws(() => assertPlainJapaneseContent('<ruby>勤務表<rt>きんむひょう</rt></ruby>'), /Ruby markup/u);
  assert.throws(() => assertPlainJapaneseContent('勤務表（きんむひょう）'), /inline Japanese readings/u);
});
