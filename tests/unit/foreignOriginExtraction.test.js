'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const {
  REJECTION,
  buildProposalKey,
  evaluateExtraction,
  katakanaCandidates,
} = require('../../services/languageMetadata/domain/foreignOriginExtraction');

const fixture = JSON.parse(fs.readFileSync(
  path.join(__dirname, '../fixtures/jlm-p0-foreign-origin-fixtures.json'),
  'utf8'
));

const { segments, context } = fixture;
const caseById = (id) => fixture.cases.find((entry) => entry.id === id);
const run = (id) => evaluateExtraction(caseById(id).payload, { ...context, segments });

test.describe('JLM-P0 fixture integrity', () => {
  test.it('declares codepoint spans that match the segment text', () => {
    for (const segment of segments) {
      assert.equal(
        segment.endCodePoint - segment.startCodePoint,
        Array.from(segment.text).length,
        `segment span must match its text: ${segment.text}`
      );
    }
  });

  test.it('covers every rejection reason the contract defines', () => {
    // ITEMS_OVERFLOW needs more items than a readable fixture should carry, so
    // it is generated in its own test below rather than stored as data.
    const coveredOutsideFixture = new Set([REJECTION.ITEMS_OVERFLOW]);
    const expected = new Set(Object.values(REJECTION));
    const covered = new Set([
      ...fixture.cases.map((entry) => entry.expect).filter((value) => value !== 'accepted'),
      ...coveredOutsideFixture,
    ]);
    const missing = [...expected].filter((reason) => !covered.has(reason));
    assert.deepEqual(missing, [], `no case covers: ${missing.join(', ')}`);
  });
});

test.describe('JLM-P0 server-side relocation', () => {
  test.it('locates each surface and owns the resulting codepoint range', () => {
    const { accepted, rejected } = run('accept-basic');
    assert.deepEqual(rejected, []);
    assert.equal(accepted.length, 3);

    // データ starts segment 1, so it inherits that segment's offset exactly.
    const data = accepted.find((item) => item.surface === 'データ');
    assert.equal(data.startCodePoint, 0);
    assert.equal(data.endCodePoint, 3);
    assert.deepEqual(data.value, { originTerm: 'data', originLanguage: 'en' });
    assert.equal(data.status, 'pending', 'LLM output must never arrive pre-accepted');

    // リフレッシュ follows "データを" (4 codepoints) in the same segment.
    const refresh = accepted.find((item) => item.surface === 'リフレッシュ');
    assert.equal(refresh.startCodePoint, 4);
    assert.equal(refresh.endCodePoint, 10);

    // Segment 2 offsets must be absolute, not segment-relative.
    const feedback = accepted.find((item) => item.surface === 'フィードバック');
    assert.equal(feedback.startCodePoint, segments[1].startCodePoint + 7);
  });

  test.it('resolves the requested occurrence rather than the first match', () => {
    const { accepted } = run('accept-second-occurrence');
    assert.equal(accepted.length, 1);
    const [project] = accepted;
    // プロジェクト occurs at segment-relative 0 and 15; occurrence 2 is the later one.
    assert.equal(project.startCodePoint, segments[1].startCodePoint + 15);
    assert.equal(project.occurrence, 2);
  });

  test.it('collapses an identical repeat instead of reporting a conflict', () => {
    const { accepted, rejected } = run('accept-duplicate-collapses');
    assert.deepEqual(rejected, []);
    assert.equal(accepted.length, 1);
    assert.equal(accepted[0].value.originTerm, 'data');
  });
});

