'use strict';

process.env.DB_PATH = ':memory:';
process.env.LOG_SILENT = '1';

const assert = require('node:assert/strict');
const test = require('node:test');
const { JSDOM } = require('jsdom');
const databaseModule = require('../../services/storage/databaseService');
const { DatabaseService } = databaseModule;
const {
  TextbookAnnotationService,
  loadTextbookSharedModules,
} = require('../../services/annotations/application/textbookAnnotationService');

const NOW = '2026-07-27T02:03:04.000Z';
const CONTENT_HASH = 'a'.repeat(64);
const PROJECTION_HASH = 'b'.repeat(64);
const GENERATION_HASH = 'c'.repeat(64);
const ID = '018f0f96-5a90-7d75-a2c6-86559b5de951';

function seedPublishedTrack(dbService) {
  const generationId = Number(dbService.db.prepare(`
    INSERT INTO generations(
      phrase, phrase_language, card_type, source_mode, llm_provider, llm_model,
      folder_name, base_filename, md_file_path, html_file_path, meta_file_path,
      markdown_content, content_hash, generation_date, request_id
    ) VALUES (
      'Morning Scene', 'ja', 'textbook_track', 'textbook', 'deepseek', 'deepseek-v4-pro',
      'Textbook-daily-english-Track-01', 'track-01',
      '/tmp/track.md', '/tmp/track.html', '/tmp/track.json',
      '# Morning Scene', ?, '2026-07-27', ?
    )
  `).run(GENERATION_HASH, `textbook-annotation-${Math.random()}`).lastInsertRowid);
  const courseId = Number(dbService.db.prepare(`
    INSERT INTO textbook_courses(
      course_key, title, source_notice, status, created_at_utc, updated_at_utc
    ) VALUES ('daily-english', 'Daily English', NULL, 'active', ?, ?)
  `).run(NOW, NOW).lastInsertRowid);
  const trackId = Number(dbService.db.prepare(`
    INSERT INTO textbook_tracks(
      course_id, track_number, display_order, title, status, generation_id,
      published_at_utc, created_at_utc, updated_at_utc
    ) VALUES (?, 1, 1, 'Morning Scene', 'published', ?, ?, ?, ?)
  `).run(courseId, generationId, NOW, NOW, NOW).lastInsertRowid);
  const revisionId = Number(dbService.db.prepare(`
    INSERT INTO textbook_track_revisions(
      track_id, revision_number, status, origin, manifest_schema_version,
      manifest_relative_path, manifest_hash, source_fingerprint,
      content_hash, projection_hash, expression_count, skill_name, skill_version,
      skill_input_summary_json, change_summary_json, created_at_utc, verified_at_utc
    ) VALUES (
      ?, 1, 'published', 'import', 'textbook-track-manifest/v1',
      'daily-english/track-01/manifest.json', ?, ?, ?, ?, 1,
      'import-textbook-track', '1.0.0', '{}', '{}', ?, ?
    )
  `).run(
    trackId,
    '1'.repeat(64),
    '2'.repeat(64),
    CONTENT_HASH,
    PROJECTION_HASH,
    NOW,
    NOW
  ).lastInsertRowid);
  dbService.db.prepare(`
    UPDATE textbook_tracks
    SET current_revision_id = ?, updated_at_utc = ?
    WHERE id = ?
  `).run(revisionId, NOW, trackId);
  const expressionId = Number(dbService.db.prepare(`
    INSERT INTO textbook_expressions(
      track_id, expression_key, lifecycle, created_revision_id, created_at_utc, updated_at_utc
    ) VALUES (?, 'expr:01', 'active', ?, ?, ?)
  `).run(trackId, revisionId, NOW, NOW).lastInsertRowid);
  dbService.db.prepare(`
    INSERT INTO textbook_expression_revisions(
      revision_id, expression_id, display_ordinal, official_en_text, official_ja_text,
      zh_cue_text, ja_ruby_html, phrase_analysis_json, grammar_points_json,
      confidence_json, source_spans_json, provenance_json, en_unit_hash, ja_unit_hash,
      created_at_utc
    ) VALUES (
      ?, ?, 1, 'Get up.', '起きて。', '起床。',
      '<ruby>起<rt>お</rt></ruby>きて。', '[]', '[]', '{}', '[]', '{}',
      ?, ?, ?
    )
  `).run(revisionId, expressionId, 'd'.repeat(64), 'e'.repeat(64), NOW);
  return trackId;
}

