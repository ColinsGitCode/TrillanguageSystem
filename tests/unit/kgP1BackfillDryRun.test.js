'use strict';

process.env.DB_PATH = ':memory:';
process.env.LOG_SILENT = '1';

const assert = require('node:assert/strict');
const test = require('node:test');
const databaseModule = require('../../services/storage/databaseService');
const { DatabaseService } = databaseModule;
const { buildKnowledgeBackfillManifest } = require('../../services/kg/application/buildKnowledgeBackfillManifest');
const { buildKnowledgePointIdentity, buildSurfaceIdentity } = require('../../services/kg/domain/knowledgeIdentity');

const NOW = '2026-07-16T04:00:00.000Z';
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

function seedSources(db) {
  const generationId = Number(db.prepare(`
    INSERT INTO generations(
      phrase, phrase_language, card_type, source_mode, llm_provider, llm_model,
      folder_name, base_filename, md_file_path, html_file_path, meta_file_path,
      markdown_content, content_hash, en_translation, ja_translation, zh_translation,
      generation_date, request_id
    ) VALUES ('handoff', 'en', 'trilingual', 'input', 'deepseek', 'deepseek-v4-pro',
      '20260716', 'dry-run', '/tmp/dry-run.md', '/tmp/dry-run.html', '/tmp/dry-run.json',
      '# handoff', ?, 'handoff', '引き継ぐ', '交接', '2026-07-16', 'kg-p1-dry-run')
  `).run(HASH_A).lastInsertRowid);
  db.prepare(`
    INSERT INTO learning_source_admissions(
      generation_id, status, content_hash, reasons_json, decision_version, state_version,
      materialization_disposition, identity_anchor_generation_id, admission_source,
      evaluated_at_utc, created_at_utc, updated_at_utc
    ) VALUES (?, 'eligible', ?, '[]', 'fixture-v1', 'fixture-v1',
      'create-items', ?, 'manual', ?, ?, ?)
  `).run(generationId, HASH_A, generationId, NOW, NOW, NOW);
  const insertItem = db.prepare(`
    INSERT INTO study_items(
      generation_id, source_generation_id, unit_key, unit_kind, unit_locator_json,
      content_hash, content_revision, lifecycle, created_at_utc, updated_at_utc
    ) VALUES (?, ?, ?, ?, ?, ?, 1, 'active', ?, ?)
  `);
  insertItem.run(generationId, generationId, 'en', 'trilingual_en', '{}', HASH_A, NOW, NOW);
  insertItem.run(generationId, generationId, 'ja', 'trilingual_ja', '{}', HASH_A, NOW, NOW);
  insertItem.run(generationId, generationId, 'whole', 'whole_card', '{}', HASH_A, NOW, NOW);

  const courseId = Number(db.prepare(`
    INSERT INTO textbook_courses(course_key, title, source_notice, created_at_utc, updated_at_utc)
    VALUES ('fixture-course', 'Fixture Course', 'Synthetic test data', ?, ?)
  `).run(NOW, NOW).lastInsertRowid);
  const trackId = Number(db.prepare(`
    INSERT INTO textbook_tracks(
      course_id, track_number, title, display_order, status, created_at_utc, updated_at_utc
    ) VALUES (?, 1, 'Morning', 1, 'published', ?, ?)
  `).run(courseId, NOW, NOW).lastInsertRowid);
  const revisionId = Number(db.prepare(`
    INSERT INTO textbook_track_revisions(
      track_id, revision_number, status, origin, manifest_schema_version,
      manifest_relative_path, manifest_hash, source_fingerprint, content_hash,
      projection_hash, expression_count, skill_name, skill_version,
      skill_input_summary_json, change_summary_json, created_at_utc, verified_at_utc
    ) VALUES (?, 1, 'published', 'import', 'fixture/v1', 'fixture/manifest.json', ?, ?, ?,
      ?, 1, 'fixture', '1', '{}', '{}', ?, ?)
  `).run(trackId, HASH_A, HASH_B, HASH_A, HASH_B, NOW, NOW).lastInsertRowid);
  const expressionId = Number(db.prepare(`
    INSERT INTO textbook_expressions(
      track_id, expression_key, lifecycle, created_revision_id, created_at_utc, updated_at_utc
    ) VALUES (?, 'expr:01', 'active', ?, ?, ?)
  `).run(trackId, revisionId, NOW, NOW).lastInsertRowid);
  db.prepare(`
    INSERT INTO textbook_expression_revisions(
      revision_id, expression_id, display_ordinal, official_en_text, official_ja_text,
      zh_cue_text, ja_ruby_html, phrase_analysis_json, grammar_points_json,
      confidence_json, source_spans_json, provenance_json, en_unit_hash, ja_unit_hash,
      created_at_utc
    ) VALUES (?, ?, 1, 'Good morning.', 'おはようございます。', '早上好。', 'おはようございます。',
      '{}', '[]', '{}', '[]', '{}', ?, ?, ?)
  `).run(revisionId, expressionId, HASH_A, HASH_B, NOW);
  db.prepare('UPDATE textbook_tracks SET current_revision_id = ? WHERE id = ?').run(revisionId, trackId);
}

test.after(() => databaseModule.close());

test('KG-P1 backfill builds a stable read-only manifest from eligible and textbook sources', async () => {
  const database = new DatabaseService(':memory:');
  try {
    seedSources(database.db);
    const analyzeJapanese = async (text) => {
      const pointIdentity = buildKnowledgePointIdentity({
        kpKind: 'lexeme', language: 'ja', canonicalForm: text, canonicalReading: 'ひきつぐ',
      });
      return {
        status: 'resolved',
        pointIdentity,
        surfaceIdentity: buildSurfaceIdentity({ language: 'ja', surfaceText: text, reading: 'ひきつぐ' }),
        relation: { linkKind: 'canonical', formKind: 'dictionary' },
        analyzer: { id: 'fixture', version: '1', ruleVersion: 'fixture-v1' },
      };
    };
    const before = database.db.prepare('SELECT COUNT(*) AS count FROM kg_points').get().count;
    const first = await buildKnowledgeBackfillManifest({ db: database.db, now: NOW, analyzeJapanese });
    const second = await buildKnowledgeBackfillManifest({ db: database.db, now: NOW, analyzeJapanese });
    const after = database.db.prepare('SELECT COUNT(*) AS count FROM kg_points').get().count;

    assert.equal(before, 0);
    assert.equal(after, 0);
    assert.equal(first.mode, 'read-only-dry-run');
    assert.equal(first.summary.activeEligibleStudyItems, 3);
    assert.equal(first.summary.extractedStudyItemSources, 2);
    assert.equal(first.summary.publishedTextbookSources, 2);
    assert.equal(first.summary.resolvedCandidates, 4);
    assert.equal(first.summary.unresolvedCandidates, 1);
    assert.equal(first.unresolved[0].reason, 'whole-card-extractor-unavailable');
    assert.equal(first.manifestHash, second.manifestHash);
  } finally {
    database.close();
  }
});
