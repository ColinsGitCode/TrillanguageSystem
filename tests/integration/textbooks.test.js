'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { JSDOM } = require('jsdom');

const textbookSourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'textbook-source-'));
const textbookWorkRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'textbook-work-'));
process.env.TEXTBOOK_FEATURE_ENABLED = '1';
process.env.TEXTBOOK_SOURCE_ROOT = textbookSourceRoot;
process.env.TEXTBOOK_WORK_PATH = textbookWorkRoot;
process.env.CARD_ANNOTATIONS_ENABLED = '1';

const {
  api,
  resetState,
  dbService,
  getBaseUrl,
  closeServer,
} = require('./_harness');
const { TextbookTtsService } = require('../../services/textbooks/textbookTtsService');
const {
  textbookAnnotationService,
} = require('../../services/annotations/annotationRuntime');
const {
  loadTextbookSharedModules,
} = require('../../services/annotations/application/textbookAnnotationService');

test.after(async () => {
  await closeServer();
  fs.rmSync(textbookSourceRoot, { recursive: true, force: true });
  fs.rmSync(textbookWorkRoot, { recursive: true, force: true });
});

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function createManifestFixture({
  audioBytes = Buffer.from('fake-mp3-track-01'),
  imageBytes = Buffer.from('synthetic-page-image'),
  revisionNumber = 1,
  parentManifestHash = null,
  firstEnglish = 'Get up.',
} = {}) {
  const contract = await import('../../services/textbooks/manifestContract.mjs');
  const baseDir = path.join(textbookSourceRoot, 'daily-english', 'track-01');
  fs.mkdirSync(baseDir, { recursive: true });
  const imageRelative = 'daily-english/track-01/page-01.png';
  const audioRelative = 'daily-english/track-01/track-01.mp3';
  const manifestRelative = `daily-english/track-01/manifest.v${revisionNumber}.json`;
  const imagePath = path.join(textbookSourceRoot, imageRelative);
  const audioPath = path.join(textbookSourceRoot, audioRelative);
  fs.writeFileSync(imagePath, imageBytes);
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
      number: revisionNumber,
      status: 'draft',
      parentManifestHash,
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
      expression('expr:01', 1, firstEnglish, 'おきて。', '起床。'),
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

async function confirmAllExpressions(trackId) {
  const workflowResponse = await api('GET', `/api/textbooks/tracks/${trackId}/workflow`);
  assert.equal(workflowResponse.status, 200);
  const { workflow } = workflowResponse.body;
  for (const task of workflow.review.tasks) {
    const confirmed = await api(
      'PUT',
      `/api/textbooks/revisions/${workflow.track.revisionId}/expressions/${task.expressionId}/review`,
      {
        body: {
          expressionRevisionId: task.expressionRevisionId,
          status: 'confirmed',
          reviewer: 'integration-test',
        },
      }
    );
    assert.equal(confirmed.status, 200);
  }
  const completed = await api('GET', `/api/textbooks/tracks/${trackId}/workflow`);
  assert.equal(completed.body.workflow.review.confirmed, completed.body.workflow.review.total);
  return completed.body.workflow;
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

  const blocked = await api('POST', `/api/textbooks/revisions/${revisionId}/verify`, {
    body: { expectedTrackStatus: 'draft' },
  });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.code, 'TEXTBOOK_REVIEW_INCOMPLETE');
  await confirmAllExpressions(imported.body.track.id);
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

test('textbook review batch triage is atomic and never confirms expressions', async () => {
  const fixture = await createManifestFixture();
  const imported = await api('POST', '/api/textbooks/imports', {
    body: {
      manifestRelativePath: fixture.manifestRelative,
      expectedManifestHash: fixture.manifestHash,
    },
  });
  assert.equal(imported.status, 200);
  const trackId = imported.body.track.id;
  const workflowResponse = await api('GET', `/api/textbooks/tracks/${trackId}/workflow`);
  const workflow = workflowResponse.body.workflow;
  const [first, second] = workflow.review.tasks;

  const conflict = await api('PUT', `/api/textbooks/revisions/${workflow.track.revisionId}/reviews`, {
    body: {
      updates: [{
        expressionId: first.expressionId,
        expressionRevisionId: first.expressionRevisionId,
        status: 'needs_attention',
        reasonCode: 'manual-bulk-triage',
      }, {
        expressionId: second.expressionId,
        expressionRevisionId: second.expressionRevisionId + 99,
        status: 'needs_attention',
        reasonCode: 'manual-bulk-triage',
      }],
    },
  });
  assert.equal(conflict.status, 409);
  const unchanged = await api('GET', `/api/textbooks/tracks/${trackId}/workflow`);
  assert.equal(unchanged.body.workflow.review.needsAttention, 0);
  assert.equal(unchanged.body.workflow.review.confirmed, 0);

  const triaged = await api('PUT', `/api/textbooks/revisions/${workflow.track.revisionId}/reviews`, {
    body: {
      updates: [first, second].map((task) => ({
        expressionId: task.expressionId,
        expressionRevisionId: task.expressionRevisionId,
        status: 'needs_attention',
        reasonCode: 'manual-bulk-triage',
      })),
    },
  });
  assert.equal(triaged.status, 200);
  assert.equal(triaged.body.reviews.length, 2);
  assert.equal(triaged.body.workflow.review.needsAttention, 2);
  assert.equal(triaged.body.workflow.review.confirmed, 0);
  assert.equal(
    dbService.db.prepare(`
      SELECT COUNT(*) AS count
      FROM textbook_expression_review_states
      WHERE track_revision_id = ? AND status = 'confirmed'
    `).get(workflow.track.revisionId).count,
    0
  );
});

test('textbook workflow rejects an incomplete review projection instead of showing contradictory counts', async () => {
  const fixture = await createManifestFixture();
  const imported = await api('POST', '/api/textbooks/imports', {
    body: {
      manifestRelativePath: fixture.manifestRelative,
      expectedManifestHash: fixture.manifestHash,
    },
  });
  assert.equal(imported.status, 200);
  const trackId = imported.body.track.id;
  const revisionId = imported.body.track.revision_id;
  dbService.db.prepare(`
    DELETE FROM textbook_expression_review_states
    WHERE track_revision_id = ?
      AND expression_id = (
        SELECT expression_id FROM textbook_expression_review_states
        WHERE track_revision_id = ?
        ORDER BY expression_id
        LIMIT 1
      )
  `).run(revisionId, revisionId);

  const workflow = await api('GET', `/api/textbooks/tracks/${trackId}/workflow`);
  assert.equal(workflow.status, 409);
  assert.equal(workflow.body.code, 'TEXTBOOK_WORKFLOW_STATE_INCONSISTENT');
  assert.equal(workflow.body.details.expressionCount, 2);
  assert.equal(workflow.body.details.reviewStateCount, 1);
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
  await confirmAllExpressions(trackId);
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

  const ttsService = new TextbookTtsService({
    dbService,
    workPath: textbookWorkRoot,
    generateAudioBatch: async (tasks, { outputDir, baseName }) => {
      const results = tasks.map((task, index) => {
        const extension = task.extension;
        const filePath = path.join(outputDir, `${baseName}${task.filename_suffix}.${extension}`);
        fs.writeFileSync(filePath, Buffer.from(`${task.lang}:${task.text}`));
        return {
          index,
          filePath,
          extension,
          ttsProvider: task.lang === 'en' ? 'kokoro' : 'voicevox',
          ttsModel: task.lang === 'en' ? 'hexgrad/Kokoro-82M' : 'voicevox',
          ttsVoice: task.lang === 'en' ? 'af_bella' : 'speaker:2',
          status: 'generated',
        };
      });
      return { results, errors: [] };
    },
  });
  const audioGenerated = await ttsService.generateTrack(trackId);
  assert.deepEqual(audioGenerated.summary, { requested: 4, generated: 4, failed: 0, skipped: 0 });
  assert.equal(audioGenerated.track.tts_audio.length, 4);
  assert.equal('file_path' in audioGenerated.track.tts_audio[0], false);
  assert.match(audioGenerated.track.tts_audio[0].playback_url, /^\/api\/textbooks\/audio\/\d+\/content$/u);
  const audioRepeated = await ttsService.generateTrack(trackId);
  assert.deepEqual(audioRepeated.summary, { requested: 0, generated: 0, failed: 0, skipped: 4 });
  dbService.db.prepare('UPDATE audio_files SET text = ? WHERE id = ?').run('stale audio text', audioGenerated.track.tts_audio[0].id);
  const audioRepaired = await ttsService.generateTrack(trackId);
  assert.deepEqual(audioRepaired.summary, { requested: 1, generated: 1, failed: 0, skipped: 3 });

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
  assert.equal(item.body.item.audioFiles.length, 1);
  assert.match(item.body.item.audioFiles[0].playback_url, /^\/api\/textbooks\/audio\/\d+\/content$/u);
  assert.equal(item.body.item.annotationReference, null);
  assert.equal(item.body.item.highlightReference, undefined);

  const audioId = audioGenerated.track.tts_audio[0].id;
  const audioHead = await api('HEAD', `/api/textbooks/audio/${audioId}/content`);
  assert.equal(audioHead.status, 200);
  assert.equal(audioHead.headers['accept-ranges'], 'bytes');

  const shared = await loadTextbookSharedModules();
  const canonical = textbookAnnotationService.canonicalDocument(published.body.track, shared);
  const annotationDom = new JSDOM(`<body>${canonical}</body>`);
  const annotationRoot = annotationDom.window.document.body.firstElementChild;
  const annotationMap = shared.anchor.buildCanonicalDomMap(annotationRoot);
  const annotationStart = annotationMap.text.indexOf('Get');
  annotationDom.window.close();
  const annotationId = '018f0f96-5a90-7d75-a2c6-86559b5de961';
  const savedAnnotation = await api('POST', '/api/annotations', {
    body: {
      id: annotationId,
      targetKind: 'textbook_track',
      targetId: trackId,
      expectedTargetRevision: String(published.body.track.current_revision_id),
      selector: {
        projectionVersion: shared.anchor.PROJECTION_VERSION,
        textQuote: {
          type: 'TextQuoteSelector',
          exact: 'Get',
          prefix: annotationMap.text.slice(Math.max(0, annotationStart - 32), annotationStart),
          suffix: annotationMap.text.slice(annotationStart + 3, annotationStart + 35),
        },
        textPosition: {
          type: 'TextPositionSelector',
          start: annotationStart,
          end: annotationStart + 3,
        },
      },
      annotationKind: 'highlight',
      color: 'red',
    },
  });
  assert.equal(savedAnnotation.status, 201);
  assert.equal(savedAnnotation.body.annotation.targetKind, 'textbook_track');
  assert.equal(savedAnnotation.body.compatibility, undefined);
  assert.equal(dbService.db.prepare('SELECT COUNT(*) AS count FROM card_highlights').get().count, 0);
  const highlightedItem = await api('GET', `/api/learning/items/${itemId}`);
  assert.equal(highlightedItem.body.item.highlightReference, undefined);
  assert.equal(highlightedItem.body.item.annotationReference.targetKind, 'textbook_track');
  assert.equal(highlightedItem.body.item.annotationReference.targetId, trackId);
  assert.equal(highlightedItem.body.item.annotationReference.count, 1);
  assert.equal(highlightedItem.body.item.annotationReference.source, 'card_annotations');
  assert.match(highlightedItem.body.item.answer.markdown, /study-highlight-red/u);
  const retiredHighlight = await api('GET', `/api/textbooks/tracks/${trackId}/highlights`);
  assert.equal(retiredHighlight.status, 404);

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
  assert.equal(derivation.body.job.targetFolder, 'Textbook-daily-english-Track-01');
  assert.equal(derivation.body.job.requestPayload.target_folder, 'Textbook-daily-english-Track-01');
  assert.equal(derivation.body.derivation.target_job_id, derivation.body.job.id);
  const targetGenerationId = Number(dbService.db.prepare(`
    INSERT INTO generations(
      phrase, phrase_language, card_type, source_mode, llm_provider, llm_model,
      folder_name, base_filename, md_file_path, html_file_path, meta_file_path,
      markdown_content, content_hash, generation_date, request_id
    ) VALUES (?, 'en', 'trilingual', 'textbook_selection', 'deepseek', 'deepseek-v4-pro',
      '20260715', 'get-up', '/tmp/get-up.md', '/tmp/get-up.html', '/tmp/get-up.meta.json',
      '# Get up', ?, '2026-07-15', ?)
  `).run('Get up', 'a'.repeat(64), `derived-${Date.now()}`).lastInsertRowid);
  dbService.updateGenerationJob(derivation.body.job.id, {
    status: 'success',
    resultGenerationId: targetGenerationId,
    finishedAt: new Date().toISOString(),
  });
  const completedDerivation = dbService.syncTextbookDerivationJobStatus(derivation.body.job.id);
  assert.equal(completedDerivation.status, 'completed');
  assert.equal(completedDerivation.target_generation_id, targetGenerationId);
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

  const deletedAnnotation = await api('DELETE', `/api/annotations/${annotationId}`, {
    body: { expectedVersion: 1 },
  });
  assert.equal(deletedAnnotation.status, 200);
  assert.equal(deletedAnnotation.body.annotation.status, 'deleted');
  assert.equal(dbService.listCardAnnotations('textbook_track', trackId).length, 0);
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

test('publishing a revised Track updates only the direction whose unit hash changed', async () => {
  const first = await createManifestFixture();
  const importedFirst = await api('POST', '/api/textbooks/imports', {
    body: {
      manifestRelativePath: first.manifestRelative,
      expectedManifestHash: first.manifestHash,
    },
  });
  const trackId = importedFirst.body.track.id;
  await confirmAllExpressions(trackId);
  await api('POST', `/api/textbooks/revisions/${importedFirst.body.track.revision_id}/verify`, {
    body: { expectedTrackStatus: 'draft' },
  });
  const publishedFirst = await api('POST', `/api/textbooks/tracks/${trackId}/publish`, {
    body: { expectedTrackRevision: 1, confirmUnitCount: 4, expectedPlanRevision: 0 },
  });
  assert.deepEqual(publishedFirst.body.itemActions, { inserted: 4, updated: 0, unchanged: 0, archived: 0 });

  const second = await createManifestFixture({
    imageBytes: Buffer.from('synthetic-page-image-revision-2'),
    revisionNumber: 2,
    parentManifestHash: first.manifestHash,
    firstEnglish: 'Please get up.',
  });
  const importedSecond = await api('POST', '/api/textbooks/imports', {
    body: {
      manifestRelativePath: second.manifestRelative,
      expectedManifestHash: second.manifestHash,
    },
  });
  assert.equal(importedSecond.status, 200);
  assert.equal(importedSecond.body.track.status, 'draft');
  assert.equal(importedSecond.body.track.revision_number, 2);
  await confirmAllExpressions(trackId);
  await api('POST', `/api/textbooks/revisions/${importedSecond.body.track.revision_id}/verify`, {
    body: { expectedTrackStatus: 'draft' },
  });
  const publishedSecond = await api('POST', `/api/textbooks/tracks/${trackId}/publish`, {
    body: { expectedTrackRevision: 2, confirmUnitCount: 4, expectedPlanRevision: 0 },
  });
  assert.equal(publishedSecond.status, 200);
  assert.deepEqual(publishedSecond.body.itemActions, { inserted: 0, updated: 1, unchanged: 3, archived: 0 });

  const revisions = dbService.db.prepare(`
    SELECT unit_key, content_revision FROM study_items
    WHERE source_generation_id = ? ORDER BY unit_key
  `).all(publishedSecond.body.generationId);
  assert.deepEqual(revisions, [
    { unit_key: 'expr:01:en', content_revision: 2 },
    { unit_key: 'expr:01:ja', content_revision: 1 },
    { unit_key: 'expr:02:en', content_revision: 1 },
    { unit_key: 'expr:02:ja', content_revision: 1 },
  ]);
});

test('textbook release operation is idempotent, observable, and resumable by id', async () => {
  const fixture = await createManifestFixture();
  const imported = await api('POST', '/api/textbooks/imports', {
    body: {
      manifestRelativePath: fixture.manifestRelative,
      expectedManifestHash: fixture.manifestHash,
    },
  });
  const trackId = imported.body.track.id;
  const workflow = await confirmAllExpressions(trackId);
  const verified = await api('POST', `/api/textbooks/revisions/${workflow.track.revisionId}/verify`, {
    body: { expectedTrackStatus: 'draft' },
  });
  assert.equal(verified.status, 200);
  const preview = await api('GET', `/api/textbooks/tracks/${trackId}/publish-preview`);
  const command = {
    kind: 'release',
    idempotencyKey: `integration-release-${trackId}`,
    previewRevision: `${workflow.track.revisionId}:${preview.body.preview.planRevision}`,
    payload: {
      expectedTrackRevision: workflow.track.revisionNumber,
      confirmUnitCount: preview.body.preview.unitCount,
      expectedPlanRevision: preview.body.preview.planRevision,
      includeTts: false,
    },
  };
  const stalePreview = await api('POST', `/api/textbooks/tracks/${trackId}/operations`, {
    body: { ...command, previewRevision: 'stale:preview', idempotencyKey: `${command.idempotencyKey}-stale` },
  });
  assert.equal(stalePreview.status, 409);
  assert.equal(stalePreview.body.code, 'TEXTBOOK_PREVIEW_REVISION_CONFLICT');
  const created = await api('POST', `/api/textbooks/tracks/${trackId}/operations`, { body: command });
  assert.equal(created.status, 202);
  const repeated = await api('POST', `/api/textbooks/tracks/${trackId}/operations`, { body: command });
  assert.equal(repeated.status, 202);
  assert.equal(repeated.body.operation.id, created.body.operation.id);
  const conflict = await api('POST', `/api/textbooks/tracks/${trackId}/operations`, {
    body: { ...command, payload: { ...command.payload, includeTts: true } },
  });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.code, 'TEXTBOOK_IDEMPOTENCY_CONFLICT');

  let operation = created.body.operation;
  for (let attempt = 0; attempt < 30 && ['queued', 'running'].includes(operation.status); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    operation = (await api('GET', `/api/textbooks/operations/${operation.id}`)).body.operation;
  }
  assert.equal(operation.status, 'succeeded');
  const events = await api('GET', `/api/textbooks/operations/${operation.id}/events`);
  assert.equal(events.status, 200);
  assert.ok(events.body.events.some((event) => event.event_type === 'created'));
  assert.ok(events.body.events.some((event) => event.event_type === 'finished'));
  assert.equal(dbService.db.prepare("SELECT COUNT(*) AS count FROM generations WHERE card_type = 'textbook_track'").get().count, 1);
  assert.equal(dbService.db.prepare("SELECT COUNT(*) AS count FROM study_items WHERE unit_kind LIKE 'textbook_%'").get().count, 4);

  const noOcr = await api('POST', `/api/textbooks/tracks/${trackId}/ocr`, { body: {} });
  assert.equal(noOcr.status, 404);
});

test('textbook queued operations can be cancelled and resumed through the public API', async () => {
  const fixture = await createManifestFixture();
  const imported = await api('POST', '/api/textbooks/imports', {
    body: {
      manifestRelativePath: fixture.manifestRelative,
      expectedManifestHash: fixture.manifestHash,
    },
  });
  const operation = dbService.createTextbookOperation(imported.body.track.id, {
    kind: 'sync',
    idempotencyKey: `integration-cancel-${imported.body.track.id}`,
    payload: {},
  });

  const cancelled = await api('POST', `/api/textbooks/operations/${operation.id}/cancel`);
  assert.equal(cancelled.status, 202);
  assert.equal(cancelled.body.operation.status, 'cancelled');
  assert.equal(cancelled.body.operation.result.cancelRequested, true);

  const events = await api('GET', `/api/textbooks/operations/${operation.id}/events`);
  assert.ok(events.body.events.some((event) => event.event_type === 'cancelled'));

  const resumed = await api('POST', `/api/textbooks/operations/${operation.id}/retry`);
  assert.equal(resumed.status, 202);
  assert.equal(resumed.body.operation.status, 'queued');
  assert.equal(resumed.body.operation.result.cancelRequested, undefined);

  let current = resumed.body.operation;
  for (let attempt = 0; attempt < 30 && ['queued', 'running'].includes(current.status); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    current = (await api('GET', `/api/textbooks/operations/${operation.id}`)).body.operation;
  }
  assert.equal(current.status, 'succeeded');
});
