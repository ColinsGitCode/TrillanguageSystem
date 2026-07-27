import assert from 'node:assert/strict';
import test from 'node:test';
import { createLegacyAnnotationId } from './migration-identity.mjs';

const sample = {
  highlightId: 10,
  runOrdinal: 2,
  quote: '吹き出し口',
  prefix: '前',
  suffix: '後',
};

test('legacy annotation identity is deterministic and content-addressed', () => {
  const first = createLegacyAnnotationId(sample);
  const replay = createLegacyAnnotationId({ ...sample });

  assert.equal(first, replay);
  assert.match(first, /^ca_legacy_[a-f0-9]{32}$/u);
});

test('legacy annotation identity changes when the logical run changes', () => {
  const baseline = createLegacyAnnotationId(sample);

  assert.notEqual(createLegacyAnnotationId({ ...sample, runOrdinal: 3 }), baseline);
  assert.notEqual(createLegacyAnnotationId({ ...sample, quote: '吹き出し口から' }), baseline);
});
