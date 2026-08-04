'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { buildReviewBatches } = require('../../scripts/maintenance/buildPronunciationCompoundReviewBatches');

function candidate(index, occurrenceCount = 1) {
  return {
    surface: `候选${index}`,
    reading: `こうほ${index}`,
    components: [{ surface: `候${index}`, reading: 'こう' }, { surface: `选${index}`, reading: 'せん' }],
    occurrenceCount,
    eligibleOccurrenceCount: occurrenceCount,
    generationIds: [index],
    needsReviewGenerationIds: [],
    cardTypes: ['trilingual'],
  };
}

test('builds deterministic unreviewed batches without accepting analyzer output', () => {
  const manifest = {
    schemaVersion: 'pronunciation-compound-candidates/v1',
    manifestHash: 'candidate-manifest-hash',
    candidates: [candidate(1, 3), candidate(2, 2), candidate(3, 1)],
  };
  const result = buildReviewBatches(manifest, { batchSize: 2, minutesPerCandidate: 2 });
  assert.equal(result.counts.distinctCandidates, 3);
  assert.equal(result.counts.batches, 2);
  assert.equal(result.counts.estimatedReviewMinutes, 6);
  assert.equal(result.source.candidateManifestHash, 'candidate-manifest-hash');
  assert.equal(result.batches[0].batchId, 'compound-review-001');
  assert.equal(result.batches[1].candidateCount, 1);
  assert.equal(result.batches[0].candidates[0].review.status, 'unreviewed');
  assert.equal(result.batches[0].candidates[0].review.acceptedSource, null);
  assert.match(result.batches[0].candidates[0].candidateId, /^compound:[a-f0-9]{16}$/u);
});
