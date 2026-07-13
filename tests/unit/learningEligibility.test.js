'use strict';

const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { determineEligibility } = require('../../scripts/maintenance/buildLearningEligibilityReport');

describe('learning eligibility recommendation', () => {
  it('keeps unresolved data above every other recommendation', () => {
    assert.deepEqual(determineEligibility({
      unresolvedReasons: ['missing-canonical-markdown'],
      quarantineReasons: ['confirmed-test-artifact'],
      wholeCardReason: 'structure-supports-whole-card-only',
    }), {
      status: 'unresolved',
      reasons: ['missing-canonical-markdown'],
    });
  });

  it('keeps quarantine above whole-card eligibility', () => {
    assert.deepEqual(determineEligibility({
      unresolvedReasons: [],
      quarantineReasons: ['duplicate-of-10'],
      wholeCardReason: 'structure-supports-whole-card-only',
    }), {
      status: 'quarantined',
      reasons: ['duplicate-of-10'],
    });
  });

  it('does not require audio for whole-card or normal eligibility', () => {
    assert.equal(determineEligibility({
      unresolvedReasons: [],
      quarantineReasons: [],
      wholeCardReason: 'structure-supports-whole-card-only',
    }).status, 'whole-card-only');
    assert.equal(determineEligibility({
      unresolvedReasons: [],
      quarantineReasons: [],
      wholeCardReason: null,
    }).status, 'eligible');
  });
});
