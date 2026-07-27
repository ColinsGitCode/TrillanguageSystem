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
