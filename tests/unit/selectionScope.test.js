'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

test('selection scopes retain the actual repeated occurrence and exclude ruby/audio text', async () => {
  const { resizeSelectionRange } = await import('../../app/features/card-modal/selection-scope.mjs');
  const { canonicalRangeText } = await import('../../app/features/card-modal/annotation-anchor.mjs');
  const dom = new JSDOM('<div id="root"><h1>ユーザー</h1><p>以前の文。システムにおいて、<span>ユーザー</span>アカウントを<ruby>管理<rt>かんり</rt></ruby>します。<button>再生</button>次の文。</p></div>');
  try {
    const root = dom.window.document.getElementById('root');
    const selected = root.querySelector('span').firstChild;
    const range = dom.window.document.createRange();
    range.selectNodeContents(selected);
    const word = resizeSelectionRange(root, range, 'word');
    assert.equal(word.startContainer, selected);
    assert.equal(canonicalRangeText(word), 'ユーザー');
    assert.equal(canonicalRangeText(resizeSelectionRange(root, range, 'phrase')), 'ユーザーアカウントを管理します');
    assert.equal(canonicalRangeText(resizeSelectionRange(root, range, 'sentence')), 'システムにおいて、ユーザーアカウントを管理します。');
    assert.equal(resizeSelectionRange(root, range, 'unknown'), null);
  } finally { dom.window.close(); }
});

test('selection scopes reject collapsed or detached DOM ranges without throwing', async () => {
  const { resizeSelectionRange } = await import('../../app/features/card-modal/selection-scope.mjs');
  const dom = new JSDOM('<div id="root"><p>ユーザーを管理します。</p></div>');
  try {
    const root = dom.window.document.getElementById('root');
    const range = dom.window.document.createRange();
    range.selectNodeContents(root.querySelector('p').firstChild);
    root.innerHTML = '<p>ユーザーを管理します。</p>';
    assert.equal(resizeSelectionRange(root, range, 'sentence'), null);
    const outside = dom.window.document.createTextNode('別の文');
    range.selectNodeContents(outside);
    assert.equal(resizeSelectionRange(root, range, 'word'), null);
  } finally { dom.window.close(); }
});
