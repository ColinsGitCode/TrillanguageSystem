'use strict';

process.env.DB_PATH = ':memory:';
process.env.LOG_SILENT = '1';

const assert = require('node:assert/strict');
const test = require('node:test');
const databaseModule = require('../../services/storage/databaseService');
const { DatabaseService } = databaseModule;
const {
  applyAnnotationMigrationPlan,
} = require('../../services/annotations/application/applyAnnotationMigrationPlan');
const {
  buildAnnotationMigrationPlan,
} = require('../../services/annotations/application/buildAnnotationMigrationPlan');

const HASH = '7'.repeat(64);

function seedGeneration(db) {
  return Number(db.prepare(`
    INSERT INTO generations(
      phrase, phrase_language, card_type, source_mode, llm_provider, llm_model,
      folder_name, base_filename, md_file_path, html_file_path, meta_file_path,
      markdown_content, content_hash, generation_date, request_id
    ) VALUES (
      'hello', 'en', 'trilingual', 'input', 'deepseek', 'deepseek-v4-pro',
      '20260727', 'hello', '/tmp/hello.md', '/tmp/hello.html', '/tmp/hello.json',
      '# hello\n\nfoo bar baz', ?, '2026-07-27', 'annotation-apply'
    )
  `).run(HASH).lastInsertRowid);
}

function count(db, table) {
  return Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count);
}

function seedLegacyHighlight(db, {
  generationId,
  folderName,
  baseFilename,
  sourceHash,
  htmlContent,
}) {
  db.prepare(`
    INSERT INTO card_highlights(
      generation_id, folder_name, base_filename, source_hash, html_content
    ) VALUES (?, ?, ?, ?, ?)
  `).run(generationId, folderName, baseFilename, sourceHash, htmlContent);
}

test.after(() => databaseModule.close());

test('applies an approved migration plan transactionally and idempotently', async () => {
    const dbService = new DatabaseService(':memory:');
  try {
    const generationId = seedGeneration(dbService.db);
    seedLegacyHighlight(dbService.db, {
      generationId,
      folderName: '20260727',
      baseFilename: 'hello',
      sourceHash: HASH,
      htmlContent: '<div><h1>hello</h1><p>foo <mark class="study-highlight-red">bar</mark> baz</p></div>',
    });
    const plan = await buildAnnotationMigrationPlan({
      db: dbService.db,
      now: '2026-07-27T01:00:00.000Z',
    });

    assert.throws(
      () => applyAnnotationMigrationPlan({
        dbService,
        plan,
        expectedPlanHash: '8'.repeat(64),
      }),
      (error) => error.code === 'ANNOTATION_MIGRATION_PLAN_HASH_CONFLICT'
    );
    assert.equal(count(dbService.db, 'card_annotations'), 0);
    assert.equal(count(dbService.db, 'card_annotation_migration_events'), 0);

    const first = applyAnnotationMigrationPlan({
      dbService,
      plan,
      expectedPlanHash: plan.planHash,
      now: () => '2026-07-27T02:00:00.000Z',
    });
    assert.equal(first.idempotent, false);
    assert.equal(first.events, 1);
    assert.equal(count(dbService.db, 'card_annotations'), 1);
    assert.equal(count(dbService.db, 'card_annotation_migration_events'), 1);

    const annotation = dbService.listCardAnnotations('generation', generationId)[0];
    assert.equal(annotation.selector.textQuote.exact, 'bar');
    assert.equal(annotation.legacyHighlightId, 1);

    const second = applyAnnotationMigrationPlan({
      dbService,
      plan,
      expectedPlanHash: plan.planHash,
    });
    assert.equal(second.idempotent, true);
    assert.equal(count(dbService.db, 'card_annotations'), 1);
    assert.equal(count(dbService.db, 'card_annotation_migration_events'), 1);
  } finally {
    dbService.close();
  }
});
