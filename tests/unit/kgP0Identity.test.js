'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  buildKnowledgePointIdentity,
  buildSurfaceIdentity,
  katakanaToHiragana,
  stableJson,
} = require('../../services/kg/domain/knowledgeIdentity');
const { buildEvidenceLinkCandidate } = require('../../services/kg/domain/knowledgeEvidence');

test.describe('KG-P0 identity and deterministic evidence', () => {
  test.it('builds stable English normalized identities', () => {
    const first = buildKnowledgePointIdentity({
      kpKind: 'phrase', language: 'en', canonicalForm: '  HandOff   Validation ',
    });
    const second = buildKnowledgePointIdentity({
      kpKind: 'phrase', language: 'en', canonicalForm: 'handoff validation',
    });
    assert.equal(first.canonicalForm, 'handoff validation');
    assert.equal(first.pointKey, second.pointKey);
    assert.match(first.pointKey, /^[a-f0-9]{64}$/u);
  });

  test.it('keeps Japanese homophones separate by canonical form', () => {
    const chopsticks = buildKnowledgePointIdentity({
      kpKind: 'lexeme', language: 'ja', canonicalForm: '箸', canonicalReading: 'ハシ',
    });
    const bridge = buildKnowledgePointIdentity({
      kpKind: 'lexeme', language: 'ja', canonicalForm: '橋', canonicalReading: 'はし',
    });
    assert.equal(chopsticks.canonicalReading, 'はし');
    assert.equal(bridge.canonicalReading, 'はし');
    assert.notEqual(chopsticks.pointKey, bridge.pointKey);
  });

  test.it('normalizes Japanese readings and stable JSON deterministically', () => {
    assert.equal(katakanaToHiragana('タベル'), 'たべる');
    assert.equal(stableJson({ z: 1, a: { d: 2, b: 3 } }), '{"a":{"b":3,"d":2},"z":1}');
  });

  test.it('builds deterministic evidence-of candidates without a database write', () => {
    const point = buildKnowledgePointIdentity({
      kpKind: 'lexeme', language: 'ja', canonicalForm: '食べる', canonicalReading: 'たべる',
    });
    const candidate = buildEvidenceLinkCandidate({
      pointKey: point.pointKey,
      sourceKind: 'study_item',
      sourceRefId: 42,
      sourceRevision: 1,
      sourceContentHash: 'a'.repeat(64),
      language: 'ja',
      sourceText: '食べます',
      locator: { unitKey: 'trilingual_ja' },
    });
    assert.equal(candidate.status, 'accepted');
    assert.equal(candidate.linkKind, 'evidence-of');
    assert.equal(candidate.strength, 'strong');
    assert.match(candidate.evidence.evidenceKey, /^[a-f0-9]{64}$/u);
  });

  test.it('rejects malformed evidence hashes', () => {
    assert.throws(() => buildEvidenceLinkCandidate({
      pointKey: 'bad',
      sourceKind: 'study_item',
      sourceRefId: 1,
      sourceContentHash: 'a'.repeat(64),
      language: 'ja',
      sourceText: '食べる',
    }), /pointKey must be a SHA-256/u);
  });

  test.it('creates stable surface identities', () => {
    const first = buildSurfaceIdentity({ language: 'ja', surfaceText: '食べた', reading: 'タベタ' });
    const second = buildSurfaceIdentity({ language: 'ja', surfaceText: '食べた', reading: 'たべた' });
    assert.equal(first.surfaceKey, second.surfaceKey);
  });
});
