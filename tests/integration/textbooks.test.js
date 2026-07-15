'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const textbookSourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'textbook-source-'));
process.env.TEXTBOOK_FEATURE_ENABLED = '1';
process.env.TEXTBOOK_SOURCE_ROOT = textbookSourceRoot;

const {
  api,
  resetState,
  dbService,
  getBaseUrl,
  closeServer,
} = require('./_harness');

test.after(async () => {
  await closeServer();
  fs.rmSync(textbookSourceRoot, { recursive: true, force: true });
});

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function createManifestFixture({ audioBytes = Buffer.from('fake-mp3-track-01') } = {}) {
  const contract = await import('../../services/textbooks/manifestContract.mjs');
  const baseDir = path.join(textbookSourceRoot, 'daily-english', 'track-01');
  fs.mkdirSync(baseDir, { recursive: true });
  const imageRelative = 'daily-english/track-01/page-01.png';
  const audioRelative = 'daily-english/track-01/track-01.mp3';
  const manifestRelative = 'daily-english/track-01/manifest.json';
  const imagePath = path.join(textbookSourceRoot, imageRelative);
  const audioPath = path.join(textbookSourceRoot, audioRelative);
  fs.writeFileSync(imagePath, Buffer.from('synthetic-page-image'));
  fs.writeFileSync(audioPath, audioBytes);
  const manifest = {
    schemaVersion: 'textbook-track-manifest/v1',
    course: {
      key: 'daily-english',
      title: 'Daily English',
      sourceNotice: 'Synthetic fixture. Actual textbook content stays outside Git.',
    },
    track: {
      number: 1,
      displayOrder: 1,
      title: 'Morning Scene',
      expectedExpressionCount: 2,
    },
    revision: {
      number: 1,
      status: 'draft',
      parentManifestHash: null,
    },
    assets: [
      {
        assetKey: 'source:01',
        kind: 'source_image',
        ordinal: 1,
        relativePath: imageRelative,
        sha256: sha256(fs.readFileSync(imagePath)),
        byteSize: fs.statSync(imagePath).size,
        mimeType: 'image/png',
      },
      {
        assetKey: 'official:01',
        kind: 'official_audio',
        ordinal: 1,
        relativePath: audioRelative,
        sha256: sha256(fs.readFileSync(audioPath)),
        byteSize: fs.statSync(audioPath).size,
        mimeType: 'audio/mpeg',
        durationMs: 1234,
      },
    ],
    expressions: [
      expression('expr:01', 1, 'Get up.', 'おきて。', '起床。'),
      expression('expr:02', 2, 'I am up now.', 'もうおきたよ。', '已经起床。'),
    ],
    import: {
      skillName: 'import-textbook-track',
      skillVersion: '1.0.0',
      createdAtUtc: '2026-07-14T00:00:00.000Z',
    },
    integrity: {
      sourceFingerprint: '0'.repeat(64),
      contentHash: '0'.repeat(64),
    },
  };
  contract.applyComputedHashes(manifest);
  const manifestPath = path.join(textbookSourceRoot, manifestRelative);
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return {
    manifest,
    manifestRelative,
    manifestHash: contract.computeManifestFileHash(manifest),
    audioBytes,
    audioPath,
  };
}

function sourceSpan() {
  return { assetKey: 'source:01', pageOrdinal: 1, region: [0.1, 0.1, 0.4, 0.1] };
}

function expression(key, ordinal, en, ja, zh) {
  return {
    key,
    ordinal,
    official: {
      en: { text: en, sourceSpan: sourceSpan() },
      ja: { text: ja, sourceSpan: sourceSpan() },
    },
    derived: {
      zhCue: zh,
      rubySegments: [{ text: ja }],
      analysis: {
        phrases: [],
        grammar: [],
        register: [],
        comparison: [],
      },
    },
    confidence: {
      pairing: 1,
      en: 1,
      ja: 1,
      zhCue: 0.9,
      ruby: 0.9,
    },
    unitHashes: {
      en: '0'.repeat(64),
      ja: '0'.repeat(64),
    },
  };
}

test.beforeEach(() => resetState());