test.describe('JLM-P0 rejection branches', () => {
  for (const testCase of fixture.cases.filter((entry) => entry.expect !== 'accepted')) {
    test.it(`${testCase.id} is rejected as ${testCase.expect}`, () => {
      const { accepted, rejected } = run(testCase.id);
      assert.equal(accepted.length, 0, 'a rejected case must produce no proposal');
      assert.ok(rejected.length > 0);
      assert.ok(
        rejected.every((entry) => entry.reason === testCase.expect),
        `expected every rejection to be ${testCase.expect}, got ${[...new Set(rejected.map((r) => r.reason))].join(', ')}`
      );
    });
  }

  test.it('rejects both sides of a conflict rather than choosing one', () => {
    const { rejected } = run('reject-conflicting');
    assert.equal(rejected.length, 2);
  });

  test.it('rejects an oversized item list before locating anything', () => {
    const items = Array.from({ length: 65 }, () => ({
      segment_index: 1, surface: 'データ', occurrence: 1, origin_term: 'data', origin_language: 'en', confidence: 'high',
    }));
    const { accepted, rejected } = evaluateExtraction(
      { schema_version: 'jlm-foreign-origin-v1', items },
      { ...context, segments }
    );
    assert.equal(accepted.length, 0);
    assert.equal(rejected[0].reason, REJECTION.ITEMS_OVERFLOW);
  });

  test.it('never throws on arbitrary model output', () => {
    // §7 requires provider noise to stay distinguishable from "no loanwords",
    // which means unusable output must return a reason, not raise.
    for (const payload of [null, undefined, 42, 'text', [], { items: null }, { schema_version: 1 }]) {
      const result = evaluateExtraction(payload, { ...context, segments });
      assert.equal(result.accepted.length, 0);
      assert.ok(result.rejected.length > 0);
    }
  });
});

test.describe('JLM-P0 proposal key', () => {
  test.it('is stable for the same position and content version', () => {
    const first = run('accept-basic').accepted.map((item) => item.proposalKey);
    const second = run('accept-basic').accepted.map((item) => item.proposalKey);
    assert.deepEqual(first, second);
    assert.equal(new Set(first).size, first.length, 'distinct positions must not collide');
  });

  test.it('is NUL-separated, not space-separated', () => {
    // The separator is invisible in source and was once mis-transcribed as a
    // space in the JLM-D2 ADR. NUL cannot occur inside any field, so it is the
    // only separator that cannot produce an ambiguous key.
    const fields = {
      targetKind: 'generation',
      targetId: 9001,
      sourceContentHash: 'a'.repeat(64),
      metadataKind: 'foreign-origin',
      startCodePoint: 0,
      endCodePoint: 3,
      extractionVersion: 'jlm-extract-v1',
    };
    const join = (separator) => crypto.createHash('sha256').update([
      fields.targetKind, fields.targetId, fields.sourceContentHash, fields.metadataKind,
      fields.startCodePoint, fields.endCodePoint, fields.extractionVersion,
    ].join(separator)).digest('hex');
    assert.equal(buildProposalKey(fields), join(String.fromCharCode(0)));
    assert.notEqual(buildProposalKey(fields), join(' '));
  });

  test.it('cannot be forged by moving a separator into a field value', () => {
    // A space separator would let "generation 9001" collide with a crafted
    // targetKind; NUL makes that impossible.
    const base = {
      targetKind: 'generation',
      targetId: 9001,
      sourceContentHash: 'a'.repeat(64),
      startCodePoint: 0,
      endCodePoint: 3,
      extractionVersion: 'v1',
    };
    const shifted = { ...base, targetKind: 'generation 9001', targetId: '' };
    assert.notEqual(buildProposalKey(base), buildProposalKey(shifted));
  });

  test.it('changes when the body version changes, so candidates cannot carry over', () => {
    const base = { targetKind: 'generation', targetId: 1, startCodePoint: 0, endCodePoint: 3, extractionVersion: 'v1' };
    const before = buildProposalKey({ ...base, sourceContentHash: 'a'.repeat(64) });
    const after = buildProposalKey({ ...base, sourceContentHash: 'b'.repeat(64) });
    assert.notEqual(before, after);
  });
});

test.describe('JLM-P0 candidate enumeration', () => {
  test.it('lists the katakana words actually present, excluding separators', () => {
    const candidates = katakanaCandidates(segments);
    const surfaces = candidates.map((item) => item.surface);
    assert.ok(surfaces.includes('データ'));
    assert.ok(surfaces.includes('スケジュール'));
    assert.ok(!surfaces.includes('・'));
    // プロジェクト appears twice and must be enumerated as two occurrences.
    const projects = candidates.filter((item) => item.surface === 'プロジェクト');
    assert.deepEqual(projects.map((item) => item.occurrence), [1, 2]);
  });
});
