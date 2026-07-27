'use strict';

process.env.DB_PATH = ':memory:';
process.env.LOG_SILENT = '1';

const assert = require('node:assert/strict');
const test = require('node:test');
const databaseModule = require('../../services/storage/databaseService');
const { DatabaseService } = databaseModule;
const {
  buildAnnotationMigrationPlan,
} = require('../../services/annotations/application/buildAnnotationMigrationPlan');

const HASH = 'e'.repeat(64);

function seedGeneration(db, {
  hash = HASH,
  markdown = '# hello\n\nfoo bar baz',
  requestId = 'annotation-migration-plan',
} = {}) {
  return Number(db.prepare(`
    INSERT INTO generations(
      phrase, phrase_language, card_type, source_mode, llm_provider, llm_model,
      folder_name, base_filename, md_file_path, html_file_path, meta_file_path,
      markdown_content, content_hash, generation_date, request_id
    ) VALUES (
      'hello', 'en', 'trilingual', 'input', 'deepseek', 'deepseek-v4-pro',
      '20260727', 'hello', '/tmp/hello.md', '/tmp/hello.html', '/tmp/hello.json',
      ?, ?, '2026-07-27', ?
    )
  `).run(markdown, hash, requestId).lastInsertRowid);
}

function count(db, table) {
  return Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count);
}

test.after(() => databaseModule.close());

test('builds a stable, content-safe, read-only migration plan', async () => {
  const dbService = new DatabaseService(':memory:');
  try {
    const generationId = seedGeneration(dbService.db);
    dbService.upsertCardHighlight({
      generationId,
      folderName: '20260727',
      baseFilename: 'hello',
      sourceHash: HASH,
      htmlContent: [
        '<div class="react-card-renderer card-type-trilingual">',
        '<h1>hello</h1><p>foo <mark class="study-highlight-red">bar</mark> baz</p>',
        '</div>',
      ].join(''),
    });
    dbService.upsertCardHighlight({
      generationId,
      folderName: '20260727',
      baseFilename: 'hello',
      sourceHash: 'f'.repeat(64),
      htmlContent: '<p><mark class="study-highlight-red">missing</mark></p>',
    });
    const repeatedGenerationId = seedGeneration(dbService.db, {
      hash: 'd'.repeat(64),
      markdown: [
        '# current heading',
        '',
        'First choice: repeated phrase alpha.',
        '',
        'Second choice: repeated phrase omega.',
      ].join('\n'),
      requestId: 'annotation-migration-repeated',
    });
    dbService.upsertCardHighlight({
      generationId: repeatedGenerationId,
      folderName: '20260727',
      baseFilename: 'repeated',
      sourceHash: 'c'.repeat(64),
      htmlContent: [
        '<div>legacy card structure and labels changed</div>',
        '<p>First choice: <mark class="study-highlight-red">repeated phrase</mark> alpha.</p>',
      ].join(''),
    });

    const before = {
      legacy: count(dbService.db, 'card_highlights'),
      annotations: count(dbService.db, 'card_annotations'),
      events: count(dbService.db, 'card_annotation_migration_events'),
    };
    const first = await buildAnnotationMigrationPlan({
      db: dbService.db,
      now: '2026-07-27T01:00:00.000Z',
    });
    const second = await buildAnnotationMigrationPlan({
      db: dbService.db,
      now: '2026-07-27T02:00:00.000Z',
    });

    assert.deepEqual(first.summary, {
      highlightRows: 3,
      rawMarkElements: 3,
      inferredContinuousMarkedRuns: 3,
      migrated: 2,
      orphaned: 1,
      skipped: 0,
    });
    assert.equal(first.mode, 'read-only-dry-run');
    assert.equal(first.positionUnit, 'utf16');
    assert.equal(first.planHash, second.planHash);
    assert.notEqual(first.createdAtUtc, second.createdAtUtc);
    assert.match(first.items[0].annotationId, /^ca_legacy_[a-f0-9]{32}$/u);
    assert.equal(first.items[0].selector.textQuote.exact, 'bar');
    assert.equal(first.items[1].outcome, 'orphaned');
    assert.equal(first.items[2].reasonCode, 'legacy-context');
    assert.deepEqual({
      legacy: count(dbService.db, 'card_highlights'),
      annotations: count(dbService.db, 'card_annotations'),
      events: count(dbService.db, 'card_annotation_migration_events'),
    }, before);
  } finally {
    dbService.close();
  }
});