test('textbook imports validate, persist draft rows, and stay out of Cards Factory history/search', async () => {
  const fixture = await createManifestFixture();

  const dryRun = await api('POST', '/api/textbooks/imports/dry-run', {
    body: {
      manifestRelativePath: fixture.manifestRelative,
      expectedManifestHash: fixture.manifestHash,
    },
  });
  assert.equal(dryRun.status, 200);
  assert.equal(dryRun.body.summary.expressionCount, 2);
  assert.equal(dryRun.body.summary.unitCounts.total, 4);

  const imported = await api('POST', '/api/textbooks/imports', {
    body: {
      manifestRelativePath: fixture.manifestRelative,
      expectedManifestHash: fixture.manifestHash,
    },
  });
  assert.equal(imported.status, 200);
  assert.equal(imported.body.track.status, 'draft');
  assert.equal(imported.body.track.expressions.length, 2);
  assert.equal(imported.body.track.generation_id, null);
  const revisionId = imported.body.track.revision_id;

  const counts = dbService.db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM textbook_courses) AS courses,
      (SELECT COUNT(*) FROM textbook_tracks) AS tracks,
      (SELECT COUNT(*) FROM textbook_track_revisions) AS revisions,
      (SELECT COUNT(*) FROM textbook_expressions) AS expressions,
      (SELECT COUNT(*) FROM study_items) AS study_items,
      (SELECT COUNT(*) FROM generations) AS generations
  `).get();
  assert.deepEqual(counts, {
    courses: 1,
    tracks: 1,
    revisions: 1,
    expressions: 2,
    study_items: 0,
    generations: 0,
  });

  const repeated = await api('POST', '/api/textbooks/imports', {
    body: {
      manifestRelativePath: fixture.manifestRelative,
      expectedManifestHash: fixture.manifestHash,
    },
  });
  assert.equal(repeated.status, 200);
  assert.equal(dbService.db.prepare('SELECT COUNT(*) AS count FROM textbook_track_revisions').get().count, 1);

  const courses = await api('GET', '/api/textbooks/courses');
  assert.equal(courses.status, 200);
  assert.equal(courses.body.courses.length, 1);
  const search = await api('GET', '/api/textbooks/search?q=Get');
  assert.equal(search.status, 200);
  assert.equal(search.body.results.length, 1);

  const history = await api('GET', '/api/history?search=Get');
  assert.equal(history.status, 200);
  assert.equal(history.body.records.length, 0);

  const verified = await api('POST', `/api/textbooks/revisions/${revisionId}/verify`, {
    body: { expectedTrackStatus: 'draft' },
  });
  assert.equal(verified.status, 200);
  assert.equal(verified.body.track.status, 'verified');
  assert.equal(verified.body.track.revision_status, 'verified');
  assert.equal(verified.body.track.current_revision_id, revisionId);
  assert.equal(verified.body.track.generation_id, null);
  assert.equal(dbService.db.prepare('SELECT COUNT(*) AS count FROM study_items').get().count, 0);
  assert.equal(dbService.db.prepare('SELECT COUNT(*) AS count FROM generations').get().count, 0);
});

test('verified textbook track publishes textbook study items and creates derivation jobs', async () => {
  const fixture = await createManifestFixture();
  const imported = await api('POST', '/api/textbooks/imports', {
    body: {
      manifestRelativePath: fixture.manifestRelative,
      expectedManifestHash: fixture.manifestHash,
    },
  });
  const revisionId = imported.body.track.revision_id;
  const trackId = imported.body.track.id;
  await api('POST', `/api/textbooks/revisions/${revisionId}/verify`, {
    body: { expectedTrackStatus: 'draft' },
  });

  const preview = await api('GET', `/api/textbooks/tracks/${trackId}/publish-preview`);
  assert.equal(preview.status, 200);
  assert.equal(preview.body.preview.unitCount, 4);
  assert.equal(preview.body.preview.planRevision, 0);

  const published = await api('POST', `/api/textbooks/tracks/${trackId}/publish`, {
    body: {
      expectedTrackRevision: 1,
      confirmUnitCount: 4,
      expectedPlanRevision: 0,
    },
  });
  assert.equal(published.status, 200);
  assert.equal(published.body.track.status, 'published');
  assert.equal(published.body.unitCount, 4);
  assert.equal(published.body.itemActions.inserted, 4);
  assert.equal(published.body.track.generation_id, published.body.generationId);

  const publishedCounts = dbService.db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM generations WHERE card_type = 'textbook_track') AS textbook_generations,
      (SELECT COUNT(*) FROM learning_source_admissions WHERE admission_source = 'manual') AS manual_admissions,
      (SELECT COUNT(*) FROM study_items WHERE unit_kind = 'textbook_en') AS textbook_en,
      (SELECT COUNT(*) FROM study_items WHERE unit_kind = 'textbook_ja') AS textbook_ja
  `).get();
  assert.deepEqual(publishedCounts, {
    textbook_generations: 1,
    manual_admissions: 1,
    textbook_en: 2,
    textbook_ja: 2,
  });

  const options = await api('GET', '/api/learning/scope-options');
  assert.equal(options.status, 200);
  assert.equal(options.body.textbookTracks.length, 1);
  assert.equal(options.body.textbookTracks[0].studyItemCount, 4);

  const planPreview = await api('POST', '/api/learning/plan/preview', {
    body: {
      scope: {
        version: 2,
        languages: ['en', 'ja'],
        cardTypes: ['textbook_track'],
        dateRange: null,
        tags: [],
        textbookTrackIds: [trackId],
      },
    },
  });
  assert.equal(planPreview.status, 200);
  assert.equal(planPreview.body.scopePreview.studyItemCount, 4);
  assert.equal(planPreview.body.scopePreview.byKind.textbook_en, 2);
  assert.equal(planPreview.body.scopePreview.byKind.textbook_ja, 2);

  const itemId = dbService.db.prepare(`
    SELECT id FROM study_items WHERE unit_kind = 'textbook_ja' ORDER BY id LIMIT 1
  `).get().id;
  const item = await api('GET', `/api/learning/items/${itemId}`);
  assert.equal(item.status, 200);
  assert.equal(item.body.item.unitKind, 'textbook_ja');
  assert.deepEqual(item.body.item.prompt.targetLanguages, ['ja']);
  assert.match(item.body.item.answer.markdown, /日本語/);

  const expressionId = dbService.db.prepare(`
    SELECT expression_id FROM textbook_expression_revisions ORDER BY display_ordinal LIMIT 1
  `).get().expression_id;
  const derivation = await api('POST', `/api/textbooks/expressions/${expressionId}/derivations`, {
    body: {
      selectionText: 'Get up',
      selectionLanguage: 'en',
      targetCardType: 'trilingual',
    },
  });
  assert.equal(derivation.status, 200);
  assert.equal(derivation.body.job.jobType, 'trilingual');
  assert.equal(derivation.body.derivation.target_job_id, derivation.body.job.id);
  const repeatedDerivation = await api('POST', `/api/textbooks/expressions/${expressionId}/derivations`, {
    body: {
      selectionText: 'Get up',
      selectionLanguage: 'en',
      targetCardType: 'trilingual',
    },
  });
  assert.equal(repeatedDerivation.status, 200);
  assert.equal(repeatedDerivation.body.reused, true);
  assert.equal(repeatedDerivation.body.job.id, derivation.body.job.id);
  assert.equal(
    dbService.db.prepare('SELECT COUNT(*) AS count FROM textbook_card_derivations').get().count,
    1
  );
});

