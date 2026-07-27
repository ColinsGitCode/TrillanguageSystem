import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import {
  PROJECTION_VERSION,
  canonicalRangeText,
  createAnchor,
  resolveAnchor,
} from './anchor-contract.mjs';

function createDom(html) {
  return new JSDOM(`<main id="card">${html}</main>`);
}

function textNode(element, contains) {
  const walker = element.ownerDocument.createTreeWalker(element, element.ownerDocument.defaultView.NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    if (node.nodeValue?.includes(contains)) return node;
    node = walker.nextNode();
  }
  throw new Error(`Missing text node containing ${contains}`);
}

function selectText(root, startNeedle, startOffset, endNeedle, endOffset) {
  const range = root.ownerDocument.createRange();
  range.setStart(textNode(root, startNeedle), startOffset);
  range.setEnd(textNode(root, endNeedle), endOffset);
  return range;
}

test('repeated quote resolves with prefix and suffix instead of guessing', () => {
  const dom = createDom('<p>We take care now.</p><p>Please take care later.</p>');
  const root = dom.window.document.getElementById('card');
  const range = selectText(root, 'Please take care later.', 7, 'Please take care later.', 16);
  const anchor = createAnchor(root, range);
  const resolved = resolveAnchor(root, anchor);

  assert.equal(anchor.projectionVersion, PROJECTION_VERSION);
  assert.equal(anchor.textQuote.exact, 'take care');
  assert.equal(resolved.status, 'quote-context');
  assert.equal(canonicalRangeText(resolved.range), 'take care');
  dom.window.close();
});

test('ruby reading is excluded while restored Range still spans base text and okurigana', () => {
  const dom = createDom('<p><ruby>食<rt>た</rt></ruby>べる。</p>');
  const root = dom.window.document.getElementById('card');
  const range = selectText(root, '食', 0, 'べる。', 2);
  const anchor = createAnchor(root, range);
  const resolved = resolveAnchor(root, anchor);

  assert.equal(anchor.textQuote.exact, '食べる');
  assert.equal(resolved.status, 'quote-unique');
  assert.equal(canonicalRangeText(resolved.range), '食べる');
  assert.match(resolved.range.cloneContents().textContent, /食たべる/u);
  dom.window.close();
});

test('selection crossing DOM nodes round-trips through canonical offsets', () => {
  const dom = createDom('<p>I need <strong>a short</strong> burst of help.</p>');
  const root = dom.window.document.getElementById('card');
  const range = selectText(root, 'a short', 0, ' burst of help.', 6);
  const anchor = createAnchor(root, range);
  const resolved = resolveAnchor(root, anchor);

  assert.equal(anchor.textQuote.exact, 'a short burst');
  assert.equal(canonicalRangeText(resolved.range), 'a short burst');
  dom.window.close();
});

test('quote selector survives an unrelated content revision that shifts positions', () => {
  const original = createDom('<p>Before: check the seal.</p>');
  const originalRoot = original.window.document.getElementById('card');
  const range = selectText(originalRoot, 'Before: check the seal.', 8, 'Before: check the seal.', 22);
  const anchor = createAnchor(originalRoot, range);
  const oldStart = anchor.textPosition.start;

  const revised = createDom('<p>New introduction.</p><p>Before: check the seal.</p>');
  const revisedRoot = revised.window.document.getElementById('card');
  const resolved = resolveAnchor(revisedRoot, anchor);

  assert.equal(anchor.textQuote.exact, 'check the seal');
  assert.notEqual(resolved.start, oldStart);
  assert.equal(resolved.status, 'quote-unique');
  assert.equal(canonicalRangeText(resolved.range), 'check the seal');
  original.window.close();
  revised.window.close();
});

test('file move does not alter an entity-bound anchor', () => {
  const dom = createDom('<p>Move-safe annotation.</p>');
  const root = dom.window.document.getElementById('card');
  const range = selectText(root, 'Move-safe annotation.', 0, 'Move-safe annotation.', 9);
  const annotation = {
    target: { kind: 'generation', id: 42, legacyLocator: { folder: '2026.07', base: 'old-name' } },
    anchor: createAnchor(root, range),
  };
  annotation.target.legacyLocator = { folder: '2026.08', base: 'new-name' };

  assert.deepEqual(annotation.target, {
    kind: 'generation',
    id: 42,
    legacyLocator: { folder: '2026.08', base: 'new-name' },
  });
  assert.equal(canonicalRangeText(resolveAnchor(root, annotation.anchor).range), 'Move-safe');
  dom.window.close();
});

test('changed target text becomes orphaned instead of attaching to nearby content', () => {
  const original = createDom('<p>Seal the pipe before testing.</p>');
  const root = original.window.document.getElementById('card');
  const range = selectText(root, 'Seal the pipe before testing.', 0, 'Seal the pipe before testing.', 13);
  const anchor = createAnchor(root, range);
  const changed = createDom('<p>Inspect the pipe before testing.</p>');

  assert.equal(resolveAnchor(changed.window.document.getElementById('card'), anchor).status, 'orphaned');
  original.window.close();
  changed.window.close();
});

test('TextPositionSelector uses UTF-16 offsets for supplementary characters', () => {
  const dom = new JSDOM('<div id="card">A😀食べるB</div>');
  const root = dom.window.document.getElementById('card');
  const text = root.firstChild;
  const range = dom.window.document.createRange();
  range.setStart(text, 1);
  range.setEnd(text, 6);

  const selector = createAnchor(root, range);
  assert.deepEqual(selector.textPosition, {
    type: 'TextPositionSelector',
    start: 1,
    end: 6,
  });
  assert.equal(selector.textQuote.exact, '😀食べる');

  const resolved = resolveAnchor(root, selector);
  assert.equal(resolved.status, 'quote-unique');
  assert.equal(canonicalRangeText(resolved.range), '😀食べる');
  dom.window.close();
});