async function selectorFor(service, track, exact) {
  const shared = await loadTextbookSharedModules();
  const dom = new JSDOM(`<body>${service.canonicalDocument(track, shared)}</body>`);
  try {
    const root = dom.window.document.body.firstElementChild;
    const map = shared.anchor.buildCanonicalDomMap(root);
    const start = map.text.indexOf(exact);
    assert.notEqual(start, -1);
    return {
      projectionVersion: shared.anchor.PROJECTION_VERSION,
      textQuote: {
        type: 'TextQuoteSelector',
        exact,
        prefix: map.text.slice(Math.max(0, start - 32), start),
        suffix: map.text.slice(start + exact.length, start + exact.length + 32),
      },
      textPosition: {
        type: 'TextPositionSelector',
        start,
        end: start + exact.length,
      },
    };
  } finally {
    dom.window.close();
  }
}

async function payload(service, track, overrides = {}) {
  return {
    id: ID,
    targetKind: 'textbook_track',
    targetId: track.id,
    expectedTargetRevision: String(track.current_revision_id),
    selector: await selectorFor(service, track, 'Get'),
    annotationKind: 'highlight',
    color: 'red',
    ...overrides,
  };
}

test.after(() => databaseModule.close());

test('creates a textbook annotation without writing a legacy Track projection', async () => {
  const dbService = new DatabaseService(':memory:');
  try {
    const trackId = seedPublishedTrack(dbService);
    const track = dbService.getTextbookTrack(trackId);
    const service = new TextbookAnnotationService({ dbService });
    const result = await service.create(await payload(service, track));

    assert.equal(result.annotation.targetKind, 'textbook_track');
    assert.equal(result.annotation.selector.textQuote.exact, 'Get');
    assert.equal(dbService.listCardAnnotations('textbook_track', trackId).length, 1);
    assert.equal(dbService.db.prepare('SELECT COUNT(*) AS count FROM card_highlights').get().count, 0);
  } finally {
    dbService.close();
  }
});

test('soft-delete updates only the canonical textbook annotation', async () => {
  const dbService = new DatabaseService(':memory:');
  try {
    const trackId = seedPublishedTrack(dbService);
    const track = dbService.getTextbookTrack(trackId);
    const service = new TextbookAnnotationService({ dbService });
    const created = await service.create(await payload(service, track));
    const removed = await service.remove(created.annotation.id, { expectedVersion: 1 });

    assert.equal(removed.annotation.status, 'deleted');
    assert.equal(dbService.listCardAnnotations('textbook_track', trackId).length, 0);
    assert.equal(dbService.db.prepare('SELECT COUNT(*) AS count FROM card_highlights').get().count, 0);
  } finally {
    dbService.close();
  }
});

test('builds a review expression projection from canonical content and card annotations', async () => {
  const dbService = new DatabaseService(':memory:');
  try {
    const trackId = seedPublishedTrack(dbService);
    const track = dbService.getTextbookTrack(trackId);
    const service = new TextbookAnnotationService({ dbService });
    await service.create(await payload(service, track));
    const expressionRevisionId = track.expressions[0].id;
    const projection = await service.expressionProjection(trackId, expressionRevisionId);

    assert.equal(projection.target.targetKind, 'textbook_track');
    assert.equal(projection.fragments.annotationCount, 1);
    assert.match(projection.fragments.en, /study-highlight-red/u);
    assert.match(projection.fragments.en, new RegExp(`data-annotation-id="${ID}"`, 'u'));
    assert.equal(dbService.db.prepare('SELECT COUNT(*) AS count FROM card_highlights').get().count, 0);
  } finally {
    dbService.close();
  }
});
