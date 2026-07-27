import assert from 'node:assert/strict';
import test from 'node:test';
import createDOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';
import {
  rangeToSelector,
  splitAnnotatableRanges,
} from '@recogito/text-annotator';

function installDomGlobals(window) {
  const previous = {};
  for (const key of ['document', 'HTMLElement', 'Node', 'NodeFilter']) {
    previous[key] = globalThis[key];
    globalThis[key] = window[key];
  }
  return () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  };
}

test('Recogito must be wrapped because its native selector includes ruby readings', () => {
  const dom = new JSDOM('<div id="card"><ruby>食<rt>た</rt></ruby>べる</div>');
  const restore = installDomGlobals(dom.window);
  const root = dom.window.document.getElementById('card');
  const range = dom.window.document.createRange();
  range.selectNodeContents(root);

  const selector = rangeToSelector(range, root);
  assert.deepEqual(
    { quote: selector.quote, start: selector.start, end: selector.end },
    { quote: '食たべる', start: 0, end: 4 }
  );
  restore();
  dom.window.close();
});

test('DOMPurify plus not-annotatable ruby yields canonical split ranges without mutating content', () => {
  const dom = new JSDOM('');
  const DOMPurify = createDOMPurify(dom.window);
  const safe = DOMPurify.sanitize(
    '<p><ruby>食<rt class="not-annotatable">た</rt></ruby>べる'
      + '<button class="audio-btn not-annotatable">play</button></p>',
    { ADD_TAGS: ['ruby', 'rt'], ADD_ATTR: ['class'] }
  );
  dom.window.document.body.innerHTML = `<div id="card">${safe}</div>`;
  const restore = installDomGlobals(dom.window);
  const root = dom.window.document.getElementById('card');
  const baseline = root.innerHTML;
  const range = dom.window.document.createRange();
  range.selectNodeContents(root);
  const rawSelectors = splitAnnotatableRanges(root, range).map((part) => rangeToSelector(part, root));
  const selectors = rawSelectors.filter((selector) => selector.quote);

  assert.equal(rawSelectors.length, 3, 'excluded audio produces an empty range that the wrapper must discard');
  assert.deepEqual(
    selectors.map(({ quote, start, end }) => ({ quote, start, end })),
    [
      { quote: '食', start: 0, end: 1 },
      { quote: 'べる', start: 1, end: 3 },
    ]
  );
  assert.equal(root.innerHTML, baseline);
  assert.equal(root.querySelector('ruby')?.textContent, '食た');
  assert.equal(root.querySelector('rt')?.className, 'not-annotatable');
  restore();
  dom.window.close();
});
