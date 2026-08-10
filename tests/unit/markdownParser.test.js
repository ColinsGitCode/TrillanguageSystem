'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { parseTrilingualMarkdown } = require('../../services/generation/markdownParser');

test('parses both three-language and legacy loanword tags', () => {
  const parsed = parseTrilingualMarkdown([
    '# sample',
    '## 2. 日本語:',
    '- **例句1**: データを確認します。',
    '  - 请确认数据。',
    '  <span class="loanword-tag">数据 · data · データ</span>',
    '- **例句2**: ファイルを開きます。',
    '  - 打开文件。',
    '  <span class="loanword-tag">file → ファイル</span>',
  ].join('\n'));

  assert.deepEqual(parsed.sections.ja.examples[0].loanwords, [{ zh: '数据', en: 'data', ja: 'データ' }]);
  assert.deepEqual(parsed.sections.ja.examples[1].loanwords, [{ en: 'file', ja: 'ファイル' }]);
});

test('parses A2 cards without creating empty loanword shells', () => {
  const parsed = parseTrilingualMarkdown([
    '# sample',
    '## 2. 日本語:',
    '- **例句1**: データを確認します。',
    '  - 请确认数据。',
    '- **例句2**: ファイルを開きます。',
    '  - 打开文件。',
  ].join('\n'));

  assert.equal(parsed.sections.ja.examples.length, 2);
  assert.deepEqual(parsed.sections.ja.examples.map((example) => example.loanwords), [[], []]);
});
