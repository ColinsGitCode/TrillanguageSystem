'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { classify } = require('../../scripts/maintenance/auditPronunciationMigrationEligibility');

const base = {
  id: 1, content_hash: 'a'.repeat(64), phrase: 'sample', card_type: 'trilingual',
  folder_name: '20260803', base_filename: 'sample', llm_model: 'deepseek-v4-pro',
  created_at: '2026-08-03T00:00:00.000Z',
};

test('marks titled current content eligible', () => {
  assert.equal(classify({ ...base, markdown_content: '# sample\n\n本文' }).status, 'eligible');
});

test('marks missing-title and tool residue for manual review', () => {
  const result = classify({ ...base, llm_model: 'gemini-2.5-flash', markdown_content: '我将使用 google_web_search' });
  assert.equal(result.status, 'needs-review');
  assert.deepEqual(result.reasons, ['missing-title', 'model-planning-or-tool-residue']);
  assert.equal(result.hasToolResidue, true);
});
