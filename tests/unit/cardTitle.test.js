'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const MODULE = '../../app/features/card-modal/card-title.mjs';

test('card title strips ruby markup instead of rendering the raw tags', async () => {
  const { extractCardTitle } = await import(MODULE);
  const markdown = '# <ruby>鼻水<rt>はなみず</rt></ruby>の<ruby>症状<rt>しょうじょう</rt></ruby>があります\n\n## 1. 英文:';

  const title = extractCardTitle(markdown, 'fallback');

  assert.equal(title, '鼻水の症状があります');
  assert.equal(title.includes('<ruby>'), false, 'no literal markup');
  assert.equal(title.includes('はなみず'), false, 'reading is not spliced into the title');
});

test('card title keeps plain headings and falls back when absent', async () => {
  const { extractCardTitle } = await import(MODULE);

  assert.equal(extractCardTitle('# primitive\n\n## 1. 英文:', 'fallback'), 'primitive');
  assert.equal(extractCardTitle('## 1. 英文:', 'fallback'), 'fallback');
  assert.equal(extractCardTitle('', 'fallback'), 'fallback');
  // A heading that is only markup must not collapse into an empty header.
  assert.equal(extractCardTitle('# <rt>かな</rt>', 'fallback'), 'fallback');
});
