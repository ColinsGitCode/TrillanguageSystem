'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { assertDecisionHash, canonicalHash } = require('../../scripts/maintenance/applyDataPreparationDecisions');
const { contentHash } = require('../../services/dataPreparation/rules');

test.describe('data preparation decision guards', () => {
  test.it('uses canonical Markdown when a legacy row has no stored hash', () => {
    assert.equal(canonicalHash({ content_hash: null, markdown_content: '# card' }), contentHash('# card'));
  });

  test.it('rejects stale decisions and accepts an explicit repaired hash', () => {
    const record = { content_hash: 'after', markdown_content: '# card' };
    assert.doesNotThrow(() => assertDecisionHash(record, 'before', 'repair', 'after'));
    assert.throws(() => assertDecisionHash(record, 'before', 'repair'), /stale/);
  });
});
