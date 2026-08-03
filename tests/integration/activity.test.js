'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  api,
  resetState,
  dbService,
  closeServer,
} = require('./_harness');

function textbookManifest() {
  const hash = (value) => value.repeat(64).slice(0, 64);
  return {
    schemaVersion: 'textbook-track-manifest/v1',
    course: { key: 'activity-course', title: 'Activity Course', sourceNotice: 'Synthetic' },
    track: { number: 1, displayOrder: 1, title: 'Morning Track' },
    revision: { number: 1 },
    assets: [{
      assetKey: 'source:01',
      kind: 'source_image',
      ordinal: 1,
      relativePath: 'activity/source.png',
      sha256: hash('a'),
      byteSize: 1,
      mimeType: 'image/png',
    }],
    expressions: [{
      key: 'expr:01',
      ordinal: 1,
      official: {
        en: { text: 'Good morning.', sourceSpan: { assetKey: 'source:01' } },
        ja: { text: 'おはよう。', sourceSpan: { assetKey: 'source:01' } },
      },
      derived: {
        zhCue: '早上好。',
        rubySegments: [{ text: 'おはよう。' }],
        analysis: { phrases: [], grammar: [] },
      },
      confidence: { pairing: 1, en: 1, ja: 1, zhCue: 1, ruby: 1 },
      unitHashes: { en: hash('e'), ja: hash('j') },
    }],
    import: {
      skillName: 'import-textbook-track',
      skillVersion: '1.0.0',
      inputSummary: {},
    },
    integrity: { sourceFingerprint: hash('s'), contentHash: hash('c') },
  };
}

test.describe('/api/activity', () => {
  test.beforeEach(() => resetState());
  test.after(() => closeServer());

  test.it('returns persisted generation activity after the creating request is over', async () => {
    const created = await api('POST', '/api/generation-jobs', {
      body: { phrase: 'server authoritative activity', card_type: 'trilingual' },
    });
    assert.equal(created.status, 200);

    const response = await api('GET', '/api/activity');
    assert.equal(response.status, 200);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.equal(response.body.success, true);
    assert.equal(response.body.items[0].kind, 'generation-job');
    assert.equal(response.body.items[0].id, String(created.body.job.id));
    assert.equal(response.body.items[0].status, 'queued');
    assert.equal(response.body.items[0].href, `/?queue=1&job=${created.body.job.id}`);
    assert.equal(response.body.sources.every((source) => source.status === 'available'), true);
  });

  test.it('returns cross-domain work that requires human attention', async () => {
    const track = dbService.importTextbookDraft({
      manifest: textbookManifest(),
      manifestRelativePath: 'activity/manifest.json',
      manifestHash: 'm'.repeat(64),
    });
    dbService.db.prepare(`
      INSERT INTO kg_resolution_cases(
        case_key, case_kind, language, kp_kind_hint, normalized_input,
        candidates_json, status, revision, created_at_utc, updated_at_utc
      ) VALUES (?, 'ambiguous-surface', 'ja', 'lexeme', 'はし', '[]', 'open', 1, ?, ?)
    `).run('k'.repeat(64), '2026-07-30T12:00:00.000Z', '2026-07-30T12:00:00.000Z');

    const response = await api('GET', '/api/activity');
    assert.equal(response.status, 200);
    const review = response.body.items.find((item) => item.kind === 'textbook-review');
    const resolution = response.body.items.find((item) => item.kind === 'knowledge-resolution');
    assert.equal(review.status, 'needs_attention');
    assert.equal(review.href, `/textbooks?track=${track.id}&stage=review`);
    assert.match(review.summary, /1\/1 条表达仍待人工确认/u);
    assert.equal(resolution.status, 'needs_attention');
    assert.equal(resolution.href, '/knowledge?mode=resolution&case=1');
    assert.equal(response.body.summary.needsAttention, 2);
  });
});