test('official audio endpoint supports HEAD, range, etag, and hash drift protection', async () => {
  const audioBytes = Buffer.from('0123456789abcdef');
  const fixture = await createManifestFixture({ audioBytes });
  await api('POST', '/api/textbooks/imports', {
    body: {
      manifestRelativePath: fixture.manifestRelative,
      expectedManifestHash: fixture.manifestHash,
    },
  });
  const assetId = dbService.db.prepare(`
    SELECT id FROM textbook_track_assets WHERE kind = 'official_audio'
  `).get().id;

  const head = await api('HEAD', `/api/textbooks/assets/${assetId}/content`);
  assert.equal(head.status, 200);
  assert.equal(head.headers['accept-ranges'], 'bytes');
  assert.equal(Number(head.headers['content-length']), audioBytes.length);
  assert.equal(head.headers.etag, `"sha256-${sha256(audioBytes)}"`);

  const baseUrl = await getBaseUrl();
  const rangeRes = await fetch(`${baseUrl}/api/textbooks/assets/${assetId}/content`, {
    headers: { Range: 'bytes=2-5' },
  });
  assert.equal(rangeRes.status, 206);
  assert.equal(rangeRes.headers.get('content-range'), `bytes 2-5/${audioBytes.length}`);
  assert.equal(Buffer.from(await rangeRes.arrayBuffer()).toString(), '2345');

  const notModified = await fetch(`${baseUrl}/api/textbooks/assets/${assetId}/content`, {
    headers: { 'If-None-Match': `"sha256-${sha256(audioBytes)}"` },
  });
  assert.equal(notModified.status, 304);

  const invalidRange = await api('GET', `/api/textbooks/assets/${assetId}/content`, {
    headers: { Range: `bytes=${audioBytes.length + 1}-` },
  });
  assert.equal(invalidRange.status, 416);
  assert.equal(invalidRange.headers['content-range'], `bytes */${audioBytes.length}`);

  fs.writeFileSync(fixture.audioPath, Buffer.from('changed'));
  const drift = await api('GET', `/api/textbooks/assets/${assetId}/content`);
  assert.equal(drift.status, 409);
  assert.equal(drift.body.code, 'TEXTBOOK_AUDIO_HASH_MISMATCH');
  assert.equal(
    dbService.db.prepare('SELECT availability FROM textbook_track_assets WHERE id = ?').get(assetId).availability,
    'hash-mismatch'
  );
});
