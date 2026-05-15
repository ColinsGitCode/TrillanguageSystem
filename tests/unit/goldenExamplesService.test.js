'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { _internal: I } = require('../../services/goldenExamplesService');

test.describe('goldenExamplesService.bigramSimilarity', () => {
  test.it('returns 0 for empty input on either side', () => {
    assert.equal(I.bigramSimilarity('', 'abc'), 0);
    assert.equal(I.bigramSimilarity('abc', ''), 0);
    assert.equal(I.bigramSimilarity(null, undefined), 0);
  });

  test.it('returns 1 for identical strings (case + whitespace insensitive)', () => {
    assert.equal(I.bigramSimilarity('hello', 'HELLO'), 1);
    assert.equal(I.bigramSimilarity('  hello  ', 'hello'), 1);
  });

  test.it('scores near-identical strings highly and unrelated strings near zero', () => {
    const high = I.bigramSimilarity('hello world', 'hello worlds');
    const low = I.bigramSimilarity('hello world', 'unrelated text');
    assert.ok(high > 0.7, `expected > 0.7, got ${high}`);
    assert.ok(low < 0.3, `expected < 0.3, got ${low}`);
    assert.ok(high > low);
  });

  test.it('works on Chinese/Japanese (no tokenization dependency)', () => {
    const s = I.bigramSimilarity('持久化高亮', '持久化高亮');
    assert.equal(s, 1);
    const partial = I.bigramSimilarity('持久化', '持续');
    assert.ok(partial >= 0 && partial < 1);
  });

  test.it('returns 0 when both strings are too short for any bigram', () => {
    // Single chars produce no bigrams (length - 1 = 0 iterations).
    assert.equal(I.bigramSimilarity('a', 'b'), 0);
  });
});

test.describe('goldenExamplesService.clipText', () => {
  test.it('returns empty string for falsy input', () => {
    assert.equal(I.clipText(''), '');
    assert.equal(I.clipText(null), '');
    assert.equal(I.clipText(undefined), '');
  });

  test.it('returns the original text when under the cap', () => {
    assert.equal(I.clipText('short', 100), 'short');
  });

  test.it('truncates and appends ... when over the cap', () => {
    const result = I.clipText('a'.repeat(500), 200);
    assert.ok(result.endsWith('...'));
    assert.ok(result.length <= 200);
  });

  test.it('enforces a minimum payload size before adding ellipsis', () => {
    // Even with a tiny cap, leaves at least 120 chars of content.
    const result = I.clipText('a'.repeat(500), 10);
    assert.ok(result.length >= 120);
    assert.ok(result.endsWith('...'));
  });
});
