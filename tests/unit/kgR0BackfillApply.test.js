'use strict';

process.env.DB_PATH = ':memory:';
process.env.LOG_SILENT = '1';

const assert = require('node:assert/strict');
const test = require('node:test');
const databaseModule = require('../../services/storage/databaseService');
const { DatabaseService } = databaseModule;
const { buildKnowledgeBackfillManifest } = require('../../services/kg/application/buildKnowledgeBackfillManifest');
const { applyKnowledgeBackfill, tableCounts } = require('../../services/kg/application/applyKnowledgeBackfill');

const NOW = '2026-07-16T03:00:00.000Z';
const HASH_A = 'a'.repeat(64);

function seedEligibleTrilingualPair(db) {
  const generationId = Number(db.prepare(`
    INSERT INTO generations(
      phrase, phrase_language, card_type, source_mode, llm_provider, llm_model,
      folder_name, base_filename, md_file_path, html_file_path, meta_file_path,
      markdown_content, content_hash, generation_date, request_id, en_translation, ja_translation
    ) VALUES ('handoff', 'en', 'trilingual', 'input', 'deepseek', 'deepseek-v4-pro',
      '20260716', 'kg-r0', '/tmp/kg-r0.md', '/tmp/kg-r0.html', '/tmp/kg-r0.json',
      '# handoff', ?, '2026-07-16', 'kg-r0-fixture', 'handoff', 'はし')
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
    ) VALUES (?, ?, ?, ?, '{}', ?, 1, 'active', ?, ?)
  `);
  insertItem.run(generationId, generationId, 'en', 'trilingual_en', HASH_A, NOW, NOW);
  insertItem.run(generationId, generationId, 'ja', 'trilingual_ja', HASH_A, NOW, NOW);
}

function unresolvedJapanese(text) {
  return {
    status: 'unresolved',
    input: text,
    normalizedInput: text,
    reason: 'ambiguous-kana-input',
    details: {},
    analyzer: { id: 'fixture', version: '1', ruleVersion: 'fixture-v1' },
    tokens: [],
  };
}

test.after(() => databaseModule.close());

test('KG-R0 applies one approved manifest atomically and materializes unresolved cases without lookup facts', async () => {
  const database = new DatabaseService(':memory:');
  try {
    seedEligibleTrilingualPair(database.db);
    const manifest = await buildKnowledgeBackfillManifest({ db: database.db, now: NOW, analyzeJapanese: unresolvedJapanese });
    const report = await applyKnowledgeBackfill({
      db: database.db,
      expectedManifestHash: manifest.manifestHash,
      now: '2026-07-17T03:00:00.000Z',
      analyzeJapanese: unresolvedJapanese,
    });

    assert.equal(report.manifestHash, manifest.manifestHash);
    assert.equal(report.resolvedApplied, 1);
    assert.equal(report.unresolved.materialized, 1);
    assert.equal(report.unresolved.skipped, 0);
    assert.equal(report.inserted.kg_points, 1);
    assert.equal(report.inserted.kg_evidence, 2);
    assert.equal(report.inserted.kg_resolution_cases, 1);
    assert.equal(report.inserted.kg_lookup_events, 0);
    assert.equal(tableCounts(database.db).kg_point_stats, 1);
    assert.equal(database.db.prepare('SELECT evidence_id FROM kg_resolution_cases').get().evidence_id > 0, true);
    assert.throws(
      () => database.db.prepare('DELETE FROM kg_resolution_events').run(),
      /immutable/u
    );
    await assert.rejects(
      () => applyKnowledgeBackfill({
        db: database.db,
        expectedManifestHash: manifest.manifestHash,
        now: '2026-07-17T03:01:00.000Z',
        analyzeJapanese: unresolvedJapanese,
      }),
      (error) => error.code === 'KG_BACKFILL_NOT_PRISTINE'
    );
  } finally {
    database.close();
  }
});

test('KG-R0 rejects a stale approval hash or source drift before writing facts', async () => {
  const database = new DatabaseService(':memory:');
  try {
    seedEligibleTrilingualPair(database.db);
    const manifest = await buildKnowledgeBackfillManifest({ db: database.db, now: NOW, analyzeJapanese: unresolvedJapanese });
    await assert.rejects(
      () => applyKnowledgeBackfill({
        db: database.db,
        expectedManifestHash: 'b'.repeat(64),
        now: NOW,
        analyzeJapanese: unresolvedJapanese,
      }),
      (error) => error.code === 'KG_BACKFILL_MANIFEST_MISMATCH'
    );
    assert.equal(tableCounts(database.db).kg_points, 0);

    database.db.prepare('UPDATE study_items SET content_hash = ?').run('c'.repeat(64));
    await assert.rejects(
      () => applyKnowledgeBackfill({
        db: database.db,
        expectedManifestHash: manifest.manifestHash,
        now: NOW,
        buildManifest: async () => manifest,
      }),
      (error) => error.code === 'KG_BACKFILL_SOURCE_DRIFT'
    );
    assert.equal(tableCounts(database.db).kg_points, 0);
    assert.equal(tableCounts(database.db).kg_lookup_events, 0);
  } finally {
    database.close();
  }
});
