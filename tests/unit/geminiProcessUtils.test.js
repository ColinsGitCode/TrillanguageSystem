'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { stripFence, collectDescendantPids, signalProcessTree } = require('../../services/geminiProcessUtils');

test.describe('geminiProcessUtils.stripFence', () => {
  test.it('returns empty string for falsy input', () => {
    assert.equal(stripFence(''), '');
    assert.equal(stripFence(null), '');
    assert.equal(stripFence(undefined), '');
  });

  test.it('trims plain text untouched', () => {
    assert.equal(stripFence('  hello world  '), 'hello world');
  });

  test.it('strips a language-tagged fence', () => {
    assert.equal(stripFence('```json\n{"a":1}\n```'), '{"a":1}');
  });

  test.it('strips a bare fence', () => {
    assert.equal(stripFence('```\nplain content\n```'), 'plain content');
  });

  test.it('strips a fence without a trailing newline before the close', () => {
    assert.equal(stripFence('```md\ncontent```'), 'content');
  });

  test.it('leaves inline backticks that are not a leading fence alone', () => {
    assert.equal(stripFence('use `code` here'), 'use `code` here');
  });
});

test.describe('geminiProcessUtils.collectDescendantPids', () => {
  test.it('returns [] for invalid pids', () => {
    assert.deepEqual(collectDescendantPids('not-a-number'), []);
    assert.deepEqual(collectDescendantPids(0), []);
    assert.deepEqual(collectDescendantPids(-1), []);
  });
});

test.describe('geminiProcessUtils.signalProcessTree', () => {
  test.it('returns 0 when there is no process to signal', () => {
    assert.equal(signalProcessTree(null), 0);
    assert.equal(signalProcessTree(undefined), 0);
    assert.equal(signalProcessTree({}), 0);
  });
});
