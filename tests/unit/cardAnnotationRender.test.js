'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { JSDOM } = require('jsdom');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

function moduleUrl(file) {
  return pathToFileURL(path.resolve(__dirname, '..', '..', 'app', 'features', 'card-modal', file)).href;
}

test('renders a ruby-spanning annotation without marking furigana', async () => {
  const anchor = await import(moduleUrl('annotation-anchor.mjs'));
  const renderer = await import(moduleUrl('annotation-render.mjs'));
  const dom = new JSDOM(`
    <div id="root">
      <p><ruby>朝食<rt>ちょうしょく</rt></ruby>にはパンを食べます。</p>
    </div>
  `);
  try {
    const root = dom.window.document.getElementById('root');
    const textNode = root.querySelector('ruby').firstChild;
    const afterRuby = root.querySelector('p').lastChild;
    const range = dom.window.document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(afterRuby, 4);
    const selector = anchor.createAnchor(root, range);

    const diagnostics = renderer.applyAnnotations(root, [{
      id: '018f0f96-5a90-7d75-a2c6-86559b5de951',
      selector,
      annotationKind: 'highlight',
      color: 'red',
      status: 'active',
    }]);

    assert.equal(diagnostics[0].status, 'rendered');
    assert.equal(root.querySelectorAll('mark.study-highlight-red').length, 2);
    assert.equal(root.querySelector('rt mark'), null);
    assert.equal(root.querySelector('rt').textContent, 'ちょうしょく');
    assert.equal(
      root.querySelectorAll('[data-annotation-id="018f0f96-5a90-7d75-a2c6-86559b5de951"]').length,
      2
    );
  } finally {
    dom.window.close();
  }
});

test('keeps unresolved annotations out of rendered content', async () => {
  const renderer = await import(moduleUrl('annotation-render.mjs'));
  const dom = new JSDOM('<div id="root"><p>current text</p></div>');
  try {
    const root = dom.window.document.getElementById('root');
    const diagnostics = renderer.applyAnnotations(root, [{
      id: '018f0f96-5a90-7d75-a2c6-86559b5de952',
      selector: {
        projectionVersion: 'card-visible-text-v1',
        textQuote: {
          type: 'TextQuoteSelector',
          exact: 'old text',
          prefix: '',
          suffix: '',
        },
        textPosition: {
          type: 'TextPositionSelector',
          start: 0,
          end: 8,
        },
      },
      annotationKind: 'highlight',
      color: 'red',
      status: 'active',
    }]);

    assert.equal(diagnostics[0].status, 'orphaned');
    assert.equal(root.querySelector('mark'), null);
  } finally {
    dom.window.close();
  }
});
