'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { JSDOM } = require('jsdom');

test('card annotation anchors use DOM-compatible UTF-16 offsets', async () => {
  const { createAnchor, resolveAnchor } = await import(
    '../../app/features/card-modal/annotation-anchor.mjs'
  );
  const dom = new JSDOM('<div id="root"><p>A😀B <ruby>食<rt>た</rt></ruby>べる</p></div>');
  try {
    const root = dom.window.document.getElementById('root');
    const textNode = root.querySelector('p').firstChild;
    const range = dom.window.document.createRange();
    range.setStart(textNode, 1);
    range.setEnd(textNode, 3);

    const anchor = createAnchor(root, range);
    assert.equal(anchor.textQuote.exact, '😀');
    assert.deepEqual(anchor.textPosition, {
      type: 'TextPositionSelector',
      start: 1,
      end: 3,
    });

    const resolved = resolveAnchor(root, anchor);
    assert.ok(resolved.range);
    assert.equal(resolved.range.toString(), '😀');
  } finally {
    dom.window.close();
  }
});

test('legacy loanword blocks do not change anchors used by A2 cards', async () => {
  const { createAnchor, resolveAnchor } = await import(
    '../../app/features/card-modal/annotation-anchor.mjs'
  );
  const dom = new JSDOM('<div></div>');
  try {
    function buildRoot(withLegacyBlock) {
      const root = dom.window.document.createElement('div');
      root.innerHTML = `<p>スケジュールを確認します。</p>${withLegacyBlock
        ? '<div class="loanword-block">schedule → スケジュール</div>'
        : ''}`;
      return root;
    }

    function selectSchedule(root) {
      const textNode = root.querySelector('p').firstChild;
      const range = dom.window.document.createRange();
      range.setStart(textNode, 0);
      range.setEnd(textNode, 'スケジュール'.length);
      return range;
    }

    const legacyRoot = buildRoot(true);
    const a2Root = buildRoot(false);
    const legacyAnchor = createAnchor(legacyRoot, selectSchedule(legacyRoot));
    const a2Anchor = createAnchor(a2Root, selectSchedule(a2Root));

    assert.deepEqual(legacyAnchor, a2Anchor);
    assert.equal(resolveAnchor(a2Root, legacyAnchor).range.toString(), 'スケジュール');
    assert.equal(resolveAnchor(legacyRoot, a2Anchor).range.toString(), 'スケジュール');
  } finally {
    dom.window.close();
  }
});
